export interface ISessionRepository {
  createSession(sessionData: {
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
  }): Promise<void>;

  revokeSession(sessionId: string): Promise<void>;

  revokeAllUserSessions(userId: number): Promise<void>;

  getSessionById(sessionId: string): Promise<any | null>;

  createRefreshTokenFamily(familyData: {
    id: string;
    userId: number;
    createdAt: Date;
  }): Promise<void>;

  revokeFamily(familyId: string, reason?: string): Promise<void>;

  getSessionByRefreshTokenHash(refreshTokenHash: string): Promise<any | null>;
}
