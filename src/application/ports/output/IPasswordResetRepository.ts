import { Result } from '../../../shared/kernel/Result';
import { RepositoryError } from '../../../shared/kernel/RepositoryError';

export interface PasswordReset {
  id: number;
  userId: number;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
}

export interface CreatePasswordResetData {
  userId: number;
  tokenHash: string;
  expiresAt: Date;
}

export interface IPasswordResetRepository {
  findByToken(tokenHash: string): Promise<Result<PasswordReset, RepositoryError>>;
  invalidate(id: number): Promise<Result<void, RepositoryError>>;
  create(data: CreatePasswordResetData): Promise<Result<void, RepositoryError>>;
  consumeToken(tokenHash: string): Promise<Result<PasswordReset, RepositoryError>>;
}

