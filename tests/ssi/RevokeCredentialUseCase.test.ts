import { describe, it, expect, vi } from 'vitest';
import { RevokeCredentialUseCase } from '@/application/use-cases/ssi/RevokeCredentialUseCase';
import { Result } from '@/shared/kernel/Result';
import { ISsiRepository, VerifiableCredentialRecord } from '@/application/ports/output/ISsiRepository';
import { IUnitOfWork } from '@/application/ports/output/IUnitOfWork';

describe('RevokeCredentialUseCase', () => {
  const sampleVcRecord: VerifiableCredentialRecord = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    holderUserId: 42,
    issuerDid: 'did:key:z6MkpTHR8VNsBxYAAWHut2Geadd9jSwuBV8xRoAnwWsdvktH',
    subjectDid: 'did:key:z6Mks7JadK37p24uQW7w7b7C2g1a3E6t8u9v0w1x2y3z4',
    credentialType: 'CivicIdentityCredential',
    credentialHash: 'abcdef0123456789',
    encryptedClaims: 'encrypted_payload',
    proofType: 'Ed25519Signature2020',
    status: 'active',
    issuanceDate: new Date(),
    expirationDate: null,
    version: 1,
  };

  it('should fail if credentialId is missing', async () => {
    const mockRepo = {} as ISsiRepository;
    const useCase = new RevokeCredentialUseCase(mockRepo);

    const result = await useCase.execute({ credentialId: '', actorUserId: 42 });
    expect(result.isFailure).toBe(true);
    expect(result.error).toContain('CredentialId é obrigatório');
  });

  it('should fail if actorUserId is missing', async () => {
    const mockRepo = {} as ISsiRepository;
    const useCase = new RevokeCredentialUseCase(mockRepo);

    const result = await useCase.execute({ credentialId: '550e8400-e29b-41d4-a716-446655440000', actorUserId: 0 });
    expect(result.isFailure).toBe(true);
    expect(result.error).toContain('ActorUserId é obrigatório');
  });

  it('should fail if credential is not found in repository', async () => {
    const mockRepo: ISsiRepository = {
      findDidByUserId: vi.fn(),
      saveDid: vi.fn(),
      saveVerifiableCredential: vi.fn(),
      findVerifiableCredentialById: vi.fn().mockResolvedValue(Result.fail('Not found')),
      listVerifiableCredentialsByUserId: vi.fn(),
      revokeVerifiableCredential: vi.fn(),
    };
    const useCase = new RevokeCredentialUseCase(mockRepo);

    const result = await useCase.execute({
      credentialId: '550e8400-e29b-41d4-a716-446655440000',
      actorUserId: 42,
    });

    expect(result.isFailure).toBe(true);
    expect(result.error).toContain('não encontrada');
  });

  it('should prevent IDOR: fail if actor is not the holder of the credential', async () => {
    const mockRepo: ISsiRepository = {
      findDidByUserId: vi.fn(),
      saveDid: vi.fn(),
      saveVerifiableCredential: vi.fn(),
      findVerifiableCredentialById: vi.fn().mockResolvedValue(Result.ok(sampleVcRecord)),
      listVerifiableCredentialsByUserId: vi.fn(),
      revokeVerifiableCredential: vi.fn(),
    };
    const useCase = new RevokeCredentialUseCase(mockRepo);

    // Attacker userId 999 tries to revoke holder 42's credential
    const result = await useCase.execute({
      credentialId: '550e8400-e29b-41d4-a716-446655440000',
      actorUserId: 999,
    });

    expect(result.isFailure).toBe(true);
    expect(result.error).toContain('Acesso negado: você não é o titular');
    expect(mockRepo.revokeVerifiableCredential).not.toHaveBeenCalled();
  });

  it('should successfully revoke credential when actor is the holder (direct repo mode)', async () => {
    const mockRepo: ISsiRepository = {
      findDidByUserId: vi.fn(),
      saveDid: vi.fn(),
      saveVerifiableCredential: vi.fn(),
      findVerifiableCredentialById: vi.fn().mockResolvedValue(Result.ok(sampleVcRecord)),
      listVerifiableCredentialsByUserId: vi.fn(),
      revokeVerifiableCredential: vi.fn().mockResolvedValue(Result.ok(undefined)),
    };
    const useCase = new RevokeCredentialUseCase(mockRepo);

    const result = await useCase.execute({
      credentialId: sampleVcRecord.id,
      actorUserId: sampleVcRecord.holderUserId,
    });

    expect(result.isSuccess).toBe(true);
    expect(mockRepo.revokeVerifiableCredential).toHaveBeenCalledWith(sampleVcRecord.id);
  });

  it('should successfully revoke credential when using IUnitOfWork', async () => {
    const mockRepo: ISsiRepository = {
      findDidByUserId: vi.fn(),
      saveDid: vi.fn(),
      saveVerifiableCredential: vi.fn(),
      findVerifiableCredentialById: vi.fn().mockResolvedValue(Result.ok(sampleVcRecord)),
      listVerifiableCredentialsByUserId: vi.fn(),
      revokeVerifiableCredential: vi.fn().mockResolvedValue(Result.ok(undefined)),
    };

    const mockUow: IUnitOfWork = {
      execute: vi.fn().mockImplementation(async (work) => {
        return work({
          getSsiRepository: () => mockRepo,
        } as any);
      }),
    };

    const useCase = new RevokeCredentialUseCase(mockUow);

    const result = await useCase.execute({
      credentialId: sampleVcRecord.id,
      actorUserId: sampleVcRecord.holderUserId,
    });

    expect(result.isSuccess).toBe(true);
    expect(mockUow.execute).toHaveBeenCalled();
    expect(mockRepo.revokeVerifiableCredential).toHaveBeenCalledWith(sampleVcRecord.id);
  });

  it('should allow administrative / issuer revocation when isIssuerOrAdmin is true', async () => {
    const mockRepo: ISsiRepository = {
      findDidByUserId: vi.fn(),
      saveDid: vi.fn(),
      saveVerifiableCredential: vi.fn(),
      findVerifiableCredentialById: vi.fn().mockResolvedValue(Result.ok(sampleVcRecord)),
      listVerifiableCredentialsByUserId: vi.fn(),
      revokeVerifiableCredential: vi.fn().mockResolvedValue(Result.ok(undefined)),
    };
    const useCase = new RevokeCredentialUseCase(mockRepo);

    // Admin (actorUserId 999) revokes holder 42's credential with isIssuerOrAdmin: true
    const result = await useCase.execute({
      credentialId: sampleVcRecord.id,
      actorUserId: 999,
      isIssuerOrAdmin: true,
    });

    expect(result.isSuccess).toBe(true);
    expect(mockRepo.revokeVerifiableCredential).toHaveBeenCalledWith(sampleVcRecord.id);
  });
});

