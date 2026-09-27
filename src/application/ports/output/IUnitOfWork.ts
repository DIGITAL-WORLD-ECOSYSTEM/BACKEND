import { Result } from '../../../shared/kernel/Result';
import { IUserRepository } from './IUserRepository';
import { IAuthenticationRepository } from './IAuthenticationRepository';
import { IWeb3Repository } from './IWeb3Repository';
import { ICivilIdentityRepository } from './ICivilIdentityRepository';
import { ISessionRepository } from './ISessionRepository';
import { IOutboxRepository } from './IOutboxRepository';
import { IPasswordResetRepository } from './IPasswordResetRepository';
import { ISsiRepository } from './ISsiRepository';
import { IFinanceRepository } from './IFinanceRepository';

export interface IRepositoryFactory {
  getUserRepository(): IUserRepository;
  getAuthTransactionRepository(): import('./IAuthTransactionRepository').IAuthTransactionRepository;
  getAuthenticationRepository(): IAuthenticationRepository;
  getWeb3Repository(): IWeb3Repository;
  getSessionRepository(): ISessionRepository;
  getCivilIdentityRepository(): ICivilIdentityRepository;
  getSsiRepository(): ISsiRepository;
  getOutboxRepository(): IOutboxRepository;
  getPasswordResetRepository(): IPasswordResetRepository;
  getFinanceRepository(): IFinanceRepository;
  getPostingSession(): import('../../../domains/finance/contracts/PostingSession').PostingSession;
  getPostingAuthority(): import('../../finance/services/PostingAuthority').PostingAuthority;
  /**
   * @deprecated Utilize exclusivamente `getPostingAuthority()` para despacho soberano de postagens.
   * Mantido apenas para compatibilidade de adaptadores internos de persistência.
   */
  getPostingExecutor?(): import('./IPostingExecutor').IPostingExecutor;
}


export interface IUnitOfWork {
  execute<T>(work: (factory: IRepositoryFactory) => Promise<Result<T>>): Promise<Result<T>>;
}

