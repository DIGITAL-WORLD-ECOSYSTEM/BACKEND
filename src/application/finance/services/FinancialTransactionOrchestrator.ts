import { IFinanceRepository } from '../../ports/output/IFinanceRepository';
import { LedgerTransaction } from '../../../domains/finance/entities/LedgerTransaction';
import {
  IdempotencyConflictError,
  IdempotencyInProgressError,
  OptimisticConcurrencyError,
  InsufficientBalanceError,
} from '../../../domains/finance/errors/FinancialError';
import { CanonicalRequestHashService } from './CanonicalRequestHashService';

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
   */
  constructor(private readonly financeRepo: IFinanceRepository) {}

  /**
   * Executa o fluxo atômico de escrita no ledger:
   * 1. Cálculo servidor obrigatório do Hash Canônico do LedgerTransaction (P0-1).
   * 2. Reclamação atômica de Idempotência.
   * 3. Inserção do registro pai da transação financeira em 'processing'.
   * 4. Inserção dos lançamentos contábeis imutáveis.
   * 5. Agregação de deltas de saldo por (accountId, assetId) e atualização com OCC e switch exaustivo (P0-2).
   * 6. Transição de status para 'completed'.
   * 7. Registro de evento no Outbox.
   * 8. Conclusão da Idempotência.
   */
  public async executePosting(
    transaction: LedgerTransaction
  ): Promise<OrchestratorResult> {
    // P0-1: O Hash de idempotência é obrigatoriamente derivado pelo servidor a partir do aggregate
    const computedHash = CanonicalRequestHashService.calculateHash(transaction);

    // 1. Claim Idempotency Key
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

    // 2. Insert transaction record (status = 'processing')
    const transactionId = await this.financeRepo.insertTransaction({
      userId: transaction.userId ?? null,
      type: transaction.transactionType ?? 'adjustment',
      category: transaction.category || 'operational',
      description: transaction.description,
      status: 'processing',
      reversalOfTransactionId: transaction.reversalOfTransactionId,
      refundOfTransactionId: transaction.refundOfTransactionId,
    });

    // 3. Insert immutable ledger entries
    await this.financeRepo.insertLedgerEntries(transaction.entries, transactionId);

    // 4. Agregação de deltas de saldo por (accountId, assetId) antes das atualizações OCC
    const balanceDeltas = new Map<string, { accountId: string; assetId: number; netDelta: bigint }>();

    for (const entry of transaction.entries) {
      const assetIdNum = Number(entry.amount.assetId);
      const key = `${entry.accountId}:${assetIdNum}`;
      const current = balanceDeltas.get(key) || { accountId: entry.accountId, assetId: assetIdNum, netDelta: 0n };

      const change = entry.type === 'debit' ? entry.amount.amount : -entry.amount.amount;
      current.netDelta += change;
      balanceDeltas.set(key, current);
    }

    for (const { accountId, assetId, netDelta } of balanceDeltas.values()) {
      if (netDelta === 0n) continue;

      const type: 'debit' | 'credit' = netDelta > 0n ? 'debit' : 'credit';
      const absAmount = netDelta > 0n ? netDelta : -netDelta;

      const updateResult = await this.financeRepo.updateBalanceWithOCC(
        accountId,
        assetId,
        absAmount,
        type
      );

      switch (updateResult) {
        case 'UPDATED':
          break;
        case 'INSUFFICIENT_BALANCE':
          throw new InsufficientBalanceError(
            `saldo insuficiente para a conta #${accountId} e ativo #${assetId}.`
          );
        case 'OCC_CONFLICT':
          throw new OptimisticConcurrencyError(
            `Falha de concorrência otimista (OCC version mismatch) para a conta #${accountId}.`
          );
        default:
          assertNever(updateResult);
      }
    }

    // 5. Update transaction status to 'completed'
    await this.financeRepo.updateTransactionStatus(transactionId, 'completed');

    // 6. Persist Outbox Event
    await this.financeRepo.persistOutboxEvent('LedgerTransactionCommitted', {
      transactionId,
      idempotencyKey: transaction.idempotencyKey,
      requestHash: computedHash,
    });

    // 7. Complete Idempotency record
    await this.financeRepo.completeIdempotency(transaction.idempotencyKey, 'finance', transactionId);

    return { transactionId, isReplayed: false };
  }
}
