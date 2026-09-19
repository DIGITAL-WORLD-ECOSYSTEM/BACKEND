import { IFinanceRepository } from '../../ports/output/IFinanceRepository';
import { IOutboxRepository } from '../../ports/output/IOutboxRepository';
import { IDomainEvent } from '../../../shared/kernel/DomainEvent';
import { LedgerTransaction } from '../../../domains/finance/entities/LedgerTransaction';
import {
  IdempotencyConflictError,
  IdempotencyInProgressError,
  OptimisticConcurrencyError,
  InsufficientBalanceError,
  InvalidLedgerTransactionError,
  InvalidStateTransitionError,
} from '../../../domains/finance/errors/FinancialError';
import { LedgerImbalanceError } from '../../../domains/finance/errors/LedgerImbalanceError';
import { CanonicalRequestHashService } from './CanonicalRequestHashService';
import { AccountStatusPolicy } from '../../../domains/finance/policies/AccountStatusPolicy';
import { AssetStatusPolicy } from '../../../domains/finance/policies/AssetStatusPolicy';
import { AccountClassPolicy } from '../../../domains/finance/policies/AccountClassPolicy';
import { FinancialTransactionStateMachine } from '../../../domains/finance/services/FinancialTransactionStateMachine';
import { parsePositiveSafeIntegerId } from '../../../domains/finance/value-objects/Money256';

export interface OrchestratorResult {
  transactionId: number;
  isReplayed: boolean;
}

function assertNever(value: never): never {
  throw new Error(`Unhandled BalanceUpdateResult case: ${value}`);
}

export class FinancialTransactionOrchestrator {
  /**
   * O Orchestrator exige um repositório transacional vinculado ao Unit of Work (BEGIN IMMEDIATE).
   * Ele atua como a Autoridade Física Central de escrita no ledger financeiro.
   *
   * Todas as etapas de persistência (Claim Idempotency, Insert Transaction, Insert Entries, OCC Balance Updates,
   * Outbox Event e Complete Idempotency) ocorrem obrigatoriamente dentro do mesmo boundary transacional do banco.
   */
  constructor(
    private readonly financeRepo: IFinanceRepository,
    private readonly outboxRepo: IOutboxRepository
  ) {
    if (!outboxRepo) {
      throw new Error('IOutboxRepository é obrigatório para execução atômica no FinancialTransactionOrchestrator.');
    }
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
   *
   * Garante que:
   * 1. Todos os ativos únicos existem e estão 'active' (AssetStatusPolicy).
   * 2. Todas as contas únicas existem e estão 'active' (AccountStatusPolicy).
   * 3. Todas as contas possuem classificação contábil compatível com seu tipo (AccountClassPolicy).
   *
   * Como é executada sobre o conjunto de IDs únicos da transação, elimina a brecha
   * do delta zero (onde debitSum === creditSum fazia o OCC pular a validação da conta).
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

      // Validação de status operacional: pode movimentar?
      AccountStatusPolicy.validateActive({
        id: account.id,
        status: account.status,
        name: account.name,
      });

      // Validação de classe contábil: classificação compatível?
      if (account.accountClass) {
        AccountClassPolicy.validate(account.accountType, account.accountClass);
      }
    }
  }

  /**
   * Executa o fluxo atômico de escrita no ledger:
   * 0. Validação estrita do invariante do Ledger (mínimo 2 lançamentos, ao menos 1 débito e 1 crédito, e balanço nulo).
   * 1. PRE-POSTING GATE: Pré-validação de todas as contas e ativos participantes (elimina bypass de delta-zero).
   * 2. Validação da transição de estado da transação: pending -> processing via State Machine.
   * 3. Cálculo do Hash Canônico do payload financeiro.
   * 4. Reclamação atômica de Idempotência.
   * 5. Inserção do registro da transação financeira em 'processing'.
   * 6. Inserção dos lançamentos contábeis imutáveis.
   * 7. Atualização dos saldos materializados via OCC com ordenação determinística por (accountId, assetId).
   * 8. Transição de status para 'completed' via State Machine.
   * 9. Registro de evento no Outbox.
   * 10. Conclusão da Idempotência.
   */
  public async executePosting(
    transaction: LedgerTransaction,
    requestHashOverride?: string
  ): Promise<OrchestratorResult> {
    // Invariante FIN-001: Validação do número mínimo de lançamentos
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

    // Invariante: Todas as quantias de lançamentos contábeis devem ser estritamente maiores que zero (> 0)
    for (const entry of transaction.entries) {
      if (entry.amount.amount <= 0n) {
        throw new InvalidLedgerTransactionError(
          `Invariante do Ledger violado: Quantia de lançamento contábil inválida (${entry.amount.amount.toString()}). O valor deve ser estritamente positivo.`
        );
      }
    }

    this.validateDoubleEntry(transaction);

    // 1. PRE-POSTING GATE: Pré-validação obrigatória de entidades (elimina brecha do delta zero)
    await this.preValidateEntities(transaction);

    // 2. State Machine: validação da transição inicial para 'processing'
    const processingTransition = FinancialTransactionStateMachine.transition(
      transaction.status,
      'processing'
    );
    if (processingTransition.isFailure) {
      throw new InvalidStateTransitionError(
        processingTransition.error || 'Transição de estado para processing inválida.'
      );
    }
    const processingStatus = processingTransition.getValue();

    // 3. Hash canônico calculado pelo servidor (ou override fornecido para testes)
    const computedHash = requestHashOverride || CanonicalRequestHashService.calculateHash(transaction);

    // 4. Claim Idempotency Key
    const claimed = await this.financeRepo.claimIdempotency(
      transaction.idempotencyKey,
      transaction.userId,
      'finance',
      computedHash
    );

    if (!claimed) {
      const existing = await this.financeRepo.getIdempotencyRecord(transaction.idempotencyKey, 'finance');
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

    // 5. Inserção do registro pai da transação com o status derivado da State Machine
    const txResult = await this.financeRepo.insertTransaction({
      userId: transaction.userId ?? null,
      type: transaction.transactionType ?? 'adjustment',
      category: transaction.category || 'operational',
      description: transaction.description,
      status: processingStatus,
      reversalOfTransactionId: transaction.reversalOfTransactionId,
      refundOfTransactionId: transaction.refundOfTransactionId,
    });
    if (txResult.isFailure) {
      throw new Error(txResult.typedError?.message || txResult.error || 'Falha ao inserir registro de transação financeira.');
    }
    const transactionId = txResult.getValue();

    // 6. Inserção dos lançamentos contábeis imutáveis
    const entriesResult = await this.financeRepo.insertLedgerEntries(transaction.entries, transactionId);
    if (entriesResult.isFailure) {
      throw new Error(entriesResult.typedError?.message || entriesResult.error || 'Falha ao inserir lançamentos contábeis.');
    }

    // 7. Consolidação e agregação de saldos por (accountId, assetId) para evitar falhas de saldo intermediário (intra-transaction) e otimizar I/O.
    interface AccountAssetKey {
      accountId: string;
      assetId: number;
      debitSum: bigint;
      creditSum: bigint;
    }

    const aggregatedMap = new Map<string, AccountAssetKey>();

    for (const entry of transaction.entries) {
      const key = `${entry.accountId}:${entry.amount.assetId}`;
      const existing = aggregatedMap.get(key) || {
        accountId: entry.accountId,
        assetId: entry.amount.assetId,
        debitSum: 0n,
        creditSum: 0n,
      };

      if (entry.type === 'debit') {
        existing.debitSum += entry.amount.amount;
      } else {
        existing.creditSum += entry.amount.amount;
      }
      aggregatedMap.set(key, existing);
    }

    // Ordenação determinística de execução por (accountId, assetId) para prevenção de lock contention / deadlock em operações concorrentes.
    const sortedDeltas = Array.from(aggregatedMap.values()).sort((a, b) => {
      if (a.accountId !== b.accountId) {
        return a.accountId < b.accountId ? -1 : 1;
      }
      return a.assetId < b.assetId ? -1 : a.assetId > b.assetId ? 1 : 0;
    });

    // 8. Execução do OCC de saldos apenas para deltas líquidos não-nulos (contas já pré-validadas na etapa 1)
    for (const delta of sortedDeltas) {
      if (delta.debitSum === delta.creditSum) {
        continue; // Débitos e créditos idênticos na mesma conta cancelam-se com variação nula de saldo
      }

      const isNetDebit = delta.debitSum > delta.creditSum;
      const netAmount = isNetDebit
        ? delta.debitSum - delta.creditSum
        : delta.creditSum - delta.debitSum;
      const netType: 'debit' | 'credit' = isNetDebit ? 'debit' : 'credit';

      const updateResult = await this.financeRepo.updateBalanceWithOCC(
        delta.accountId,
        delta.assetId,
        netAmount,
        netType
      );

      switch (updateResult) {
        case 'UPDATED':
          break;
        case 'INSUFFICIENT_BALANCE':
          throw new InsufficientBalanceError(
            `saldo insuficiente para a conta #${delta.accountId} e ativo #${delta.assetId}.`
          );
        case 'OCC_CONFLICT':
          throw new OptimisticConcurrencyError(
            `Falha de concorrência otimista (OCC version mismatch) para a conta #${delta.accountId}.`
          );
        default:
          assertNever(updateResult);
      }
    }

    // 9. State Machine: validação da transição para 'completed'
    const completedTransition = FinancialTransactionStateMachine.transition(
      processingStatus,
      'completed'
    );
    if (completedTransition.isFailure) {
      throw new InvalidStateTransitionError(
        completedTransition.error || 'Transição de estado para completed inválida.'
      );
    }
    const completedStatus = completedTransition.getValue();

    // 10. Atualização do status da transação para 'completed'
    await this.financeRepo.updateTransactionStatus(transactionId, completedStatus);

    // 11. Persistência de Evento no Outbox
    await this.outboxRepo.saveEvent(
      {
        dateTimeOccurred: new Date(),
        getAggregateId: () => String(transactionId),
        transactionId,
        idempotencyKey: transaction.idempotencyKey,
        requestHash: computedHash,
      } as IDomainEvent,
      transactionId,
      'LedgerTransaction',
      1
    );

    // 12. Conclusão do registro de Idempotência
    await this.financeRepo.completeIdempotency(transaction.idempotencyKey, 'finance', transactionId);

    return { transactionId, isReplayed: false };
  }
}
