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

export class FinancialTransactionOrchestrator {
  constructor(private readonly financeRepo: IFinanceRepository) {}

  /**
   * Executa o fluxo atômico de escrita no ledger:
   * 1. Reclamação atômica de Idempotência.
   * 2. Inserção do registro pai da transação financeira em 'processing'.
   * 3. Inserção dos lançamentos contábeis imutáveis.
   * 4. Atualização dos saldos materializados com OCC (Optimistic Concurrency Control).
   * 5. Transição de status para 'completed'.
   * 6. Registro de evento no Outbox.
   * 7. Conclusão da Idempotência.
   */
  public async executePosting(
    transaction: LedgerTransaction,
    requestHash?: string
  ): Promise<OrchestratorResult> {
    const computedHash = requestHash || CanonicalRequestHashService.calculateHash(transaction);

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

    // 4. Update materialized balances with OCC
    for (const entry of transaction.entries) {
      const success = await this.financeRepo.updateBalanceWithOCC(
        entry.accountId,
        String(entry.amount.assetId),
        entry.amount.amount,
        entry.type
      );

      if (!success) {
        throw new OptimisticConcurrencyError(
          `Falha de concorrência ou saldo insuficiente para a conta #${entry.accountId}.`
        );
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
