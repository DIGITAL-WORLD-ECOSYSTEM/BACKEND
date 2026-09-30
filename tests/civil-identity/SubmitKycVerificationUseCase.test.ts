import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SubmitKycVerificationUseCase } from '@/application/use-cases/civil-identity/SubmitKycVerificationUseCase';
import { Result } from '@/shared/kernel/Result';
import { RepositoryError } from '@/shared/kernel/RepositoryError';
import { CryptoVault } from '@/infrastructure/security/crypto/crypto';
import { WebCryptoVaultAdapter } from '@/infrastructure/security/crypto/WebCryptoVaultAdapter';

describe('SubmitKycVerificationUseCase', () => {
  let civilRepo: any;
  let mockUow: any;
  const testSecretKey = 'test_secret_key_32_characters_123';

  beforeEach(() => {
    civilRepo = {
      findCitizenByUserId: vi.fn(),
      createIdentityDocument: vi.fn(),
      createKycVerification: vi.fn(),
    };

    mockUow = {
      execute: vi.fn(async (callback) => {
        return callback({
          getCivilIdentityRepository: () => civilRepo,
        });
      }),
    };
  });

  it('fails when userId or documentNumber are missing', async () => {
    const useCase = new SubmitKycVerificationUseCase(civilRepo);

    const res1 = await useCase.execute({
      userId: 0,
      documentType: 'cpf',
      documentNumber: '12345678901',
    });
    expect(res1.isFailure).toBe(true);
    expect(res1.error).toContain('obrigatórios');

    const res2 = await useCase.execute({
      userId: 10,
      documentType: 'cpf',
      documentNumber: '',
    });
    expect(res2.isFailure).toBe(true);
  });

  it('ENFORCES DOMAIN INVARIANT: rejects KYC if citizen is not registered first', async () => {
    civilRepo.findCitizenByUserId.mockResolvedValue(null);
    const useCase = new SubmitKycVerificationUseCase(civilRepo);

    const result = await useCase.execute({
      userId: 99,
      documentType: 'cpf',
      documentNumber: '12345678901',
    });

    expect(result.isFailure).toBe(true);
    expect(result.error).toContain('Cidadão não encontrado');
    expect(civilRepo.createIdentityDocument).not.toHaveBeenCalled();
    expect(civilRepo.createKycVerification).not.toHaveBeenCalled();
  });

  it('HARDENED SECURITY P0: encrypts documentNumber with real AES-GCM and computes SHA-256 lookup hash', async () => {
    const citizen = { userId: 10, civilStatus: 'pending' };
    civilRepo.findCitizenByUserId.mockResolvedValue(citizen);
    civilRepo.createIdentityDocument.mockImplementation(async (data: any) => Result.ok({ id: 1, ...data }));
    civilRepo.createKycVerification.mockImplementation(async (data: any) => Result.ok({ id: 5, ...data }));

    const useCase = new SubmitKycVerificationUseCase(civilRepo, undefined, testSecretKey);

    const rawDocumentNumber = '12345678901';
    const result = await useCase.execute({
      userId: 10,
      documentType: 'cpf',
      documentNumber: rawDocumentNumber,
      verificationLevel: 'basic',
    });

    expect(result.isSuccess).toBe(true);
    expect(civilRepo.createIdentityDocument).toHaveBeenCalled();

    const docCallArgs = civilRepo.createIdentityDocument.mock.calls[0][0];

    // 1. Must NOT be plain text
    expect(docCallArgs.encryptedNumber).not.toBe(rawDocumentNumber);

    // 2. Must NOT be naive 'enc_' prefix
    expect(docCallArgs.encryptedNumber).not.toBe(`enc_${rawDocumentNumber}`);
    expect(docCallArgs.encryptedNumber.startsWith('enc_')).toBe(false);

    // 3. Must decrypt back to original text using AES-GCM
    const decrypted = await CryptoVault.decrypt(docCallArgs.encryptedNumber, testSecretKey);
    expect(decrypted).toBe(rawDocumentNumber);

    // 4. Verification of lookup hash and last4
    expect(docCallArgs.last4).toBe('8901');
    expect(docCallArgs.numberLookupHash).toHaveLength(64);
    expect(/^[0-9a-f]{64}$/.test(docCallArgs.numberLookupHash)).toBe(true);
  });

  it('works with injected ICryptoVaultPort adapter', async () => {
    const citizen = { userId: 10, civilStatus: 'pending' };
    civilRepo.findCitizenByUserId.mockResolvedValue(citizen);
    civilRepo.createIdentityDocument.mockImplementation(async (data: any) => Result.ok({ id: 1, ...data }));
    civilRepo.createKycVerification.mockImplementation(async (data: any) => Result.ok({ id: 5, ...data }));

    const vault = new WebCryptoVaultAdapter();
    const useCase = new SubmitKycVerificationUseCase(civilRepo, vault, testSecretKey);

    const result = await useCase.execute({
      userId: 10,
      documentType: 'passport',
      documentNumber: 'AB123456',
    });

    expect(result.isSuccess).toBe(true);
    const docCallArgs = civilRepo.createIdentityDocument.mock.calls[0][0];
    const decrypted = await vault.decrypt(docCallArgs.encryptedNumber, testSecretKey);
    expect(decrypted).toBe('AB123456');
  });

  it('works seamlessly through IUnitOfWork', async () => {
    const citizen = { userId: 10, civilStatus: 'pending' };
    civilRepo.findCitizenByUserId.mockResolvedValue(citizen);
    civilRepo.createIdentityDocument.mockResolvedValue(Result.ok({ id: 1 }));
    civilRepo.createKycVerification.mockResolvedValue(Result.ok({ id: 5, status: 'submitted' }));

    const useCase = new SubmitKycVerificationUseCase(mockUow, undefined, testSecretKey);

    const result = await useCase.execute({
      userId: 10,
      documentType: 'cpf',
      documentNumber: '11122233344',
    });

    expect(result.isSuccess).toBe(true);
    expect(mockUow.execute).toHaveBeenCalled();
  });

  it('returns failure when saving identity document fails', async () => {
    civilRepo.findCitizenByUserId.mockResolvedValue({ userId: 10 });
    civilRepo.createIdentityDocument.mockResolvedValue(
      Result.err(RepositoryError.transient('DB error'))
    );

    const useCase = new SubmitKycVerificationUseCase(civilRepo, undefined, testSecretKey);
    const result = await useCase.execute({
      userId: 10,
      documentType: 'cpf',
      documentNumber: '11122233344',
    });

    expect(result.isFailure).toBe(true);
    expect(civilRepo.createKycVerification).not.toHaveBeenCalled();
  });

  it('returns failure when registering kyc verification fails', async () => {
    civilRepo.findCitizenByUserId.mockResolvedValue({ userId: 10 });
    civilRepo.createIdentityDocument.mockResolvedValue(Result.ok({ id: 1 }));
    civilRepo.createKycVerification.mockResolvedValue(
      Result.err(RepositoryError.transient('KYC insert failed'))
    );

    const useCase = new SubmitKycVerificationUseCase(civilRepo, undefined, testSecretKey);
    const result = await useCase.execute({
      userId: 10,
      documentType: 'cpf',
      documentNumber: '11122233344',
    });

    expect(result.isFailure).toBe(true);
    expect(result.error).toContain('KYC insert failed');
  });
});
