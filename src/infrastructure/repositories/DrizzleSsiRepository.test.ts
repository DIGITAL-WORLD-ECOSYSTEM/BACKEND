import { describe, it, expect, vi } from 'vitest';
import { DrizzleSsiRepository } from './DrizzleSsiRepository';

describe('DrizzleSsiRepository', () => {
  it('should return failure if active DID not found for user', async () => {
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    };

    const repo = new DrizzleSsiRepository(mockDb);
    const result = await repo.findDidByUserId(1);

    expect(result.isFailure).toBe(true);
    expect(result.error).toBe('DID identity not found');
  });

  it('should insert a new W3C compliant DID identity', async () => {
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockResolvedValue(undefined),
    };

    const repo = new DrizzleSsiRepository(mockDb);
    const record = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      userId: 1,
      did: 'did:key:z6MkpTHR8VNsBxYAAWHut2Geadd9jSwuBV8xRoAnwWsdvktH',
      method: 'key' as const,
      controller: 'did:key:z6MkpTHR8VNsBxYAAWHut2Geadd9jSwuBV8xRoAnwWsdvktH',
    };

    const result = await repo.saveDid(record);
    expect(result.isSuccess).toBe(true);
    expect(mockDb.insert).toHaveBeenCalled();
  });
});
