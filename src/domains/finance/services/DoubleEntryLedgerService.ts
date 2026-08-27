import { LedgerTransaction } from '../entities/LedgerTransaction';
import { IRepositoryFactory } from '../../../application/ports/output/IUnitOfWork';
import { Result } from '../../../shared/kernel/Result';

export class DoubleEntryLedgerService {
  /**
   * Executes a strict Double-Entry transaction with Idempotency, OCC and Outbox integration.
   *
   * Architecture note: receives IRepositoryFactory directly (passed by the UoW executor),
   * keeping this service free of UoW coupling and testable in isolation.
   */
  async recordTransaction(
    transaction: LedgerTransaction,
    factory: IRepositoryFactory
  ): Promise<Result<void>> {
    try {
      const repo = factory.getFinanceRepository();

      // 1. Domain invariant already enforced by LedgerTransaction constructor:
      //    sum(debits by asset) == sum(credits by asset)
      //    If it didn't balance, constructor would have thrown LedgerImbalanceError.

      // 2. Claim Idempotency-Key (unique constraint at DB level)
      const isIdempotent = await repo.claimIdempotency(transaction.idempotencyKey);
      if (!isIdempotent) {
        return Result.fail('Transação já processada (Idempotency Key Collision).');
      }

      // 3. Insert parent financial_transaction record to obtain real DB-generated ID
      const dbTransactionId = await repo.insertTransaction({
        userId: transaction.userId ?? null,
        type: transaction.transactionType ?? 'adjustment',
        category: 'operational',
        description: transaction.description,
        status: 'completed',
      });

      // 4. Insert immutable Ledger entries linked to the real transaction ID
      await repo.insertLedgerEntries(transaction.entries, dbTransactionId);

      // 5. Update materialized balances with OCC
      for (const entry of transaction.entries) {
        const success = await repo.updateBalanceWithOCC(
          entry.accountId,
          entry.amount.assetId,
          entry.amount.amount,
          entry.type
        );
        if (!success) {
          throw new Error(`Optimistic Concurrency Control (OCC) falhou para a conta ${entry.accountId}.`);
        }
      }

      // 6. Persist Outbox event with real transaction ID
      await repo.persistOutboxEvent('LedgerTransactionCommitted', {
        transactionId: dbTransactionId,
        idempotencyKey: transaction.idempotencyKey,
      });

      return Result.ok();
    } catch (err: any) {
      return Result.fail(`Falha ao registrar transação financeira: ${err.message}`);
    }
  }
}
