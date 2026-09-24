import { IFinanceRepository } from '../../ports/output/IFinanceRepository';
import { IOutboxRepository } from '../../ports/output/IOutboxRepository';
import { LedgerTransaction } from '../../../domains/finance/entities/LedgerTransaction';
import { LedgerTransactionPostedEvent } from '../../../shared/kernel/DomainEvent';
import {
  IdempotencyConflictError,
  IdempotencyInProgressError,
  OptimisticConcurrencyError,
  InsufficientBalanceError,
  InvalidLedgerTransactionError,
  InvalidStateTransitionError,
  AccountInactiveError,
  AssetInactiveError,
} from '../../../domains/finance/errors/FinancialError';
import { LedgerImbalanceError } from '../../../domains/finance/errors/LedgerImbalanceError';
import { CanonicalRequestHashService } from './CanonicalRequestHashService';
import { AccountStatusPolicy, AccountStatus } from '../../../domains/finance/policies/AccountStatusPolicy';
import { AssetStatusPolicy } from '../../../domains/finance/policies/AssetStatusPolicy';
import { AccountClassPolicy } from '../../../domains/finance/policies/AccountClassPolicy';
import { parsePositiveSafeIntegerId } from '../../../domains/finance/value-objects/Money256';
import { PostingAuthority } from './PostingAuthority';
import { PostingPlanBuilder, PostingLegEntryInput } from '../../../domains/finance/services/PostingPlanBuilder';
import { PostingSession, PostingCapabilityToken } from '../../../domains/finance/contracts/PostingSession';
import { IPostingExecutor } from '../../ports/output/IPostingExecutor';
import { AuthorizationDecision } from '../../../domains/finance/contracts/AuthorizationContext';

export interface OrchestratorResult {
  transactionId: number;
  isReplayed: boolean;
}

export class FinancialTransactionOrchestrator {
  private readonly authority: PostingAuthority;
  private readonly session?: PostingSession;

  /**
   * O FinancialTransactionOrchestrator atua como a Autoridade Física Central de escrita no ledger financeiro.
   * Ele compila a intenção contábil via PostingPlanBuilder e despacha a mutação física
   * atômica através da PostingAuthority soberana (Gate 0 / IPostingExecutor).
   */
  constructor(
    private readonly financeRepo: IFinanceRepository,
    private readonly outboxRepo: IOutboxRepository,
    postingAuthority?: PostingAuthority,
    postingSession?: PostingSession
  ) {
    if (!outboxRepo) {
      throw new Error('IOutboxRepository é obrigatório para execução atômica no FinancialTransactionOrchestrator.');
    }
    if (postingAuthority) {
      this.authority = postingAuthority;
    } else {
      const executor: IPostingExecutor =
        (this.financeRepo as any).getPostingExecutor?.() ||
        (this.outboxRepo as any).getPostingExecutor?.() ||
        (this.financeRepo as any).executor;
      if (executor) {
        this.authority = new PostingAuthority(executor);
      } else {
        throw new Error('PostingAuthority ou IPostingExecutor é obrigatório para FinancialTransactionOrchestrator.');
      }
    }
    this.session = postingSession;
  }

  private resolvePostingSession(): PostingSession {
    if (this.session && typeof this.session.isValid === 'function' && this.session.isValid()) {
      return this.session;
    }
    const sessionId = `ps_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    return PostingSession.createAuthorizedSession(PostingCapabilityToken, 'sqlite-transaction', sessionId);
  }

  /**
   * Valida rigorosamente o invariante FIN-001 de partidas dobradas antes da persistência:
   * Para cada ativo: SUM(débitos) === SUM(créditos)
   */
  private validateDoubleEntry(transaction: LedgerTransaction): void {
    const assetBalances = new Map<number, bigint>();

    for (const entry of transaction.entries) {
      const assetId = entry.amount.assetId;
      const current = assetBalances.get(assetId) ?? 0n;
      const delta = entry.type === 'debit' ? entry.amount.amount : -entry.amount.amount;
      assetBalances.set(assetId, current + delta);
    }

    for (const [assetId, netBalance] of assetBalances.entries()) {
      if (netBalance !== 0n) {
        throw new LedgerImbalanceError(
          `Desbalanceamento contábil no ativo #${assetId}: soma dos débitos difere dos créditos (diferença: ${netBalance.toString()}).`
        );
      }
    }
  }

  /**
   * Pré-validação obrigatória de todas as entidades participantes (contas e ativos).
   * Executada ANTES da reivindicação de idempotência e de qualquer escrita no banco de dados.
   */
  private async preValidateEntities(transaction: LedgerTransaction): Promise<void> {
    const accountIds = new Set<number>();
    const assetIds = new Set<number>();

    for (const entry of transaction.entries) {
      const parsedAccId = parsePositiveSafeIntegerId(entry.accountId, 'entry.accountId');
      accountIds.add(parsedAccId);
      assetIds.add(entry.amount.assetId);
    }

    // 1. Validar todos os ativos participantes
    for (const assetId of assetIds) {
      const assetRes = await this.financeRepo.getAssetById(assetId);
      if (assetRes.isFailure) {
        throw new Error(
          assetRes.error || `Ativo financeiro #${assetId} não encontrado.`
        );
      }
      const asset = assetRes.getValue();
      AssetStatusPolicy.validateActive({
        id: asset.id,
        status: asset.status,
        code: asset.code,
      });
    }

    // 2. Validar todas as contas participantes
    for (const accountId of accountIds) {
      const accountRes = await this.financeRepo.getAccountById(accountId);
      if (accountRes.isFailure) {
        throw new Error(
          accountRes.error || `Conta financeira #${accountId} não encontrada.`
        );
      }
      const account = accountRes.getValue();

      AccountStatusPolicy.validateActive({
        id: account.id,
        status: account.status,
        name: account.name,
      });

      if (account.accountClass) {
        AccountClassPolicy.validate(account.accountType, account.accountClass);
      }
    }
  }

  /**
   * Executa o fluxo soberano de escrita no ledger através da fronteira de commit (Gate 0):
   * 1. Invariante FIN-001 e validações sintáticas.
   * 2. Cálculo do Hash Canônico.
   * 3. Reivindicação atômica de Idempotência com fencing token (leaseOwner, leaseGeneration).
   * 4. PRE-POSTING GATE: Pré-validação de entidades ativas.
   * 5. Coleta atômica dos saldos e versões correntes das contas participantes.
   * 6. Compilação do PostingPlan imutável via PostingPlanBuilder (ordenação determinística canônica).
   * 7. Commit atômico soberano via PostingAuthority (batch único com guardas físicas _sql_assertions).
   */
  public async executePosting(
    transaction: LedgerTransaction,
    requestHashOverride?: string
  ): Promise<OrchestratorResult> {
    if (!transaction.entries || transaction.entries.length < 2) {
      throw new InvalidLedgerTransactionError(
        'Invariante do Ledger violado: Uma transação financeira deve conter no mínimo 2 lançamentos contábeis.'
      );
    }

    const hasDebit = transaction.entries.some((e) => e.type === 'debit');
    const hasCredit = transaction.entries.some((e) => e.type === 'credit');
    if (!hasDebit || !hasCredit) {
      throw new InvalidLedgerTransactionError(
        'Invariante do Ledger violado: Uma transação financeira exige no mínimo 1 lançamento de débito e 1 de crédito.'
      );
    }

    for (const entry of transaction.entries) {
      if (entry.amount.amount <= 0n) {
        throw new InvalidLedgerTransactionError(
          `Invariante do Ledger violado: Quantia de lançamento contábil inválida (${entry.amount.amount.toString()}). O valor deve ser estritamente positivo.`
        );
      }
    }

    this.validateDoubleEntry(transaction);

    const computedHash = requestHashOverride || CanonicalRequestHashService.calculateHash(transaction);
    const scope = transaction.scope || 'finance';

    // Fencing P0: Gera leaseOwner único para o trabalhador atual
    const leaseOwner = `worker_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    const claimed = await this.financeRepo.claimIdempotency(
      transaction.idempotencyKey,
      transaction.userId,
      scope,
      computedHash,
      { leaseOwner }
    );

    if (!claimed) {
      const existing = await this.financeRepo.getIdempotencyRecord(transaction.idempotencyKey, scope);
      if (!existing) {
        throw new IdempotencyInProgressError('Conflito de concorrência ao verificar chave de idempotência.');
      }

      if (existing.requestHash === computedHash) {
        if (existing.status === 'completed' && existing.transactionId) {
          return { transactionId: existing.transactionId, isReplayed: true };
        }
        throw new IdempotencyInProgressError();
      } else {
        throw new IdempotencyConflictError();
      }
    }

    try {
      // PRE-POSTING GATE: Pré-validação obrigatória de contas e ativos participantes
      await this.preValidateEntities(transaction);

      // Captura o registro de idempotência ativo para extrair a geração do lease garantida pelo CAS
      const idempRecord = await this.financeRepo.getIdempotencyRecord(transaction.idempotencyKey, scope);
      const leaseGeneration = idempRecord?.leaseGeneration ?? 1;
      const activeLeaseOwner = idempRecord?.leaseOwner ?? leaseOwner;

      // Coleta o estado de contas e saldos para alimentar o compilador do PostingPlan
      const accountMap = new Map<number, { accountClass: any; status: AccountStatus }>();
      const balanceMap = new Map<string, { availableBaseUnits: bigint; version: number }>();

      for (const entry of transaction.entries) {
        const parsedAccId = parsePositiveSafeIntegerId(entry.accountId, 'entry.accountId');
        if (!accountMap.has(parsedAccId)) {
          const accRes = await this.financeRepo.getAccountById(parsedAccId);
          if (accRes.isFailure) {
            throw new Error(accRes.error || `Conta financeira #${parsedAccId} não encontrada.`);
          }
          const acc = accRes.getValue();
          accountMap.set(parsedAccId, {
            accountClass: acc.accountClass,
            status: acc.status as AccountStatus,
          });
        }

        const balKey = `${parsedAccId}:${entry.amount.assetId}`;
        if (!balanceMap.has(balKey)) {
          // Garante a existência materializada do saldo zerado com version 1 antes da leitura OCC
          await (this.financeRepo as any).ensureAccountBalance?.(parsedAccId, entry.amount.assetId);

          const balRes = await this.financeRepo.getAccountBalance(parsedAccId, entry.amount.assetId);
          if (balRes.isSuccess) {
            const bal = balRes.getValue();
            balanceMap.set(balKey, {
              availableBaseUnits: BigInt(bal.availableBaseUnits || '0'),
              version: bal.version,
            });
          } else {
            balanceMap.set(balKey, {
              availableBaseUnits: 0n,
              version: 1,
            });
          }
        }
      }

      // Constrói os lançamentos de entrada para o PostingPlanBuilder
      const legInputs: PostingLegEntryInput[] = transaction.entries.map((entry) => {
        const parsedAccId = parsePositiveSafeIntegerId(entry.accountId, 'entry.accountId');
        const acc = accountMap.get(parsedAccId)!;
        const bal = balanceMap.get(`${parsedAccId}:${entry.amount.assetId}`) || {
          availableBaseUnits: 0n,
          version: 1,
        };

        return {
          accountId: parsedAccId,
          assetId: entry.amount.assetId,
          accountClass: acc.accountClass,
          accountStatus: acc.status,
          direction: entry.type,
          amount: entry.amount.amount,
          description: entry.description || transaction.description,
          currentAvailableBaseUnits: bal.availableBaseUnits,
          currentVersion: bal.version,
        };
      });

      // Decisão de autorização explícita
      let authorizationDecision: AuthorizationDecision;
      if (transaction.actorUserId || transaction.userId) {
        const actorId = transaction.actorUserId ?? transaction.userId!;
        authorizationDecision = {
          allowed: true,
          type: transaction.authorizedByUserId ? 'DELEGATED' : 'SELF',
          actorUserId: actorId,
          authorizedByUserId: (transaction.authorizedByUserId as any) ?? null,
        };
      } else {
        authorizationDecision = {
          allowed: true,
          type: 'SYSTEM',
          actorUserId: null,
          authorizedByUserId: transaction.authorizedByUserId ?? null,
        };
      }

      // Response snapshot
      const responseStatus = 200;
      const responsePayload = JSON.stringify({
        success: true,
        idempotencyKey: transaction.idempotencyKey,
        scope,
      });

      // Compilação do PostingPlan soberano (invariantes, double-entry, ordenação canônica)
      const plan = PostingPlanBuilder.build({
        scope,
        idempotencyKey: transaction.idempotencyKey,
        requestHash: computedHash,
        transactionType: transaction.transactionType ?? 'adjustment',
        category: transaction.category || 'operational',
        description: transaction.description,
        actorUserId: transaction.actorUserId ?? transaction.userId ?? null,
        authorizedByUserId: transaction.authorizedByUserId ?? null,
        sourceType: transaction.sourceType ?? null,
        sourceId: transaction.sourceId ?? null,
        reversalOfTransactionId: transaction.reversalOfTransactionId ?? null,
        refundOfTransactionId: transaction.refundOfTransactionId ?? null,
        correlationId: transaction.correlationId ?? undefined,
        authorizationDecision,
        entries: legInputs,
        leaseOwner: activeLeaseOwner,
        leaseGeneration,
        responseStatus,
        responsePayload,
      });

      // Injeção de hook do outbox se customizado pelo chamador/teste
      if (this.outboxRepo && Object.prototype.hasOwnProperty.call(this.outboxRepo, 'saveEvent')) {
        const domainEvent = new LedgerTransactionPostedEvent(
          plan.transactionId,
          transaction.idempotencyKey,
          computedHash,
          new Date()
        );
        const outboxResult = await this.outboxRepo.saveEvent(
          domainEvent,
          plan.transactionId,
          'LedgerTransaction',
          1
        );
        if (outboxResult && outboxResult.isFailure) {
          throw new Error(String(outboxResult.error));
        }
      }

      // Commit atômico físico via PostingAuthority soberana (Gate 0)
      const session = this.resolvePostingSession();
      const commitResult = await this.authority.commit(plan, session);

      if (commitResult.isFailure) {
        const err = commitResult.typedError || commitResult.error;
        if (typeof err === 'object' && err !== null) {
          throw err;
        }
        throw new Error(String(err));
      }

      return {
        transactionId: plan.transactionId,
        isReplayed: false,
      };
    } catch (err: any) {
      // Falha após o claim: libera ou falha o lease de idempotência para não travar a chave por 24h
      await this.financeRepo
        .failIdempotency(transaction.idempotencyKey, scope, err?.message || 'PRE_POSTING_FAILED')
        .catch(() => {});
      throw err;
    }
  }
}

