import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IssueVerifiableCredentialUseCase } from '@/application/use-cases/ssi/IssueVerifiableCredentialUseCase';
import { Result } from '@/shared/kernel/Result';
import { CryptoVault } from '@/infrastructure/security/crypto/crypto';
import { WebCryptoVaultAdapter } from '@/infrastructure/security/crypto/WebCryptoVaultAdapter';

describe('IssueVerifiableCredentialUseCase', () => {
  let ssiRepo: any;
  let mockUow: any;
  let mockSigner: any;
  const testSecretKey = 'test_ssi_vault_secret_key_32ch!';
  const expectedIssuerDid = 'did:key:z6MkpTHR8VNsBxYAAWHut2Geadd9jSwuBV8xRoAnwWsdvktH';

  beforeEach(() => {
    ssiRepo = {
      findDidByUserId: vi.fn(),
      saveVerifiableCredential: vi.fn(),
    };

    mockUow = {
      execute: vi.fn(async (cb) => cb({ getSsiRepository: () => ssiRepo })),
    };

    mockSigner = {
      getIssuerDid: vi.fn().mockResolvedValue(expectedIssuerDid),
      signCredential: vi.fn().mockImplementation(async (doc: any, issuerDid: string) => ({
        type: 'Ed25519Signature2020',
        created: new Date().toISOString(),
        verificationMethod: `${issuerDid}#keys-1`,
        proofPurpose: 'assertionMethod',
        proofValue: 'test_base58_signature_value',
      })),
      verifyProof: vi.fn().mockResolvedValue(true),
    };
  });

  it('fails when holderUserId or credentialType are missing', async () => {
    const useCase = new IssueVerifiableCredentialUseCase(ssiRepo, mockSigner, undefined, testSecretKey);
    const res1 = await useCase.execute({
      holderUserId: 0,
      credentialType: 'CivicIdentityCredential',
      claims: { isCitizen: true },
    });
    expect(res1.isFailure).toBe(true);
    expect(res1.error).toContain('obrigatórios');

    const res2 = await useCase.execute({
      holderUserId: 10,
      credentialType: '' as any,
      claims: { isCitizen: true },
    });
    expect(res2.isFailure).toBe(true);
  });

  it('fails when encryption key is not provided', async () => {
    ssiRepo.findDidByUserId.mockResolvedValue(Result.ok({ did: 'did:key:holder-123' }));
    const useCase = new IssueVerifiableCredentialUseCase(ssiRepo, mockSigner);

    const result = await useCase.execute({
      holderUserId: 10,
      credentialType: 'CivicIdentityCredential',
      claims: { isCitizen: true },
    });

    expect(result.isFailure).toBe(true);
    expect(result.error).toContain('não configurada');
  });

  it('fails when holder does not have an active DID', async () => {
    ssiRepo.findDidByUserId.mockResolvedValue(Result.fail('DID identity not found'));
    const useCase = new IssueVerifiableCredentialUseCase(ssiRepo, mockSigner, undefined, testSecretKey);

    const result = await useCase.execute({
      holderUserId: 10,
      credentialType: 'CivicIdentityCredential',
      claims: { isCitizen: true },
    });

    expect(result.isFailure).toBe(true);
    expect(result.error).toContain('DID não encontrado');
    expect(ssiRepo.saveVerifiableCredential).not.toHaveBeenCalled();
  });

  it('HARDENED SECURITY P0: encrypts claims with real AES-GCM and derives issuerDid from signer', async () => {
    ssiRepo.findDidByUserId.mockResolvedValue(Result.ok({ did: 'did:key:holder-123' }));
    ssiRepo.saveVerifiableCredential.mockImplementation(async (record: any) => Result.ok(record));

    const useCase = new IssueVerifiableCredentialUseCase(ssiRepo, mockSigner, undefined, testSecretKey);

    const originalClaims = {
      fullName: 'Carlos Mendes',
      cpf: '12345678901',
      citizenship: 'BR',
      votingEligible: true,
    };

    const result = await useCase.execute({
      holderUserId: 10,
      credentialType: 'CivicIdentityCredential',
      claims: originalClaims,
    });

    expect(result.isSuccess).toBe(true);
    const issuedVc = result.getValue();

    // 1. Must NOT contain plaintext
    expect(issuedVc.encryptedClaims).not.toContain('Carlos Mendes');
    expect(issuedVc.encryptedClaims).not.toContain('12345678901');

    // 2. Must NOT use naive 'enc_' prefix
    expect(issuedVc.encryptedClaims.startsWith('enc_')).toBe(false);

    // 3. Must be valid AES-GCM ciphertext that decrypts with the vault key
    const decryptedJson = await CryptoVault.decrypt(issuedVc.encryptedClaims, testSecretKey);
    const decryptedClaims = JSON.parse(decryptedJson);
    expect(decryptedClaims).toEqual(originalClaims);

    // 4. Must compute a 64-char SHA-256 credentialHash
    expect(issuedVc.credentialHash).toHaveLength(64);
    expect(/^[0-9a-f]{64}$/.test(issuedVc.credentialHash)).toBe(true);

    // 5. Must derive issuerDid from signer.getIssuerDid()
    expect(issuedVc.issuerDid).toBe(expectedIssuerDid);
    expect(mockSigner.getIssuerDid).toHaveBeenCalled();

    // 6. Must return the signed document including the cryptographic proof
    expect(issuedVc.document).toBeDefined();
    expect(issuedVc.document.proof.proofValue).toBe('test_base58_signature_value');
  });

  it('works with injected WebCryptoVaultAdapter', async () => {
    ssiRepo.findDidByUserId.mockResolvedValue(Result.ok({ did: 'did:key:holder-123' }));
    ssiRepo.saveVerifiableCredential.mockImplementation(async (record: any) => Result.ok(record));

    const vault = new WebCryptoVaultAdapter();
    const useCase = new IssueVerifiableCredentialUseCase(ssiRepo, mockSigner, vault, testSecretKey);

    const result = await useCase.execute({
      holderUserId: 10,
      credentialType: 'MembershipCredential',
      claims: { role: 'council_member' },
    });

    expect(result.isSuccess).toBe(true);
    const decrypted = await vault.decrypt(result.getValue().encryptedClaims, testSecretKey);
    expect(JSON.parse(decrypted)).toEqual({ role: 'council_member' });
  });

  it('works seamlessly through IUnitOfWork', async () => {
    ssiRepo.findDidByUserId.mockResolvedValue(Result.ok({ did: 'did:key:holder-123' }));
    ssiRepo.saveVerifiableCredential.mockImplementation(async (record: any) => Result.ok(record));

    const useCase = new IssueVerifiableCredentialUseCase(mockUow, mockSigner, undefined, testSecretKey);
    const result = await useCase.execute({
      holderUserId: 10,
      credentialType: 'KycVerificationCredential',
      claims: { level: 'enhanced' },
    });

    expect(result.isSuccess).toBe(true);
    expect(mockUow.execute).toHaveBeenCalled();
  });

  it('HARDENED SECURITY P2 (Ataque 24): revokes previous active credential of the same type on reissuance', async () => {
    ssiRepo.findDidByUserId.mockResolvedValue(Result.ok({ did: 'did:key:holder-123' }));
    ssiRepo.saveVerifiableCredential.mockImplementation(async (record: any) => Result.ok(record));
    ssiRepo.listVerifiableCredentialsByUserId = vi.fn().mockResolvedValue(
      Result.ok([
        { id: 'older-vc-uuid', credentialType: 'CivicIdentityCredential', status: 'active' },
        { id: 'other-type-vc', credentialType: 'MembershipCredential', status: 'active' },
      ])
    );
    ssiRepo.revokeVerifiableCredential = vi.fn().mockResolvedValue(Result.ok(undefined));

    const useCase = new IssueVerifiableCredentialUseCase(ssiRepo, mockSigner, undefined, testSecretKey);
    const result = await useCase.execute({
      holderUserId: 10,
      credentialType: 'CivicIdentityCredential',
      claims: { updated: true },
    });

    expect(result.isSuccess).toBe(true);
    expect(ssiRepo.revokeVerifiableCredential).toHaveBeenCalledWith('older-vc-uuid');
    expect(ssiRepo.revokeVerifiableCredential).not.toHaveBeenCalledWith('other-type-vc');
  });
});

