import { describe, it, expect, vi } from 'vitest';
import { DrizzleSessionRepository } from './DrizzleSessionRepository';

describe('DrizzleSessionRepository', () => {
  it('should insert a new session correctly', async () => {
    const mockDb = {
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockResolvedValue(undefined),
    };

    const repo = new DrizzleSessionRepository(mockDb);
    const sessionData = {
      id: 'sess_123',
      userId: 1,
      jti: 'jti_123',
      ip: '127.0.0.1',
      userAgent: 'Mozilla/5.0',
      refreshTokenHash: 'hash123',
      aal: 1,
      authEpoch: 1,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 3600000),
    };

    await repo.createSession(sessionData);
    expect(mockDb.insert).toHaveBeenCalled();
    expect(mockDb.values).toHaveBeenCalledWith(sessionData);
  });

  it('should retrieve a session by id', async () => {
    const mockSession = { id: 'sess_123', userId: 1, jti: 'jti_123' };
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([mockSession]),
    };

    const repo = new DrizzleSessionRepository(mockDb);
    const result = await repo.getSessionById('sess_123');
    expect(result).toEqual(mockSession);
  });
});
