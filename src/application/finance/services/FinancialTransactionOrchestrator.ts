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
import { PostingSession } from '../../../domains/finance/contracts/PostingSession';
import { IPostingExecutor } from '../../ports/output/IPostingExecutor';
import {
  CustodyAuthorizationPolicy,
  AuthorizationDecision,
  AuthorizationContext,
} from '../../../domains/finance/contracts/AuthorizationContext';

export interface OrchestratorResult {
  transactionId: number;
  isReplayed: boolean;
}

export class FinancialTransactionOrchestrator {
  private readonly authority: PostingAuthority;
  private readonly session?: PostingSession;

  /**
   * O FinancialTransactionOrchestrator atua como a Autoridade Central de escrita no ledger financeiro.
   * Ele compila a intenção contábil via PostingPlanBuilder e despacha a mutação física
   * atômica através da PostingAuthority soberana (Gate 0).
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
      const auth =
        (this.financeRepo as any).getPostingAuthority?.() ||
        (this.outboxRepo as any).getPostingAuthority?.();
      if (auth) {
        this.authority = auth;
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
    }
    this.session =
      postingSession ||
      (this.financeRepo as any).getPostingSession?.() ||
      (this.outboxRepo as any).getPostingSession?.();
  }

  private resolvePostingSession(): PostingSession {
    if (this.session && typeof this.session.isValid === 'function' && this.session.isValid()) {
      return this.session;
    }
    const sessionFromRepo =
      (this.financeRepo as any).getPostingSession?.() ||
      (this.outboxRepo as any).getPostingSession?.();
    if (sessionFromRepo && typeof sessionFromRepo.isValid === 'function' && sessionFromRepo.isValid()) {
      return sessionFromRepo;
    }
    throw new Error(
      'PostingSession soberana não disponível. A execução contábil deve ser realizada sob a fronteira transacional da Unit of Work.'
    );
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
   * 2. Cálculo do Hash Canônico Soberano do Servidor (CanonicalRequestHashService).
   * 3. Reivindicação atômica de Idempotência com fencing token retido imutavelmente (P0-01 / P0-A).
   * 4. PRE-POSTING GATE: Pré-validação de entidades ativas.
   * 5. Coleta atômica dos saldos e versões correntes das contas participantes.
   * 6. Avaliação Soberana de Custódia via CustodyAuthorizationPolicy (P0-10, P0-H).
   * 7. Compilação do PostingPlan imutável e autenticado via PostingPlanBuilder.
   * 8. Commit atômico soberano via PostingAuthority (batch único com outbox e guardas físicas _sql_assertions).
   */
  public async executePosting(
    transaction: LedgerTransaction,
    authContext?: AuthorizationContext
  ): Promise<OrchestratorResult> {
    return this._executePostingInternal(transaction, undefined, authContext);
  }

  /**
   * @internal Test Seam exclusivamente para testes que injetam hash divergente para validação de conflito 409.
   * Não faz parte da assinatura operacional de produção (P0-F).
   */
  public async executePostingForTesting(
    transaction: LedgerTransaction,
    testRequestHashOverride?: string,
    authContext?: AuthorizationContext
  ): Promise<OrchestratorResult> {
    return this._executePostingInternal(transaction, testRequestHashOverride, authContext);
  }

  private async _executePostingInternal(
    transaction: LedgerTransaction,
    testRequestHashOverride?: string,
    authContext?: AuthorizationContext
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

    // Hash Canônico Soberano do Servidor (P0-F)
    const computedHash = testRequestHashOverride || CanonicalRequestHashService.calculateHash(transaction);
    const scope = transaction.scope || 'finance';

    // Fencing P0: Gera leaseOwner único para o trabalhador atual
    const leaseOwner = `worker_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    const claimRes = await this.financeRepo.claimIdempotency(
      transaction.idempotencyKey,
      transaction.userId,
      scope,
      computedHash,
      { leaseOwner }
    );

    if (!claimRes.claimed) {
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

    // Fencing Token Imutável conquistado legitimamente pelo CAS:
    // O worker guarda este valor para sempre nesta execução e NUNCA relê o banco para adotar a identidade de terceiros (P0-01 / P0-A).
    const activeLeaseOwner = claimRes.leaseOwner;
    const leaseGeneration = claimRes.leaseGeneration;

    try {
      // PRE-POSTING GATE: Pré-validação obrigatória de contas e ativos participantes
      await this.preValidateEntities(transaction);

      // Coleta o estado de contas e saldos para alimentar o compilador do PostingPlan
      const accountMap = new Map<number, { accountClass: any; status: AccountStatus; userId: number | null }>();
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
            userId: acc.userId ?? null,
          });
        }

        const balKey = `${parsedAccId}:${entry.amount.assetId}`;
        if (!balanceMap.has(balKey)) {
          const balRes = await this.financeRepo.getAccountBalance(parsedAccId, entry.amount.assetId);
          if (balRes.isFailure) {
            throw new Error(
              balRes.error || `Saldo não encontrado para conta #${parsedAccId} e ativo #${entry.amount.assetId}.`
            );
          }
          const bal = balRes.getValue();
          balanceMap.set(balKey, {
            availableBaseUnits: BigInt(bal.availableBaseUnits),
            version: bal.version,
          });
        }
      }

      // Preparação das pernas para o builder
      const legInputs: PostingLegEntryInput[] = transaction.entries.map((entry) => {
        const parsedAccId = parsePositiveSafeIntegerId(entry.accountId, 'entry.accountId');
        const acc = accountMap.get(parsedAccId)!;
        const balKey = `${parsedAccId}:${entry.amount.assetId}`;
        const bal = balanceMap.get(balKey)!;

        return {
          accountId: parsedAccId,
          assetId: entry.amount.assetId,
          accountClass: acc.accountClass,
          accountStatus: acc.status,
          direction: entry.type as 'debit' | 'credit',
          amount: entry.amount.amount,
          description: entry.description || transaction.description,
          currentAvailableBaseUnits: bal.availableBaseUnits,
          currentVersion: bal.version,
        };
      });

      // Avaliação Soberana de Custódia (P0-10, P0-H)
      const debitEntries = transaction.entries.filter((e) => e.type === 'debit');
      let authorizationDecision: AuthorizationDecision;

      if (debitEntries.length > 0) {
        const firstDebit = debitEntries[0];
        const debitAccId = parsePositiveSafeIntegerId(firstDebit.accountId, 'debit.accountId');
        const acc = accountMap.get(debitAccId)!;
        const actorId = transaction.actorUserId ?? transaction.userId ?? 0;
        const isSystemAccount = acc.userId === null;
        const isOperational =
          transaction.transactionType === 'reversal' ||
          transaction.transactionType === 'refund' ||
          transaction.transactionType === 'fee' ||
          transaction.transactionType === 'reward' ||
          transaction.transactionType === 'yield' ||
          transaction.transactionType === 'adjustment' ||
          transaction.category === 'operational' ||
          transaction.category === 'fee' ||
          transaction.category === 'system';

        const effectiveAuthCtx: AuthorizationContext = authContext || {
          principalId: actorId,
          principalType: (isSystemAccount || isOperational || actorId === 0 ? 'system' : 'user') as any,
          capabilities: [
            ...(isSystemAccount || isOperational ? ['finance.system.operate', 'finance.system.reversal'] : []),
            ...(transaction.authorizedByUserId || isOperational
              ? ['finance.delegate.operate', 'finance.transfer.delegate', 'finance.system.operate']
              : []),
          ],
          delegatedForUserId: acc.userId ?? null,
          correlationId: transaction.correlationId || transaction.idempotencyKey,
        };

        const spec = {
          operationType: (transaction.transactionType as any) || 'transfer',
          sourceAccountId: debitAccId,
          sourceAccountOwnerId: acc.userId ?? null,
          assetId: firstDebit.amount.assetId,
          amountBaseUnits: firstDebit.amount.amount,
        };

        authorizationDecision = CustodyAuthorizationPolicy.canDebitSourceAccount(effectiveAuthCtx, spec);
      } else {
        authorizationDecision = {
          allowed: true,
          reason: 'Operação sem lançamentos a débito (isenta de custódia).',
        };
      }

      if (!authorizationDecision.allowed) {
        throw new Error(`Custody Authorization Denied: ${authorizationDecision.reason}`);
      }

      const responseStatus = 200;
      const responsePayload = JSON.stringify({
        success: true,
        idempotencyKey: transaction.idempotencyKey,
        scope,
      });

      // Compila o PostingPlan imutável, selado e com ordinais canônicos 1..N
      const plan = PostingPlanBuilder.build({
        scope,
        idempotencyKey: transaction.idempotencyKey,
        requestHash: computedHash,
        transactionType: transaction.transactionType || 'transfer',
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

      // Commit atômico físico via PostingAuthority soberana (Gate 0)
      // NOTE (P0-G): Eliminação completa de outboxRepo.saveEvent() prévio. O outbox é persistido no batch do commit.
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
      // Falha após o claim: registra falha no lease de idempotência com fencing estrito (P0-05 / P0-E)
      await this.financeRepo
        .failIdempotency(transaction.idempotencyKey, scope, {
          leaseOwner: activeLeaseOwner,
          leaseGeneration,
          failureCode: err?.message || 'PRE_POSTING_FAILED',
        })
        .catch(() => {});
      throw err;
    }
  }
}
