import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CreateDidUseCase } from '@/application/use-cases/ssi/CreateDidUseCase';
import { Result } from '@/shared/kernel/Result';

describe('CreateDidUseCase', () => {
  let ssiRepo: any;
  let mockUow: any;

  beforeEach(() => {
    ssiRepo = {
      findDidByUserId: vi.fn(),
      saveDid: vi.fn(),
    };

    mockUow = {
      execute: vi.fn(async (cb) => cb({ getSsiRepository: () => ssiRepo })),
    };
  });

  it('fails when userId is missing', async () => {
    const useCase = new CreateDidUseCase(ssiRepo);
    const result = await useCase.execute({ userId: 0 });
    expect(result.isFailure).toBe(true);
    expect(result.error).toContain('obrigatório');
  });

  it('returns existing DID if user already has an active DID', async () => {
    const existing = {
      id: 'uuid-1',
      userId: 10,
      did: 'did:key:existing-did',
      method: 'key',
      controller: 'did:key:existing-did',
      status: 'active',
      version: 1,
    };
    ssiRepo.findDidByUserId.mockResolvedValue(Result.ok(existing));

    const useCase = new CreateDidUseCase(ssiRepo);
    const result = await useCase.execute({ userId: 10 });

    expect(result.isSuccess).toBe(true);
    expect(result.getValue().did).toBe('did:key:existing-did');
    expect(ssiRepo.saveDid).not.toHaveBeenCalled();
  });

  it('creates and saves a new DID in D1 mode (direct repository)', async () => {
    ssiRepo.findDidByUserId.mockResolvedValue(Result.fail('Not found'));
    ssiRepo.saveDid.mockImplementation(async (record: any) => Result.ok(record));

    const useCase = new CreateDidUseCase(ssiRepo);
    const result = await useCase.execute({ userId: 10, method: 'key' });

    expect(result.isSuccess).toBe(true);
    const didRecord = result.getValue();
    expect(didRecord.userId).toBe(10);
    expect(didRecord.did).toMatch(/^did:key:z6Mk[1-9A-HJ-NP-Za-km-z]+$/);
    expect(didRecord.status).toBe('active');
    expect(didRecord.isPrimary).toBe(true);
    expect(ssiRepo.saveDid).toHaveBeenCalledWith(expect.objectContaining({
      userId: 10,
      method: 'key',
      status: 'active',
      isPrimary: true,
    }));
  });

  it('works seamlessly through IUnitOfWork', async () => {
    ssiRepo.findDidByUserId.mockResolvedValue(Result.fail('Not found'));
    ssiRepo.saveDid.mockImplementation(async (record: any) => Result.ok(record));

    const useCase = new CreateDidUseCase(mockUow);
    const result = await useCase.execute({ userId: 10, method: 'web' });

    expect(result.isSuccess).toBe(true);
    expect(result.getValue().did).toMatch(/^did:web:[0-9a-f-]{36}$/);
    expect(mockUow.execute).toHaveBeenCalled();
  });

  it('HARDENED SECURITY P0 (Ataque 17): generates and exports holder private key for self-sovereignty', async () => {
    ssiRepo.findDidByUserId.mockResolvedValue(Result.fail('Not found'));
    ssiRepo.saveDid.mockImplementation(async (record: any) => Result.ok(record));

    const useCase = new CreateDidUseCase(ssiRepo);
    const result = await useCase.execute({ userId: 42, method: 'key' });

    expect(result.isSuccess).toBe(true);
    const didRecord = result.getValue();
    expect(didRecord.privateKeyMultibase).toBeDefined();
    expect(didRecord.privateKeyMultibase).toMatch(/^z[1-9A-HJ-NP-Za-km-z]+$/);
    expect(didRecord.privateKeyHex).toBeDefined();
    expect(didRecord.privateKeyHex).toHaveLength(64);
  });
});
