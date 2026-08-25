import { describe, it, expect, vi } from 'vitest';
import { DrizzleWalletRepository } from './DrizzleWalletRepository';

describe('DrizzleWalletRepository', () => {
  it('should return failure if wallet not found by address', async () => {
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    };

    const repo = new DrizzleWalletRepository(mockDb);
    const result = await repo.findByAddress('0x123');

    expect(result.isFailure).toBe(true);
    expect(result.error).toBe('Wallet not found');
  });

  it('should insert a new wallet with compliant default fields', async () => {
    const mockDb = {
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([{ id: 101 }]),
    };

    const repo = new DrizzleWalletRepository(mockDb);
    const result = await repo.save({
      userId: 1,
      address: '0x1234567890123456789012345678901234567890',
      addressNormalized: '0x1234567890123456789012345678901234567890',
      networkId: 1,
      provenance: 'external',
    });

    expect(result.isSuccess).toBe(true);
    expect(result.getValue().id).toBe(101);
    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({
        provenance: 'external',
        walletType: 'eoa',
        controlMode: 'external_user',
      })
    );
  });
});
