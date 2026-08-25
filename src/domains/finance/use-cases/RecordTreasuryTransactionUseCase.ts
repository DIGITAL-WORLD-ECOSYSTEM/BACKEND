import { IUnitOfWork } from '../../../application/ports/output/IUnitOfWork';
import { Result } from '../../../shared/kernel/Result';
import { FinancialTransactionRecord } from '../../../application/ports/output/IFinanceRepository';

export interface RecordTreasuryTransactionDTO {
  userId?: number | null;
  type: 'deposit' | 'withdrawal' | 'transfer' | 'payment' | 'refund' | 'fee' | 'reward' | 'yield' | 'conversion' | 'adjustment';
  category?: string;
  description: string;
  amountBaseUnits: string;
  assetId?: number;
}

export class RecordTreasuryTransactionUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(dto: RecordTreasuryTransactionDTO): Promise<Result<FinancialTransactionRecord>> {
    if (!dto.description || !dto.amountBaseUnits) {
      return Result.fail<FinancialTransactionRecord>('Descrição e valor são obrigatórios.');
    }

    return await this.uow.execute(async (factory) => {
      const financeRepo = factory.getFinanceRepository();
      return await financeRepo.createTransaction({
        userId: dto.userId || null,
        type: dto.type,
        category: dto.category || 'operational',
        description: dto.description,
        amountBaseUnits: dto.amountBaseUnits,
        assetId: dto.assetId || 1, // 1 = BRL / Native asset
      });
    });
  }
}
