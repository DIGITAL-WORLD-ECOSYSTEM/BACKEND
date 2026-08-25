import { IUnitOfWork } from '../../../application/ports/output/IUnitOfWork';
import { Result } from '../../../shared/kernel/Result';
import { AccountBalanceRecord } from '../../../application/ports/output/IFinanceRepository';

export class GetTreasuryBalanceUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(): Promise<Result<AccountBalanceRecord[]>> {
    return await this.uow.execute(async (factory) => {
      const financeRepo = factory.getFinanceRepository();
      return await financeRepo.getTreasuryBalance();
    });
  }
}
