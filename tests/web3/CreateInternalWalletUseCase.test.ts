import { describe, it, expect, vi } from 'vitest';
import { CreateInternalWalletUseCase } from '@/application/use-cases/web3/CreateInternalWalletUseCase';
import { Result } from '@/shared/kernel/Result';

describe('CreateInternalWalletUseCase (Audit Remediation Verification)', () => {
  const masterKey = 'test-master-wallet-encryption-key-32b';

  const mockGenerator = {
    generateWallet: vi.fn().mockResolvedValue({
      address: '0x1111222233334444555566667777888899990000',
      privateKey: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
    }),
  };

  const mockCryptoVault = {
    encrypt: vi.fn().mockResolvedValue('encrypted-legacy-string'),
    decrypt: vi.fn().mockResolvedValue('plain-secret'),
    encryptEnvelope: vi.fn().mockResolvedValue({
      ciphertext: 'b64ciphertext==',
      nonce: 'b64nonce12b==',
      authTag: 'b64authtag16b==',
    }),
    decryptEnvelope: vi.fn().mockResolvedValue('0xabcdef...'),
  };

  it('F-01 & F-03 & F-05: executes atomic wallet creation satisfying verified check constraints and envelope encryption', async () => {
    let capturedParams: any = null;

    const mockWeb3Repo = {
      findByAddress: vi.fn(),
      findByUserId: vi.fn(),
      findActiveByUserId: vi.fn(),
      linkExternalWallet: vi.fn(),
      createInternalWallet: vi.fn(),
      updateWallet: vi.fn(),
      revokeWallet: vi.fn(),
      createInternalWalletWithVault: vi.fn(async (params: any) => {
        capturedParams = params;
        return {
          vaultId: 101,
          wallet: {
            id: 202,
            userId: params.wallet.userId,
            address: params.wallet.address,
            addressNormalized: params.wallet.addressNormalized,
            networkId: params.wallet.networkId,
            status: params.wallet.status,
            verificationStatus: params.wallet.verificationStatus,
            isPrimary: params.wallet.isPrimary,
            linkedAt: new Date(),
          },
        };
      }),
    };

    const useCase = new CreateInternalWalletUseCase(
      mockWeb3Repo as any,
      mockGenerator as any,
      mockCryptoVault as any,
      masterKey
    );

    const result = await useCase.execute({
      userId: 42,
      networkId: 56,
      label: 'Main BSC Custodial Wallet',
      isPrimary: true,
    });

    expect(result.isSuccess).toBe(true);
    const output = result.getValue();
    expect(output.walletId).toBe(202);
    expect(output.address).toBe('0x1111222233334444555566667777888899990000');

    // Verificação F-01: ck_wallets_verified_state campos obrigatórios
    expect(capturedParams.wallet.verificationStatus).toBe('verified');
    expect(capturedParams.wallet.verificationMethod).toBe('system');
    expect(capturedParams.wallet.verifiedAt).toBeInstanceOf(Date);
    expect(capturedParams.wallet.lastOwnershipVerifiedAt).toBeInstanceOf(Date);

    // Verificação F-05: Metadados reais de envelope no cofre
    expect(capturedParams.vault.ciphertext).toBe('b64ciphertext==');
    expect(capturedParams.vault.nonce).toBe('b64nonce12b==');
    expect(capturedParams.vault.authTag).toBe('b64authtag16b==');
    expect(capturedParams.vault.purpose).toBe('private_key');
    expect(capturedParams.vault.keyReference).toBeDefined();

    // Verificação F-08: keyReference compartilhado entre vault e wallet
    expect(capturedParams.wallet.keyReference).toBe(capturedParams.vault.keyReference);
  });

  it('rejects execution when userId or networkId is missing', async () => {
    const mockWeb3Repo = { createInternalWalletWithVault: vi.fn() };
    const useCase = new CreateInternalWalletUseCase(
      mockWeb3Repo as any,
      mockGenerator as any,
      mockCryptoVault as any,
      masterKey
    );

    const res1 = await useCase.execute({ userId: 0, networkId: 56 });
    expect(res1.isFailure).toBe(true);
    expect(res1.error).toContain('obrigatórios');

    const res2 = await useCase.execute({ userId: 42, networkId: 0 });
    expect(res2.isFailure).toBe(true);
  });

  it('handles database or cryptographic failure gracefully without throwing', async () => {
    const mockWeb3Repo = {
      createInternalWalletWithVault: vi.fn().mockRejectedValue(new Error('Database unique constraint failed')),
    };

    const useCase = new CreateInternalWalletUseCase(
      mockWeb3Repo as any,
      mockGenerator as any,
      mockCryptoVault as any,
      masterKey
    );

    const result = await useCase.execute({ userId: 42, networkId: 56 });
    expect(result.isFailure).toBe(true);
    expect(result.error).toContain('Database unique constraint failed');
  });
});
