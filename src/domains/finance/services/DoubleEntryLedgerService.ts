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
    factory: IRepositoryFactory,
    requestHash: string
  ): Promise<Result<{ transactionId?: number; isReplayed: boolean }>> {
    try {
      const repo = factory.getFinanceRepository();

      // 1. Idempotency Atomic Claim
      // Tenta inserir a chave no banco. Se tiver concorrência, o BD garante UNIQUE(scope, key).
      const claimed = await repo.claimIdempotency(
        transaction.idempotencyKey, 
        transaction.userId, 
        'finance', 
        requestHash
      );

      if (!claimed) {
        // Alguém já tem a chave, então vamos buscar o registro
        const existingIdem = await repo.getIdempotencyRecord(transaction.idempotencyKey, 'finance');
        if (!existingIdem) {
          return Result.fail('Erro interno de concorrência na chave de idempotência.');
        }

        if (existingIdem.requestHash === requestHash) {
          if (existingIdem.status === 'completed') {
            // Retry seguro de uma transação concluída com o mesmo hash - Ok!
            return Result.ok({ transactionId: existingIdem.transactionId, isReplayed: true });
          } else {
            // Em processamento, retornar conflito para cliente não retryar no vazio
            return Result.fail('Transação em andamento (Idempotency Key Processing).');
          }
        } else {
          return Result.fail('409 Conflict: Mesma Idempotency Key, mas payload (requestHash) diferente.');
        }
      }

      // 2. Insert parent financial_transaction record as 'processing'
      const dbTransactionId = await repo.insertTransaction({
        userId: transaction.userId ?? null,
        type: transaction.transactionType ?? 'adjustment',
        category: transaction.category || 'operational',
        description: transaction.description,
        status: 'processing', // Inicialmente processing
      });

      // 3. Insert immutable Ledger entries linked to the real transaction ID
      await repo.insertLedgerEntries(transaction.entries, dbTransactionId);

      // 4. Update materialized balances with OCC
      for (const entry of transaction.entries) {
        const success = await repo.updateBalanceWithOCC(
          entry.accountId,
          entry.amount.assetId,
          entry.amount.amount,
          entry.type
        );
        if (!success) {
          throw new Error(`Saldo insuficiente ou Optimistic Concurrency Control (OCC) falhou para a conta ${entry.accountId}.`);
        }
      }

      // 5. Update transaction status to completed
      await repo.updateTransactionStatus(dbTransactionId, 'completed');

      // 6. Persist Outbox event with real transaction ID
      await repo.persistOutboxEvent('LedgerTransactionCommitted', {
        transactionId: dbTransactionId,
        idempotencyKey: transaction.idempotencyKey,
      });

      // 7. Complete idempotency
      await repo.completeIdempotency(transaction.idempotencyKey, 'finance', dbTransactionId);

      return Result.ok({ transactionId: dbTransactionId, isReplayed: false });
    } catch (err: any) {
      // Se qualquer etapa falhar (ex: Saldo Insuficiente), uma exception é propagada para o UoW.
      // O UoW fará ROLLBACK INTEGRAL de todas as queries deste callback,
      // revertendo balances, deletando a idempotencyKey inserida (liberando-a para retry seguro)
      // e removendo a financial_transaction.
      return Result.fail(`Falha ao registrar transação financeira: ${err.message}`);
    }
  }
}
