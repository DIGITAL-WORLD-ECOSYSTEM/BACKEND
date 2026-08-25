import { Result } from '../../../shared/kernel/Result';

export interface PasswordReset {
  id: number;
  userId: number;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
}

export interface IPasswordResetRepository {
  findByToken(tokenHash: string): Promise<Result<PasswordReset>>;
  invalidate(id: number): Promise<Result<void>>;
  create(data: { userId: number; tokenHash: string; expiresAt: Date }): Promise<Result<void>>;
}
