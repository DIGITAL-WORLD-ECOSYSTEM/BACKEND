import { Result } from '../../shared/kernel/Result';
import { RepositoryError } from '../../shared/kernel/RepositoryError';
import {
  ISessionRepository,
  SessionRecord,
  CreateSessionData,
  RefreshTokenFamilyData,
} from '../../application/ports/output/ISessionRepository';
import { eq, and, isNull, gt } from 'drizzle-orm';
import { userSessions, refreshTokenFamilies } from '../../db/authentication/tables';

export class DrizzleSessionRepository implements ISessionRepository {
  constructor(private db: any) {}

  async createSession(sessionData: CreateSessionData): Promise<Result<void, RepositoryError>> {
    try {
      await this.db.insert(userSessions).values(sessionData);
      return Result.ok();
    } catch (e: any) {
      return Result.err(RepositoryError.transient(e.message, e));
    }
  }

  async rotateRefreshTokenAtomically(sessionId: string, oldRefreshTokenHash: string): Promise<boolean> {
    const now = new Date();
    const result = await this.db
      .update(userSessions)
      .set({ revokedAt: now, revocationReason: 'Rotated' })
      .where(
        and(
          eq(userSessions.id, sessionId),
          isNull(userSessions.revokedAt),
          eq(userSessions.refreshTokenHash, oldRefreshTokenHash),
          gt(userSessions.expiresAt, now)
        )
      );
    
    return (result?.meta?.changes ?? result?.rowsAffected ?? 0) > 0;
  }

  async revokeSession(sessionId: string): Promise<Result<void, RepositoryError>> {
    try {
      await this.db
        .update(userSessions)
        .set({ revokedAt: new Date(), revocationReason: 'User logout' })
        .where(eq(userSessions.id, sessionId));
      return Result.ok();
    } catch (e: any) {
      return Result.err(RepositoryError.transient(e.message, e));
    }
  }

  async revokeAllUserSessions(userId: number): Promise<Result<void, RepositoryError>> {
    try {
      await this.db.update(userSessions)
        .set({ revokedAt: new Date(), revocationReason: 'Revoked all user sessions' })
        .where(eq(userSessions.userId, userId));
      return Result.ok();
    } catch (e: any) {
      return Result.err(RepositoryError.transient(e.message, e));
    }
  }

  async getSessionById(sessionId: string): Promise<SessionRecord | null> {
    const now = new Date();
    const [session] = await this.db
      .select()
      .from(userSessions)
      .where(
        and(
          eq(userSessions.id, sessionId),
          isNull(userSessions.revokedAt),
          gt(userSessions.expiresAt, now)
        )
      )
      .limit(1);
    return (session as SessionRecord) || null;
  }

  async createRefreshTokenFamily(familyData: RefreshTokenFamilyData): Promise<Result<void, RepositoryError>> {
    try {
      await this.db.insert(refreshTokenFamilies).values(familyData);
      return Result.ok();
    } catch (e: any) {
      return Result.err(RepositoryError.transient(e.message, e));
    }
  }

  async revokeFamily(familyId: string, reason?: string): Promise<Result<void, RepositoryError>> {
    try {
      const runRevocation = async (tx: any) => {
        // 1. Revoke the family
        await tx
          .update(refreshTokenFamilies)
          .set({ revokedAt: new Date(), revocationReason: reason || 'Family revoked' })
          .where(
            and(
              eq(refreshTokenFamilies.id, familyId),
              isNull(refreshTokenFamilies.revokedAt)
            )
          );

        // 2. Revoke all active sessions belonging to this family
        await tx
          .update(userSessions)
          .set({ revokedAt: new Date(), revocationReason: reason || 'Parent family revoked' })
          .where(
            and(
              eq(userSessions.familyId, familyId),
              isNull(userSessions.revokedAt)
            )
          );
      };

      if (typeof this.db.transaction === 'function') {
        await this.db.transaction(runRevocation);
      } else {
        await runRevocation(this.db);
      }
      return Result.ok();
    } catch (e: any) {
      return Result.err(RepositoryError.transient(e.message, e));
    }
  }

  async getSessionByRefreshTokenHash(refreshTokenHash: string): Promise<SessionRecord | null> {
    const now = new Date();
    const [session] = await this.db
      .select({
        session: userSessions,
      })
      .from(userSessions)
      .leftJoin(refreshTokenFamilies, eq(userSessions.familyId, refreshTokenFamilies.id))
      .where(
        and(
          eq(userSessions.refreshTokenHash, refreshTokenHash),
          isNull(userSessions.revokedAt),
          isNull(refreshTokenFamilies.revokedAt),
          gt(userSessions.expiresAt, now)
        )
      )
      .limit(1);

    return (session ? (session.session as SessionRecord) : null);
  }
}
