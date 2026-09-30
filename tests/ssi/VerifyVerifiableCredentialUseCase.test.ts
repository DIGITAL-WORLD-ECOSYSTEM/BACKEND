import { describe, it, expect, vi } from 'vitest';
import { VerifyVerifiableCredentialUseCase } from '@/application/use-cases/ssi/VerifyVerifiableCredentialUseCase';
import { Result } from '@/shared/kernel/Result';
import { ISsiRepository, VerifiableCredentialRecord } from '@/application/ports/output/ISsiRepository';
import { ICredentialSigner } from '@/application/ports/security/ICredentialSigner';
import { IUnitOfWork } from '@/application/ports/output/IUnitOfWork';

describe('VerifyVerifiableCredentialUseCase', () => {
  const credentialId = '550e8400-e29b-41d4-a716-446655440000';
  const issuerDid = 'did:key:z6MkpTHR8VNsBxYAAWHut2Geadd9jSwuBV8xRoAnwWsdvktH';
  const subjectDid = 'did:key:z6Mks7JadK37p24uQW7w7b7C2g1a3E6t8u9v0w1x2y3z4';

  const validDocument = {
    '@context': ['https://www.w3.org/2018/credentials/v1'],
    id: `urn:uuid:${credentialId}`,
    type: ['VerifiableCredential', 'CivicIdentityCredential'],
    issuer: issuerDid,
    issuanceDate: new Date('2026-01-01').toISOString(),
    credentialSubject: {
      id: subjectDid,
      name: 'João Silva',
      cpf: '12345678901',
    },
    proof: {
      type: 'Ed25519Signature2020',
      created: new Date('2026-01-01').toISOString(),
      proofPurpose: 'assertionMethod',
      verificationMethod: `${issuerDid}#key-1`,
      proofValue: 'mock-valid-signature',
    },
  };

  const computeSha256 = async (doc: any): Promise<string> => {
    const encoder = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(JSON.stringify(doc)));
    return Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  };

  it('should fail if credentialDocument is not provided', async () => {
    const mockRepo = {} as ISsiRepository;
    const mockSigner = {} as ICredentialSigner;
    const useCase = new VerifyVerifiableCredentialUseCase(mockRepo, mockSigner);

    const result = await useCase.execute({ credentialDocument: null });
    expect(result.isFailure).toBe(true);
    expect(result.error).toContain('Documento de credencial não fornecido');
  });

  it('should fail if proof is missing from document', async () => {
    const mockRepo = {} as ISsiRepository;
    const mockSigner = {} as ICredentialSigner;
    const useCase = new VerifyVerifiableCredentialUseCase(mockRepo, mockSigner);

    const docWithoutProof = { ...validDocument, proof: undefined };
    const result = await useCase.execute({ credentialDocument: docWithoutProof });

    expect(result.isFailure).toBe(true);
    expect(result.error).toContain('não contém prova criptográfica');
  });

  it('should fail if cryptographic signature is invalid', async () => {
    const mockRepo = {} as ISsiRepository;
    const mockSigner: ICredentialSigner = {
      signCredential: vi.fn(),
      verifyProof: vi.fn().mockResolvedValue(false),
      getIssuerDid: vi.fn(),
    };
    const useCase = new VerifyVerifiableCredentialUseCase(mockRepo, mockSigner);

    const result = await useCase.execute({ credentialDocument: validDocument });

    expect(result.isFailure).toBe(true);
    expect(result.error).toContain('Assinatura criptográfica da credencial inválida');
    expect(mockSigner.verifyProof).toHaveBeenCalledWith(validDocument);
  });

  it('should fail if credential is expired', async () => {
    const mockRepo = {} as ISsiRepository;
    const mockSigner: ICredentialSigner = {
      signCredential: vi.fn(),
      verifyProof: vi.fn().mockResolvedValue(true),
      getIssuerDid: vi.fn(),
    };
    const useCase = new VerifyVerifiableCredentialUseCase(mockRepo, mockSigner);

    const expiredDoc = {
      ...validDocument,
      expirationDate: new Date('2020-01-01').toISOString(),
    };

    const result = await useCase.execute({ credentialDocument: expiredDoc });

    expect(result.isFailure).toBe(true);
    expect(result.error).toContain('expirada');
  });

  it('should fail if credential id is missing or not a canonical id', async () => {
    const mockRepo = {} as ISsiRepository;
    const mockSigner: ICredentialSigner = {
      signCredential: vi.fn(),
      verifyProof: vi.fn().mockResolvedValue(true),
      getIssuerDid: vi.fn(),
    };
    const useCase = new VerifyVerifiableCredentialUseCase(mockRepo, mockSigner);

    const docWithBadId = { ...validDocument, id: '' };
    const result = await useCase.execute({ credentialDocument: docWithBadId });

    expect(result.isFailure).toBe(true);
    expect(result.error).toContain('ID da credencial ausente');
  });

  it('should fail (fail-closed) if credential is not found in database', async () => {
    const mockRepo: ISsiRepository = {
      findDidByUserId: vi.fn(),
      saveDid: vi.fn(),
      saveVerifiableCredential: vi.fn(),
      findVerifiableCredentialById: vi.fn().mockResolvedValue(Result.fail('Not found')),
      listVerifiableCredentialsByUserId: vi.fn(),
      revokeVerifiableCredential: vi.fn(),
    };
    const mockSigner: ICredentialSigner = {
      signCredential: vi.fn(),
      verifyProof: vi.fn().mockResolvedValue(true),
      getIssuerDid: vi.fn(),
    };
    const useCase = new VerifyVerifiableCredentialUseCase(mockRepo, mockSigner);

    const result = await useCase.execute({ credentialDocument: validDocument });

    expect(result.isFailure).toBe(true);
    expect(result.error).toContain('não encontrada no registro de emissão');
  });

  it('should fail if credential was revoked in database', async () => {
    const mockRepo: ISsiRepository = {
      findDidByUserId: vi.fn(),
      saveDid: vi.fn(),
      saveVerifiableCredential: vi.fn(),
      findVerifiableCredentialById: vi.fn().mockResolvedValue(
        Result.ok({
          id: credentialId,
          holderUserId: 1,
          issuerDid,
          subjectDid,
          credentialType: 'CivicIdentityCredential',
          credentialHash: 'hash',
          encryptedClaims: 'enc',
          proofType: 'Ed25519Signature2020',
          status: 'revoked',
          issuanceDate: new Date(),
          expirationDate: null,
          version: 2,
        })
      ),
      listVerifiableCredentialsByUserId: vi.fn(),
      revokeVerifiableCredential: vi.fn(),
    };
    const mockSigner: ICredentialSigner = {
      signCredential: vi.fn(),
      verifyProof: vi.fn().mockResolvedValue(true),
      getIssuerDid: vi.fn(),
    };
    const useCase = new VerifyVerifiableCredentialUseCase(mockRepo, mockSigner);

    const result = await useCase.execute({ credentialDocument: validDocument });

    expect(result.isFailure).toBe(true);
    expect(result.error).toContain('foi revogada pelo emissor');
  });

  it('should fail if credential status is not active (e.g. suspended)', async () => {
    const mockRepo: ISsiRepository = {
      findDidByUserId: vi.fn(),
      saveDid: vi.fn(),
      saveVerifiableCredential: vi.fn(),
      findVerifiableCredentialById: vi.fn().mockResolvedValue(
        Result.ok({
          id: credentialId,
          holderUserId: 1,
          issuerDid,
          subjectDid,
          credentialType: 'CivicIdentityCredential',
          credentialHash: 'hash',
          encryptedClaims: 'enc',
          proofType: 'Ed25519Signature2020',
          status: 'suspended' as any,
          issuanceDate: new Date(),
          expirationDate: null,
          version: 2,
        })
      ),
      listVerifiableCredentialsByUserId: vi.fn(),
      revokeVerifiableCredential: vi.fn(),
    };
    const mockSigner: ICredentialSigner = {
      signCredential: vi.fn(),
      verifyProof: vi.fn().mockResolvedValue(true),
      getIssuerDid: vi.fn(),
    };
    const useCase = new VerifyVerifiableCredentialUseCase(mockRepo, mockSigner);

    const result = await useCase.execute({ credentialDocument: validDocument });

    expect(result.isFailure).toBe(true);
    expect(result.error).toContain('não está ativa');
  });

  it('should fail if document hash does not match stored hash (tamper detection)', async () => {
    const expectedHash = await computeSha256(validDocument);
    const mockRepo: ISsiRepository = {
      findDidByUserId: vi.fn(),
      saveDid: vi.fn(),
      saveVerifiableCredential: vi.fn(),
      findVerifiableCredentialById: vi.fn().mockResolvedValue(
        Result.ok({
          id: credentialId,
          holderUserId: 1,
          issuerDid,
          subjectDid,
          credentialType: 'CivicIdentityCredential',
          credentialHash: expectedHash,
          encryptedClaims: 'enc',
          proofType: 'Ed25519Signature2020',
          status: 'active',
          issuanceDate: new Date(),
          expirationDate: null,
          version: 1,
        })
      ),
      listVerifiableCredentialsByUserId: vi.fn(),
      revokeVerifiableCredential: vi.fn(),
    };
    const mockSigner: ICredentialSigner = {
      signCredential: vi.fn(),
      verifyProof: vi.fn().mockResolvedValue(true),
      getIssuerDid: vi.fn(),
    };
    const useCase = new VerifyVerifiableCredentialUseCase(mockRepo, mockSigner);

    // Tampered document has modified claim
    const tamperedDoc = {
      ...validDocument,
      credentialSubject: {
        ...validDocument.credentialSubject,
        name: 'Hacker Adulterado',
      },
    };

    const result = await useCase.execute({ credentialDocument: tamperedDoc });

    expect(result.isFailure).toBe(true);
    expect(result.error).toContain('Adulteração detectada: o hash do documento apresentado não corresponde');
  });

  it('should successfully verify valid untampered active credential (direct repo mode)', async () => {
    const expectedHash = await computeSha256(validDocument);
    const mockRepo: ISsiRepository = {
      findDidByUserId: vi.fn(),
      saveDid: vi.fn(),
      saveVerifiableCredential: vi.fn(),
      findVerifiableCredentialById: vi.fn().mockResolvedValue(
        Result.ok({
          id: credentialId,
          holderUserId: 1,
          issuerDid,
          subjectDid,
          credentialType: 'CivicIdentityCredential',
          credentialHash: expectedHash,
          encryptedClaims: 'enc',
          proofType: 'Ed25519Signature2020',
          status: 'active',
          issuanceDate: new Date(),
          expirationDate: null,
          version: 1,
        })
      ),
      listVerifiableCredentialsByUserId: vi.fn(),
      revokeVerifiableCredential: vi.fn(),
    };
    const mockSigner: ICredentialSigner = {
      signCredential: vi.fn(),
      verifyProof: vi.fn().mockResolvedValue(true),
      getIssuerDid: vi.fn(),
    };
    const useCase = new VerifyVerifiableCredentialUseCase(mockRepo, mockSigner);

    const result = await useCase.execute({ credentialDocument: validDocument });

    expect(result.isSuccess).toBe(true);
    const val = result.getValue();
    expect(val.isValid).toBe(true);
    expect(val.subjectId).toBe(subjectDid);
    expect(val.claims.name).toBe('João Silva');
    expect(val.credentialType).toBe('CivicIdentityCredential');
  });

  it('should successfully verify credential when executed through IUnitOfWork', async () => {
    const expectedHash = await computeSha256(validDocument);
    const mockRepo: ISsiRepository = {
      findDidByUserId: vi.fn(),
      saveDid: vi.fn(),
      saveVerifiableCredential: vi.fn(),
      findVerifiableCredentialById: vi.fn().mockResolvedValue(
        Result.ok({
          id: credentialId,
          holderUserId: 1,
          issuerDid,
          subjectDid,
          credentialType: 'CivicIdentityCredential',
          credentialHash: expectedHash,
          encryptedClaims: 'enc',
          proofType: 'Ed25519Signature2020',
          status: 'active',
          issuanceDate: new Date(),
          expirationDate: null,
          version: 1,
        })
      ),
      listVerifiableCredentialsByUserId: vi.fn(),
      revokeVerifiableCredential: vi.fn(),
    };
    const mockUow: IUnitOfWork = {
      execute: vi.fn().mockImplementation(async (work) => {
        return work({
          getSsiRepository: () => mockRepo,
        } as any);
      }),
    };
    const mockSigner: ICredentialSigner = {
      signCredential: vi.fn(),
      verifyProof: vi.fn().mockResolvedValue(true),
      getIssuerDid: vi.fn(),
    };
    const useCase = new VerifyVerifiableCredentialUseCase(mockUow, mockSigner);

    const result = await useCase.execute({ credentialDocument: validDocument });

    expect(result.isSuccess).toBe(true);
    expect(mockUow.execute).toHaveBeenCalled();
    expect(result.getValue().isValid).toBe(true);
  });
});
