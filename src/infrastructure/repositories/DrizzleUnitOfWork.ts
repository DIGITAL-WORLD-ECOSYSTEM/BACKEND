import { IUnitOfWork, IRepositoryFactory } from '../../application/ports/output/IUnitOfWork';
import { IUserRepository } from '../../application/ports/output/IUserRepository';
import { IAuthenticationRepository } from '../../application/ports/output/IAuthenticationRepository';
import { IWeb3Repository } from '../../application/ports/output/IWeb3Repository';
import { ICivilIdentityRepository } from '../../application/ports/output/ICivilIdentityRepository';
import { ISessionRepository } from '../../application/ports/output/ISessionRepository';
import { IOutboxRepository } from '../../application/ports/output/IOutboxRepository';
import { IPasswordResetRepository } from '../../application/ports/output/IPasswordResetRepository';

import { DrizzleUserRepositoryAdapter } from '../repositories/DrizzleUserRepositoryAdapter';
import { DrizzleAuthenticationRepositoryAdapter } from '../repositories/DrizzleAuthenticationRepositoryAdapter';
import { DrizzleWeb3RepositoryAdapter } from '../repositories/DrizzleWeb3RepositoryAdapter';
import { DrizzleCivilIdentityRepositoryAdapter } from '../repositories/DrizzleCivilIdentityRepositoryAdapter';
import { DrizzleSessionRepository } from './DrizzleSessionRepository';
import { ISsiRepository } from '../../application/ports/output/ISsiRepository';
import { DrizzleSsiRepository } from './DrizzleSsiRepository';
import { DrizzleOutboxRepository } from './DrizzleOutboxRepository';
import { DrizzlePasswordResetRepository } from './DrizzlePasswordResetRepository';
import { IFinanceRepository } from '../../application/ports/output/IFinanceRepository';
import { DrizzleFinanceRepository, FinanceDatabase, FinanceTransaction } from './DrizzleFinanceRepository';
import { Result } from '../../shared/kernel/Result';
import { IAuthTransactionRepository } from '../../application/ports/output/IAuthTransactionRepository';
import { DrizzleAuthTransactionRepository } from './DrizzleAuthTransactionRepository';
import { isD1Database } from './db_helper';
import { PostingSession } from '../../domains/finance/contracts/PostingSession';
import { IPostingExecutor } from '../../application/ports/output/IPostingExecutor';
import { D1AtomicPostingExecutor } from '../services/D1AtomicPostingExecutor';
import { PostingAuthority } from '../../application/finance/services/PostingAuthority';
import { FinancialError } from '../../domains/finance/errors/FinancialError';

class DrizzleRepositoryFactory implements IRepositoryFactory {
  private _postingExecutor?: IPostingExecutor;

  constructor(
    private readonly tx: FinanceTransaction,
    private readonly db?: FinanceDatabase
  ) {}

  getUserRepository(): IUserRepository {
    return new DrizzleUserRepositoryAdapter((this.tx || this.db) as any);
  }

  getAuthTransactionRepository(): IAuthTransactionRepository {
    return new DrizzleAuthTransactionRepository((this.tx || this.db) as any);
  }

  getAuthenticationRepository(): IAuthenticationRepository {
    return new DrizzleAuthenticationRepositoryAdapter(this.tx as any);
  }

  getWeb3Repository(): IWeb3Repository {
    return new DrizzleWeb3RepositoryAdapter(this.tx as any);
  }

  getSessionRepository(): ISessionRepository {
    return new DrizzleSessionRepository(this.tx as any);
  }

  getCivilIdentityRepository(): ICivilIdentityRepository {
    return new DrizzleCivilIdentityRepositoryAdapter(this.tx as any);
  }

  getSsiRepository(): ISsiRepository {
    return new DrizzleSsiRepository(this.tx as any);
  }

  getOutboxRepository(): IOutboxRepository {
    return new DrizzleOutboxRepository(this.tx as any);
  }

  getPasswordResetRepository(): IPasswordResetRepository {
    return new DrizzlePasswordResetRepository(this.tx as any);
  }

  getFinanceRepository(): IFinanceRepository {
    return new DrizzleFinanceRepository((this.tx || this.db) as any);
  }

  getPostingSession(): PostingSession {
    const isD1 = isD1Database(this.db || this.tx);
    const mode = isD1 ? 'd1-batch' : 'sqlite-transaction';
    const boundaryId = `uow_boundary_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const physicalDb = (this.tx || this.db) as object;
    return new PostingSession(physicalDb, mode, boundaryId);
  }

  getPostingAuthority(): PostingAuthority {
    const physicalDb = (this.tx || this.db) as object;
    return new PostingAuthority(new D1AtomicPostingExecutor(physicalDb));
  }

  getPostingExecutor(): IPostingExecutor {
    if (!this._postingExecutor) {
      this._postingExecutor = new D1AtomicPostingExecutor(this.tx || this.db);
    }
    return this._postingExecutor;
  }
}


export class DrizzleUnitOfWork implements IUnitOfWork {
  constructor(private readonly db: FinanceDatabase) {}

  async execute<T>(work: (factory: IRepositoryFactory) => Promise<Result<T>>): Promise<Result<T>> {
    if (typeof this.db?.transaction === 'function') {
      let result: Result<T> | null = null;
      try {
        await (this.db as any).transaction(
          async (tx: FinanceTransaction) => {
            const factory = new DrizzleRepositoryFactory(tx, this.db);
            result = await work(factory);

            if (result && result.isFailure) {
              if (typeof (tx as any).rollback === 'function') {
                await Promise.resolve((tx as any).rollback()).catch(() => {});
              }
              throw new Error('ROLLBACK_TRIGGERED_BY_RESULT_FAIL');
            }
          },
          { behavior: 'immediate' }
        );
        if (result) return result;
        return Result.fail('Transação concluída sem resultado retornado pelo callback.');
      } catch (err: any) {
        // Se o erro foi gerado intencionalmente por result.isFailure, devolve o Result.fail original
        const resVal = result as (Result<T> | null);
        if (resVal && resVal.isFailure) {
          return resVal;
        }
        if (err?.message === 'ROLLBACK_TRIGGERED_BY_RESULT_FAIL' && resVal && resVal.isFailure) {
          return resVal;
        }
        if (err instanceof FinancialError) {
          return Result.fail(err);
        }
        const errorMessage = err?.message || String(err);
        // Se a callback retornou Result.ok(), mas o COMMIT/banco falhou, DEVE RETORNAR FALHA! (DOD-05)
        return Result.fail(`Falha na transação do banco de dados (Commit/Execution): ${errorMessage}`);
      }
    }

    if (isD1Database(this.db)) {
      throw new Error(
        'DrizzleUnitOfWork exige driver com transações interativas (BEGIN IMMEDIATE). O driver Cloudflare D1 não suporta transações interativas — utilize o D1AtomicPostingExecutor para lotes contábeis atômicos.'
      );
    }

    // BLOCKER FIX: If there is no transaction support, we must FAIL immediately,
    // not fallback to a non-transactional execution.
    throw new Error('Driver de banco de dados atual não suporta transações atômicas (db.transaction is not a function). Operação abortada por segurança.');
  }
}

