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
import { ISecureVaultRepository } from './ISecureVaultRepository';

import { IAuthTransactionRepository } from './IAuthTransactionRepository';
import { PostingSession } from '../../../domains/finance/contracts/PostingSession';

export interface IRepositoryFactory {
  getSecureVaultRepository(): ISecureVaultRepository;
  getUserRepository(): IUserRepository;
  getAuthTransactionRepository(): IAuthTransactionRepository;
  getAuthenticationRepository(): IAuthenticationRepository;
  getWeb3Repository(): IWeb3Repository;
  getSessionRepository(): ISessionRepository;
  getCivilIdentityRepository(): ICivilIdentityRepository;
  getSsiRepository(): ISsiRepository;
  getOutboxRepository(): IOutboxRepository;
  getPasswordResetRepository(): IPasswordResetRepository;
  getFinanceRepository(): IFinanceRepository;
  getPostingSession(): PostingSession;
}


export interface IUnitOfWork {
  execute<T>(work: (factory: IRepositoryFactory) => Promise<Result<T>>): Promise<Result<T>>;
}

