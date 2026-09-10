import { Result } from '../../../shared/kernel/Result';
import { RepositoryError } from '../../../shared/kernel/RepositoryError';
import { UserId } from '../../../shared/kernel/ids/UserId';
import { UserStatus, UserSubjectType } from '../../../domains/user/types';
import { User } from '../../../domains/user/entities/User';

export interface UserRecord {
  id: UserId;
  publicId: string | null;
  email: string | null;
  emailNormalized: string | null;
  status: UserStatus;
  subjectType: UserSubjectType;
  failedLoginAttempts: number;
  lastFailedLoginAt: Date | null;
  authEpoch: number;
  emailVerifiedAt: Date | null;
  emailChangedAt: Date | null;
  statusChangedAt: Date | null;
  lockedAt: Date | null;
  disabledAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateUserData {
  email?: string | null;
  emailNormalized?: string | null;
  subjectType?: UserSubjectType;
  status?: UserStatus;
}

export interface IUserRepository {
  findById(id: UserId): Promise<UserRecord | null>;
  findByEmail(email: string): Promise<UserRecord | null>;
  findByPublicId(publicId: string): Promise<UserRecord | null>;
  create(data: CreateUserData): Promise<Result<UserRecord, RepositoryError>>;
  /** Persiste o aggregate User com suas transições de estado já validadas pelo domínio */
  save(user: User): Promise<Result<void, RepositoryError>>;
  /** Atribui PublicId atomicamente com garantia de affected rows */
  updatePublicId(id: UserId, publicId: string): Promise<Result<void, RepositoryError>>;
  /** Increments the auth epoch and returns the new value. Used strictly for session invalidation. */
  incrementAuthEpoch(userId: UserId): Promise<Result<number, RepositoryError>>;
  /** Atomic increment of failed login attempts */
  incrementFailedLoginAttempts(userId: UserId): Promise<Result<number, RepositoryError>>;
  resetFailedLoginAttempts(userId: UserId): Promise<Result<void, RepositoryError>>;
}
