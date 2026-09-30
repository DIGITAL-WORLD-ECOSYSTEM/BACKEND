import { describe, it, expect, vi } from 'vitest';
import { DrizzleSsiRepository } from '@/infrastructure/repositories/DrizzleSsiRepository';

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

  it('should return failure on concurrent modification error during saveDid update', async () => {
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ id: '550e8400-e29b-41d4-a716-446655440000', version: 2 }]),
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([]), // 0 rows affected due to version conflict
    };

    const repo = new DrizzleSsiRepository(mockDb);
    const record = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      userId: 1,
      did: 'did:key:z6MkpTHR8VNsBxYAAWHut2Geadd9jSwuBV8xRoAnwWsdvktH',
      method: 'key' as const,
      controller: 'did:key:z6MkpTHR8VNsBxYAAWHut2Geadd9jSwuBV8xRoAnwWsdvktH',
      version: 1, // Sending stale version 1 when DB is at version 2
    };

    const result = await repo.saveDid(record);
    expect(result.isFailure).toBe(true);
    expect(result.error).toContain('CONCURRENT_MODIFICATION_ERROR');
  });

  it('should save a verifiable credential', async () => {
    const mockDb = {
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockResolvedValue(undefined),
    };

    const repo = new DrizzleSsiRepository(mockDb);
    const vcRecord = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      holderUserId: 1,
      issuerDid: 'did:key:issuer',
      subjectDid: 'did:key:subject',
      credentialType: 'CivicIdentityCredential' as const,
      credentialHash: 'testhash',
      encryptedClaims: 'testencrypted',
      proofType: 'Ed25519Signature2020' as const,
      status: 'active' as const,
      issuanceDate: new Date(),
      expirationDate: null,
      version: 1,
    };

    const result = await repo.saveVerifiableCredential(vcRecord);
    expect(result.isSuccess).toBe(true);
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it('should find a verifiable credential by id', async () => {
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([
        {
          id: '550e8400-e29b-41d4-a716-446655440000',
          holderUserId: 1,
          issuerDid: 'did:key:issuer',
          subjectDid: 'did:key:subject',
          credentialType: 'CivicIdentityCredential',
          credentialHash: 'testhash',
          encryptedClaims: 'testencrypted',
          proofType: 'Ed25519Signature2020',
          status: 'active',
          issuanceDate: new Date().toISOString(),
          expirationDate: null,
          revokedAt: null,
          version: 1,
        },
      ]),
    };

    const repo = new DrizzleSsiRepository(mockDb);
    const result = await repo.findVerifiableCredentialById('550e8400-e29b-41d4-a716-446655440000');
    expect(result.isSuccess).toBe(true);
    expect(result.getValue().id).toBe('550e8400-e29b-41d4-a716-446655440000');
  });

  it('should return failure if verifiable credential is not found by id', async () => {
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    };

    const repo = new DrizzleSsiRepository(mockDb);
    const result = await repo.findVerifiableCredentialById('nonexistent');
    expect(result.isFailure).toBe(true);
    expect(result.error).toBe('Verifiable Credential not found');
  });

  it('should list verifiable credentials for a user', async () => {
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([
        {
          id: '550e8400-e29b-41d4-a716-446655440000',
          holderUserId: 1,
          issuerDid: 'did:key:issuer',
          subjectDid: 'did:key:subject',
          credentialType: 'CivicIdentityCredential',
          credentialHash: 'testhash',
          encryptedClaims: 'testencrypted',
          proofType: 'Ed25519Signature2020',
          status: 'active',
          issuanceDate: new Date().toISOString(),
          expirationDate: null,
          revokedAt: null,
          version: 1,
        },
      ]),
    };

    const repo = new DrizzleSsiRepository(mockDb);
    const result = await repo.listVerifiableCredentialsByUserId(1);
    expect(result.isSuccess).toBe(true);
    expect(result.getValue().length).toBe(1);
  });

  it('should revoke a verifiable credential successfully', async () => {
    const mockDb = {
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue({ rowsAffected: 1 }),
    };

    const repo = new DrizzleSsiRepository(mockDb);
    const result = await repo.revokeVerifiableCredential('550e8400-e29b-41d4-a716-446655440000');
    expect(result.isSuccess).toBe(true);
  });

  it('should return failure when revoking an already revoked or nonexistent credential', async () => {
    const mockDb = {
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue({ rowsAffected: 0 }),
    };

    const repo = new DrizzleSsiRepository(mockDb);
    const result = await repo.revokeVerifiableCredential('550e8400-e29b-41d4-a716-446655440000');
    expect(result.isFailure).toBe(true);
    expect(result.error).toContain('already revoked or not found');
  });
});

