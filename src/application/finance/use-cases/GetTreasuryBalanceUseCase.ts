import { IUnitOfWork } from '../../ports/output/IUnitOfWork';
import { Result } from '../../../shared/kernel/Result';
import { AccountBalanceRecord, IFinanceRepository } from '../../ports/output/IFinanceRepository';

/**
 * [BUG-32-01 Fix]
 * Caso de uso estritamente de leitura (CQRS Query) para obter os saldos da Tesouraria.
 * Suporta injeção direta de IFinanceRepository para executar consultas sem bloqueios
 * de escrita desnecessários (evitando BEGIN IMMEDIATE da UnitOfWork em SQLite/Cloudflare D1).
 */
export class GetTreasuryBalanceUseCase {
  private readonly financeRepo?: IFinanceRepository;
  private readonly uow?: IUnitOfWork;

  constructor(repoOrUow: IFinanceRepository | IUnitOfWork) {
    if ('getTreasuryBalance' in repoOrUow && typeof repoOrUow.getTreasuryBalance === 'function') {
      this.financeRepo = repoOrUow;
    } else if ('execute' in repoOrUow && typeof (repoOrUow as IUnitOfWork).execute === 'function') {
      this.uow = repoOrUow as IUnitOfWork;
    } else {
      this.financeRepo = repoOrUow as IFinanceRepository;
    }
  }

  async execute(): Promise<Result<AccountBalanceRecord[]>> {
    if (this.financeRepo) {
      return await this.financeRepo.getTreasuryBalance();
    }
    return await this.uow!.execute(async (factory) => {
      const financeRepo = factory.getFinanceRepository();
      return await financeRepo.getTreasuryBalance();
    });
  }
}
