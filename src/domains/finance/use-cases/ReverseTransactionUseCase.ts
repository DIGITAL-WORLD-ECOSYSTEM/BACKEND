import { IUnitOfWork } from '../../../application/ports/output/IUnitOfWork';
import { Result } from '../../../shared/kernel/Result';
import { LedgerTransaction, LedgerEntry } from '../entities/LedgerTransaction';
import { Money } from '../entities/Money';
import { DoubleEntryLedgerService } from '../services/DoubleEntryLedgerService';

export interface ReverseTransactionInput {
  originalTransactionId: number;
  idempotencyKey: string;
  reason: string;
  requestHash: string;
}

export class ReverseTransactionUseCase {
  constructor(
    private readonly uow: IUnitOfWork,
    private readonly ledgerService: DoubleEntryLedgerService
  ) {}

  async execute(input: ReverseTransactionInput): Promise<Result<{ transactionId?: number; isReplayed: boolean }>> {
    return await this.uow.execute(async (factory) => {
      const financeRepo = factory.getFinanceRepository();

      // 1. Buscar lançamentos da transação original
      const originalEntriesRes = await financeRepo.getTransactionEntries(input.originalTransactionId);
      if (originalEntriesRes.isFailure) {
        return Result.fail(`Transação original ${input.originalTransactionId} não encontrada: ${originalEntriesRes.error}`);
      }

      const originalEntries = originalEntriesRes.getValue();
      if (!originalEntries || originalEntries.length === 0) {
        return Result.fail(`Transação original ${input.originalTransactionId} não possui lançamentos contábeis.`);
      }

      // 2. Construir lançamentos espelho invertidos (debit <-> credit)
      const reverseEntries: LedgerEntry[] = originalEntries.map((e) => {
        const invertedType = e.direction === 'debit' ? 'credit' : 'debit';
        const amountBigInt = BigInt(e.amountBaseUnits);
        return new LedgerEntry({
          accountId: String(e.accountId),
          amount: new Money(amountBigInt, String(e.assetId)),
          type: invertedType,
          description: `Estorno de TX #${input.originalTransactionId}: ${input.reason}`,
        });
      });

      // 3. Instanciar transação de estorno contábil (reversal)
      const reversalTx = new LedgerTransaction({
        idempotencyKey: input.idempotencyKey,
        description: `Estorno da Transação #${input.originalTransactionId}: ${input.reason}`,
        entries: reverseEntries,
        transactionType: 'reversal',
      });

      // 4. Executar orquestração via Ledger Service (garantindo OCC, idempotência e outbox)
      return await this.ledgerService.recordTransaction(reversalTx, factory, input.requestHash);
    });
  }
}
