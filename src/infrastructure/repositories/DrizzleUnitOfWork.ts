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
import { ISecureVaultRepository } from '../../application/ports/output/ISecureVaultRepository';
import { DrizzleSecureVaultRepositoryAdapter } from './DrizzleSecureVaultRepositoryAdapter';
import { isD1Database } from './db_helper';
import { PostingSession } from '../../domains/finance/contracts/PostingSession';
import { IPostingExecutor } from '../../application/ports/output/IPostingExecutor';
import { D1AtomicPostingExecutor } from '../services/D1AtomicPostingExecutor';
import { PostingAuthority } from '../../application/finance/services/PostingAuthority';
import { FinancialError } from '../../domains/finance/errors/FinancialError';

class DrizzleRepositoryFactory implements IRepositoryFactory {
  private _postingExecutor?: IPostingExecutor;
  private _postingSession?: PostingSession;
  private _postingAuthority?: PostingAuthority;
  private _userRepo?: IUserRepository;
  private _authTxRepo?: IAuthTransactionRepository;
  private _authRepo?: IAuthenticationRepository;
  private _web3Repo?: IWeb3Repository;
  private _sessionRepo?: ISessionRepository;
  private _civilRepo?: ICivilIdentityRepository;
  private _ssiRepo?: ISsiRepository;
  private _outboxRepo?: IOutboxRepository;
  private _passwordResetRepo?: IPasswordResetRepository;
  private _financeRepo?: IFinanceRepository;
  private _secureVaultRepo?: ISecureVaultRepository;

  constructor(
    private readonly tx: FinanceTransaction,
    private readonly db?: FinanceDatabase
  ) {}

  getUserRepository(): IUserRepository {
    if (!this._userRepo) {
      this._userRepo = new DrizzleUserRepositoryAdapter((this.tx || this.db) as any);
    }
    return this._userRepo;
  }

  getSecureVaultRepository(): ISecureVaultRepository {
    if (!this._secureVaultRepo) {
      this._secureVaultRepo = new DrizzleSecureVaultRepositoryAdapter((this.tx || this.db) as any);
    }
    return this._secureVaultRepo;
  }

  getAuthTransactionRepository(): IAuthTransactionRepository {
    if (!this._authTxRepo) {
      this._authTxRepo = new DrizzleAuthTransactionRepository((this.tx || this.db) as any);
    }
    return this._authTxRepo;
  }

  getAuthenticationRepository(): IAuthenticationRepository {
    if (!this._authRepo) {
      this._authRepo = new DrizzleAuthenticationRepositoryAdapter((this.tx || this.db) as any);
    }
    return this._authRepo;
  }

  getWeb3Repository(): IWeb3Repository {
    if (!this._web3Repo) {
      this._web3Repo = new DrizzleWeb3RepositoryAdapter((this.tx || this.db) as any);
    }
    return this._web3Repo;
  }

  getSessionRepository(): ISessionRepository {
    if (!this._sessionRepo) {
      this._sessionRepo = new DrizzleSessionRepository((this.tx || this.db) as any);
    }
    return this._sessionRepo;
  }

  getCivilIdentityRepository(): ICivilIdentityRepository {
    if (!this._civilRepo) {
      this._civilRepo = new DrizzleCivilIdentityRepositoryAdapter((this.tx || this.db) as any);
    }
    return this._civilRepo;
  }

  getSsiRepository(): ISsiRepository {
    if (!this._ssiRepo) {
      this._ssiRepo = new DrizzleSsiRepository((this.tx || this.db) as any);
    }
    return this._ssiRepo;
  }

  getOutboxRepository(): IOutboxRepository {
    if (!this._outboxRepo) {
      this._outboxRepo = new DrizzleOutboxRepository((this.tx || this.db) as any);
    }
    return this._outboxRepo;
  }

  getPasswordResetRepository(): IPasswordResetRepository {
    if (!this._passwordResetRepo) {
      this._passwordResetRepo = new DrizzlePasswordResetRepository((this.tx || this.db) as any);
    }
    return this._passwordResetRepo;
  }

  getFinanceRepository(): IFinanceRepository {
    if (!this._financeRepo) {
      this._financeRepo = new DrizzleFinanceRepository((this.tx || this.db) as any);
    }
    return this._financeRepo;
  }

  getPostingSession(): PostingSession {
    if (!this._postingSession) {
      const isD1 = isD1Database(this.db || this.tx);
      const mode = isD1 ? 'd1-batch' : 'sqlite-transaction';
      const boundaryToken =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID().replace(/-/g, '').substring(0, 12)
          : Date.now().toString(36);
      const boundaryId = `uow_boundary_${Date.now()}_${boundaryToken}`;
      const physicalDb = (this.tx || this.db) as object;
      this._postingSession = new PostingSession(physicalDb, mode, boundaryId);
    }
    return this._postingSession;
  }

  getPostingAuthority(): PostingAuthority {
    if (!this._postingAuthority) {
      const physicalDb = (this.tx || this.db) as object;
      this._postingAuthority = new PostingAuthority(new D1AtomicPostingExecutor(physicalDb));
    }
    return this._postingAuthority;
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
      // No Cloudflare D1, transações interativas multi-roundtrip (BEGIN IMMEDIATE) não são suportadas pela engine Edge.
      // Executa o workflow sequencialmente sobre a conexão D1 preservando a fábrica de repositórios.
      // Para transações contábeis que exigem garantia física atômica all-or-nothing no D1,
      // deve-se utilizar o D1AtomicPostingExecutor nativo via lote D1.
      try {
        const factory = new DrizzleRepositoryFactory(null as any, this.db);
        const res = await work(factory);
        return res;
      } catch (err: any) {
        if (err instanceof FinancialError) {
          return Result.fail(err);
        }
        return Result.fail(`Falha na execução no Cloudflare D1: ${err?.message || String(err)}`);
      }
    }

    // BLOCKER FIX: If there is no transaction support and not D1, we must FAIL immediately
    throw new Error('Driver de banco de dados atual não suporta transações atômicas (db.transaction is not a function). Operação abortada por segurança.');
  }
}

