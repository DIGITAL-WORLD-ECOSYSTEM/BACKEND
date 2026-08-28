import { ISessionRepository } from '../../application/ports/output/ISessionRepository';
import { eq, and, isNull, gt } from 'drizzle-orm';
import { userSessions, refreshTokenFamilies } from '../../db/authentication/tables';

export class DrizzleSessionRepository implements ISessionRepository {
  constructor(private db: any) {}

  async createSession(sessionData: {
    id: string;
    userId: number;
    jti: string;
    ip: string;
    userAgent: string;
    familyId?: string;
    refreshTokenHash: string;
    aal: number;
    authEpoch: number;
    createdAt: Date;
    expiresAt: Date;
    lastAuthenticatedAt?: Date;
  }): Promise<void> {
    await this.db.insert(userSessions).values(sessionData);
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

  async revokeSession(sessionId: string): Promise<void> {
    await this.db
      .update(userSessions)
      .set({ revokedAt: new Date(), revocationReason: 'User logout' })
      .where(eq(userSessions.id, sessionId));
  }

  async revokeAllUserSessions(userId: number): Promise<void> {
    await this.db.update(userSessions)
      .set({ revokedAt: new Date(), revocationReason: 'Revoked all user sessions' })
      .where(eq(userSessions.userId, userId));
  }

  async getSessionById(sessionId: string): Promise<any | null> {
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
    return session || null;
  }

  async createRefreshTokenFamily(familyData: {
    id: string;
    userId: number;
    createdAt: Date;
  }): Promise<void> {
    await this.db.insert(refreshTokenFamilies).values(familyData);
  }

  async revokeFamily(familyId: string, reason?: string): Promise<void> {
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
  }

  async getSessionByRefreshTokenHash(refreshTokenHash: string): Promise<any | null> {
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

    return session ? session.session : null;
  }
}
