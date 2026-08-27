import { IUnitOfWork } from '../../../application/ports/output/IUnitOfWork';
import { Result } from '../../../shared/kernel/Result';
import { DoubleEntryLedgerService } from '../services/DoubleEntryLedgerService';
import { LedgerTransaction, LedgerEntry } from '../entities/LedgerTransaction';
import { Money } from '../entities/Money';

export interface RecordTreasuryTransactionDTO {
  userId?: number | null;
  type: 'deposit' | 'withdrawal' | 'transfer' | 'payment' | 'refund' | 'fee' | 'reward' | 'yield' | 'conversion' | 'adjustment';
  category?: string;
  description: string;
  amountBaseUnits: string;
  assetId?: number;
}

export class RecordTreasuryTransactionUseCase {
  constructor(
    private readonly uow: IUnitOfWork,
    private readonly ledgerService: DoubleEntryLedgerService
  ) {}

  async execute(dto: RecordTreasuryTransactionDTO): Promise<Result<void>> {
    if (!dto.description || !dto.amountBaseUnits) {
      return Result.fail<void>('Descrição e valor são obrigatórios.');
    }

    // Materializa o Value Object
    const amountMoney = new Money(BigInt(dto.amountBaseUnits), String(dto.assetId || 1));

    // Determina logicamente as pontas (Apenas exemplo, regras reais dependem da categoria)
    const systemAccountId = 'treasury-main-account';
    const userAccountId = dto.userId ? `user-acc-${dto.userId}` : 'external-entity';

    let entries: LedgerEntry[] = [];

    if (dto.type === 'deposit') {
      entries.push(new LedgerEntry({ accountId: userAccountId, amount: amountMoney, type: 'credit', description: dto.description }));
      entries.push(new LedgerEntry({ accountId: systemAccountId, amount: amountMoney, type: 'debit', description: 'Treasury receipt' }));
    } else {
      entries.push(new LedgerEntry({ accountId: userAccountId, amount: amountMoney, type: 'debit', description: dto.description }));
      entries.push(new LedgerEntry({ accountId: systemAccountId, amount: amountMoney, type: 'credit', description: 'Treasury release' }));
    }

    // Instancia o agregado. Se a matemática não bater, joga LedgerImbalanceError (Double-Entry Invariant)
    const transaction = new LedgerTransaction({
      idempotencyKey: crypto.randomUUID(), // Para uso real, deve vir do cliente
      description: dto.description,
      entries
    });

    return await this.uow.execute(async (factory) => {
      // Repassa para o Domain Service orquestrar com os Repositórios Corretos (Outbox, Ledger, etc)
      await this.ledgerService.recordTransaction(transaction, factory);
      return Result.ok<void>();
    });
  }
}
