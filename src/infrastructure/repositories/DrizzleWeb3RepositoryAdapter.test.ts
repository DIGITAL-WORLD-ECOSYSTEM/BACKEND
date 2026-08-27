/**
 * Tests migrated from DrizzleWalletRepository to DrizzleWeb3RepositoryAdapter.
 * DrizzleWalletRepository was removed (P10 fix) — it lacked OCC and was a duplicate.
 * DrizzleWeb3RepositoryAdapter is the single canonical implementation with OCC.
 */
import { describe, it, expect, vi } from 'vitest';
import { DrizzleWeb3RepositoryAdapter } from './DrizzleWeb3RepositoryAdapter';

describe('DrizzleWeb3RepositoryAdapter', () => {
  it('should return null if wallet not found by address', async () => {
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    };

    const repo = new DrizzleWeb3RepositoryAdapter(mockDb);
    const result = await repo.findByAddress('0x123');

    expect(result).toBeNull();
  });

  it('should insert a new wallet with compliant default fields (OCC-enabled)', async () => {
    const mockWallet = {
      id: 101,
      userId: 1,
      address: '0x1234567890123456789012345678901234567890',
      addressNormalized: '0x1234567890123456789012345678901234567890',
      networkId: 1,
      provenance: 'external',
      walletType: 'eoa',
      controlMode: 'external_user',
      label: 'Web3 Wallet',
      status: 'active',
      verificationStatus: 'verified',
      isPrimary: false,
      linkedAt: new Date(),
      version: 1,
    };

    const mockSelectDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]), // findByAddress returns null (not existing)
    };

    const mockInsertDb = {
      ...mockSelectDb,
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([mockWallet]),
    };

    const repo = new DrizzleWeb3RepositoryAdapter(mockInsertDb);
    const result = await repo.linkExternalWallet({
      userId: 1,
      address: '0x1234567890123456789012345678901234567890',
      networkId: 1,
      provenance: 'external',
    });

    expect(result.id).toBe(101);
    expect(result.walletType).toBe('eoa');
    expect(result.controlMode).toBe('external_user');
    expect(result.version).toBe(1);
  });

  it('should throw CONCURRENT_MODIFICATION_ERROR if OCC fails on update', async () => {
    const mockDb = {
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([]), // 0 rows = OCC failed
    };

    const repo = new DrizzleWeb3RepositoryAdapter(mockDb);

    await expect(
      repo.updateWallet({
        id: 1,
        userId: 1,
        address: '0x1234567890123456789012345678901234567890',
        addressNormalized: '0x1234567890123456789012345678901234567890',
        networkId: 1,
        provenance: 'external',
        walletType: 'eoa',
        controlMode: 'external_user',
        label: null,
        status: 'active',
        verificationStatus: 'verified',
        isPrimary: false,
        linkedAt: new Date(),
        version: 3, // expected version
      })
    ).rejects.toThrow('CONCURRENT_MODIFICATION_ERROR');
  });
});
