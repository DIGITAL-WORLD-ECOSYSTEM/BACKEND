import { Result } from '../../../shared/kernel/Result';
import { RepositoryError } from '../../../shared/kernel/RepositoryError';

export interface SessionRecord {
  id: string;
  userId: number;
  jti: string;
  aal: number;
  authEpoch: number;
  ip: string;
  userAgent: string;
  familyId: string | null;
  refreshTokenHash: string;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  lastAuthenticatedAt: Date | null;
}

export interface RefreshTokenFamilyData {
  id: string;
  userId: number;
  createdAt: Date;
}

export interface CreateSessionData {
  id: string;
  userId: number;
  jti: string;
  ip: string;
  userAgent: string;
  familyId?: string | null;
  refreshTokenHash: string;
  aal: number;
  authEpoch: number;
  createdAt: Date;
  expiresAt: Date;
  lastAuthenticatedAt?: Date;
}

export interface ISessionRepository {
  createSession(sessionData: CreateSessionData): Promise<Result<void, RepositoryError>>;

  /**
   * Atomically rotates the refresh token.
   * Returns `true` if rotation succeeded, `false` if the old token hash did not match
   * (indicates refresh token reuse — a security domain outcome, not an infra error).
   */
  rotateRefreshTokenAtomically(sessionId: string, oldRefreshTokenHash: string): Promise<boolean>;

  revokeSession(sessionId: string): Promise<Result<void, RepositoryError>>;

  revokeAllUserSessions(userId: number): Promise<Result<void, RepositoryError>>;

  getSessionById(sessionId: string): Promise<SessionRecord | null>;

  createRefreshTokenFamily(familyData: RefreshTokenFamilyData): Promise<Result<void, RepositoryError>>;

  revokeFamily(familyId: string, reason?: string): Promise<Result<void, RepositoryError>>;

  getSessionByRefreshTokenHash(refreshTokenHash: string): Promise<SessionRecord | null>;
}

