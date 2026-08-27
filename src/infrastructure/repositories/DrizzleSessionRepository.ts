import { ISessionRepository } from '../../application/ports/output/ISessionRepository';
import { eq, and, isNull } from 'drizzle-orm';
import { userSessions } from '../../db/authentication/tables';

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
    const result = await this.db
      .update(userSessions)
      .set({ revokedAt: new Date(), revocationReason: 'Rotated' })
      .where(
        and(
          eq(userSessions.id, sessionId),
          isNull(userSessions.revokedAt),
          eq(userSessions.refreshTokenHash, oldRefreshTokenHash)
        )
      );
    
    return result.meta.changes > 0;
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
    const [session] = await this.db
      .select()
      .from(userSessions)
      .where(eq(userSessions.id, sessionId))
      .limit(1);
    return session || null;
  }

  async createRefreshTokenFamily(familyData: {
    id: string;
    userId: number;
    createdAt: Date;
  }): Promise<void> {
    const { refreshTokenFamilies } = await import('../../db/authentication/tables');
    await this.db.insert(refreshTokenFamilies).values(familyData);
  }

  async revokeFamily(familyId: string, reason?: string): Promise<void> {
    const { refreshTokenFamilies, userSessions } = await import('../../db/authentication/tables');
    
    // Revoke the family
    await this.db.update(refreshTokenFamilies)
      .set({ revokedAt: new Date(), revocationReason: reason || 'Family revoked' })
      .where(eq(refreshTokenFamilies.id, familyId));

    // Revoke all sessions in the family
    await this.db.update(userSessions)
      .set({ revokedAt: new Date(), revocationReason: reason || 'Parent family revoked' })
      .where(eq(userSessions.familyId, familyId));
  }

  async getSessionByRefreshTokenHash(refreshTokenHash: string): Promise<any | null> {
    const [session] = await this.db
      .select()
      .from(userSessions)
      .where(eq(userSessions.refreshTokenHash, refreshTokenHash))
      .limit(1);
    return session || null;
  }
}
