import { Result } from '../../../shared/kernel/Result';
import { IUserRepository } from './IUserRepository';
import { IAuthenticationRepository } from './IAuthenticationRepository';
import { IWeb3Repository } from './IWeb3Repository';
import { ICivilIdentityRepository } from './ICivilIdentityRepository';
import { ISessionRepository } from './ISessionRepository';

export interface IRepositoryFactory {
  getUserRepository(): IUserRepository;
  getAuthenticationRepository(): IAuthenticationRepository;
  getWeb3Repository(): IWeb3Repository;
  getSessionRepository(): ISessionRepository;
  getCivilIdentityRepository(): ICivilIdentityRepository;
}

export interface IUnitOfWork {
  execute<T>(work: (factory: IRepositoryFactory) => Promise<Result<T>>): Promise<Result<T>>;
}
