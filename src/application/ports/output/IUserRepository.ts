import { Result } from '../../../shared/kernel/Result';
import { RepositoryError } from '../../../shared/kernel/RepositoryError';

export interface UserRecord {
  id: number;
  publicId: string | null;
  email: string | null;
  emailNormalized: string | null;
  status: string;
  subjectType: string;
  failedLoginAttempts: number;
  lastFailedLoginAt: Date | null;
  authEpoch: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateUserData {
  email?: string;
  emailNormalized?: string;
  subjectType?: 'citizen' | 'organization' | 'system' | 'service';
  status?: 'active' | 'suspended' | 'pending' | 'locked';
}

export type UserStatus = 'active' | 'suspended' | 'pending' | 'locked';

export interface IUserRepository {
  findById(id: number): Promise<UserRecord | null>;
  findByEmail(email: string): Promise<UserRecord | null>;
  create(data: CreateUserData): Promise<Result<UserRecord, RepositoryError>>;
  updateStatus(id: number, status: UserStatus): Promise<Result<void, RepositoryError>>;
  /** Increments the auth epoch and returns the new value. Mandatory — used for session invalidation. */
  incrementAuthEpoch(userId: number): Promise<Result<number, RepositoryError>>;
  incrementFailedLoginAttempts(userId: number, maxAttempts: number): Promise<Result<void, RepositoryError>>;
  resetFailedLoginAttempts(userId: number): Promise<Result<void, RepositoryError>>;
}

