import { LedgerTransaction } from '../entities/LedgerTransaction';
import { IUnitOfWork } from '../../../application/ports/output/IUnitOfWork';
import { Result } from '../../../shared/kernel/Result';

export class DoubleEntryLedgerService {
  constructor(private readonly uow: IUnitOfWork) {}

  /**
   * Executes a strict Double-Entry transaction with Idempotency, OCC and Outbox integration.
   */
  async recordTransaction(transaction: LedgerTransaction): Promise<Result<void>> {
    try {
      // 1. O próprio construtor do LedgerTransaction já garante a invariante de Domínio:
      // sum(debits by asset) == sum(credits by asset)
      // Se não batesse, teria lançado Error.

      return await this.uow.execute(async (factory) => {
        const repo = factory.getFinanceRepository();

        // 2. Claim Idempotency-Key
        // A chave de idempotência é garantida no nível do banco.
        const isIdempotent = await repo.claimIdempotency(transaction.idempotencyKey);
        if (!isIdempotent) {
          return Result.fail('Transação já processada (Idempotency Key Collision).');
        }

        // 3. POST immutable Ledger
        await repo.insertLedgerEntries(transaction.entries);

        // 4. Update materialized balances with OCC
        // The repository should implement the OCC update:
        // UPDATE account_balances SET available = available + X, version = version + 1 WHERE account_id = Y AND version = expectedVersion
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

        // 5. Persist Outbox/audit records (delegated to UoW commit interceptor or repository)
        await repo.persistOutboxEvent('LedgerTransactionCommitted', {
          transactionId: transaction.id,
          idempotencyKey: transaction.idempotencyKey
        });

        // 6. COMMIT is done automatically by UoW if no errors are thrown.
        return Result.ok();
      });
    } catch (err: any) {
      return Result.fail(`Falha ao registrar transação financeira: ${err.message}`);
    }
  }
}
