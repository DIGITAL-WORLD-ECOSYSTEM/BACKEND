import { IUnitOfWork, IRepositoryFactory } from '../../application/ports/output/IUnitOfWork';
import { IUserRepository } from '../../application/ports/output/IUserRepository';
import { IAuthenticationRepository } from '../../application/ports/output/IAuthenticationRepository';
import { IWeb3Repository } from '../../application/ports/output/IWeb3Repository';
import { ICivilIdentityRepository } from '../../application/ports/output/ICivilIdentityRepository';
import { ISessionRepository } from '../../application/ports/output/ISessionRepository';

import { DrizzleUserRepositoryAdapter } from '../repositories/DrizzleUserRepositoryAdapter';
import { DrizzleAuthenticationRepositoryAdapter } from '../repositories/DrizzleAuthenticationRepositoryAdapter';
import { DrizzleWeb3RepositoryAdapter } from '../repositories/DrizzleWeb3RepositoryAdapter';
import { DrizzleCivilIdentityRepositoryAdapter } from '../repositories/DrizzleCivilIdentityRepositoryAdapter';
import { DrizzleSessionRepository } from './DrizzleSessionRepository';
import { Result } from '../../shared/kernel/Result';

class DrizzleRepositoryFactory implements IRepositoryFactory {
  constructor(private tx: any) {}

  getUserRepository(): IUserRepository {
    return new DrizzleUserRepositoryAdapter(this.tx);
  }

  getAuthenticationRepository(): IAuthenticationRepository {
    return new DrizzleAuthenticationRepositoryAdapter(this.tx);
  }

  getWeb3Repository(): IWeb3Repository {
    return new DrizzleWeb3RepositoryAdapter(this.tx);
  }

  getSessionRepository(): ISessionRepository {
    return new DrizzleSessionRepository(this.tx);
  }

  getCivilIdentityRepository(): ICivilIdentityRepository {
    return new DrizzleCivilIdentityRepositoryAdapter(this.tx);
  }
}

export class DrizzleUnitOfWork implements IUnitOfWork {
  constructor(private db: any) {}

  async execute<T>(work: (factory: IRepositoryFactory) => Promise<Result<T>>): Promise<Result<T>> {
    if (typeof this.db?.transaction === 'function') {
      let result: Result<T> | null = null;
      let workStarted = false;
      try {
        await this.db.transaction(async (tx: any) => {
          workStarted = true;
          const factory = new DrizzleRepositoryFactory(tx);
          result = await work(factory);

          if (result && result.isFailure && typeof tx.rollback === 'function') {
            tx.rollback();
          }
        });
        if (result) return result;
      } catch (err: any) {
        const errorMsg = err?.message || err?.toString() || '';
        if (!workStarted || errorMsg.toLowerCase().includes('begin') || errorMsg.includes('not supported by D1 driver')) {
          const factory = new DrizzleRepositoryFactory(this.db);
          return await work(factory);
        }
        const failureResult = result as Result<T> | null;
        if (failureResult && failureResult.isFailure) {
          return failureResult;
        }
        return Result.fail(errorMsg || 'Transaction aborted');
      }
    }

    const factory = new DrizzleRepositoryFactory(this.db);
    return await work(factory);
  }
}
