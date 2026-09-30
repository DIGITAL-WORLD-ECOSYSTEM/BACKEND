import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SsiController } from '@/interfaces/http/controllers/ssi/SsiController';
import { Result } from '@/shared/kernel/Result';

describe('SsiController', () => {
  let createDidUseCase: any;
  let issueVcUseCase: any;
  let revokeVcUseCase: any;
  let ssiRepo: any;
  let verifyVcUseCase: any;
  let controller: SsiController;

  beforeEach(() => {
    createDidUseCase = { execute: vi.fn() };
    issueVcUseCase = { execute: vi.fn() };
    revokeVcUseCase = { execute: vi.fn() };
    ssiRepo = {
      findDidByUserId: vi.fn(),
      listVerifiableCredentialsByUserId: vi.fn(),
    };
    verifyVcUseCase = { execute: vi.fn() };

    controller = new SsiController(
      createDidUseCase,
      issueVcUseCase,
      revokeVcUseCase,
      ssiRepo,
      verifyVcUseCase
    );
  });

  function createMockContext(userId?: number, body?: any) {
    return {
      get: vi.fn((key: string) => {
        if (key === 'userId') return userId;
        if (key === 'user') return userId ? { userId } : undefined;
        return undefined;
      }),
      req: {
        json: vi.fn().mockImplementation(async () => {
          if (body === undefined) throw new Error('No body');
          return body;
        }),
      },
      json: vi.fn((data: any, status = 200) => ({
        status,
        body: data,
      })),
    } as any;
  }

  describe('createDid', () => {
    it('returns 401 if user is not authenticated', async () => {
      const c = createMockContext(undefined);
      const res: any = await controller.createDid(c);

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('não autenticado');
    });

    it('returns 400 if createDidUseCase returns failure', async () => {
      createDidUseCase.execute.mockResolvedValue(Result.fail('DID creation failed'));
      const c = createMockContext(1, { method: 'key' });

      const res: any = await controller.createDid(c);
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe('DID creation failed');
    });

    it('returns 201 with DID record on success', async () => {
      const didRecord = {
        id: 'uuid-1',
        userId: 1,
        did: 'did:key:z6Mk...',
        method: 'key',
        controller: 'did:key:z6Mk...',
      };
      createDidUseCase.execute.mockResolvedValue(Result.ok(didRecord));
      const c = createMockContext(1, { method: 'key' });

      const res: any = await controller.createDid(c);
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual(didRecord);
    });

    it('returns 500 when an unexpected exception is thrown', async () => {
      createDidUseCase.execute.mockRejectedValue(new Error('Fatal DB crash'));
      const c = createMockContext(1, { method: 'key' });

      const res: any = await controller.createDid(c);
      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Fatal DB crash');
    });
  });

  describe('issueCredential', () => {
    it('returns 401 if user is not authenticated', async () => {
      const c = createMockContext(undefined);
      const res: any = await controller.issueCredential(c);

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('sanitizes incoming claims against prototype pollution keys', async () => {
      issueVcUseCase.execute.mockResolvedValue(Result.ok({ id: 'vc-1' }));
      const maliciousBody = {
        credentialType: 'CivicIdentityCredential',
        claims: {
          name: 'Alice',
          __proto__: { isAdmin: true },
          constructor: { prototype: { poll: true } },
          prototype: { poll: true },
        },
      };
      const c = createMockContext(1, maliciousBody);

      await controller.issueCredential(c);

      expect(issueVcUseCase.execute).toHaveBeenCalled();
      const calledDto = issueVcUseCase.execute.mock.calls[0][0];
      expect(calledDto.claims).toEqual({ name: 'Alice' });
      expect(calledDto.claims.__proto__).toBe(Object.prototype);
      expect(calledDto.claims.constructor).toBe(Object);
    });

    it('returns 400 if issueVcUseCase fails', async () => {
      issueVcUseCase.execute.mockResolvedValue(Result.fail('Issuer key not found'));
      const c = createMockContext(1, { credentialType: 'CivicIdentityCredential', claims: {} });

      const res: any = await controller.issueCredential(c);
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe('Issuer key not found');
    });

    it('returns 201 with credential on success', async () => {
      const issuedVc = { id: 'vc-1', status: 'active' };
      issueVcUseCase.execute.mockResolvedValue(Result.ok(issuedVc));
      const c = createMockContext(1, { credentialType: 'CivicIdentityCredential', claims: { role: 'citizen' } });

      const res: any = await controller.issueCredential(c);
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual(issuedVc);
    });
  });

  describe('revokeCredential', () => {
    it('returns 401 if user is not authenticated', async () => {
      const c = createMockContext(undefined);
      const res: any = await controller.revokeCredential(c);

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('returns 400 if revokeVcUseCase fails (e.g. IDOR protection)', async () => {
      revokeVcUseCase.execute.mockResolvedValue(Result.fail('Acesso negado: você não é o titular desta credencial.'));
      const c = createMockContext(1, { credentialId: 'vc-999' });

      const res: any = await controller.revokeCredential(c);
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('Acesso negado');
    });

    it('returns 200 on successful revocation', async () => {
      revokeVcUseCase.execute.mockResolvedValue(Result.ok(undefined));
      const c = createMockContext(1, { credentialId: 'vc-1' });

      const res: any = await controller.revokeCredential(c);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toContain('revogada com sucesso');
    });
  });

  describe('listMyCredentials', () => {
    it('returns 401 if user is not authenticated', async () => {
      const c = createMockContext(undefined);
      const res: any = await controller.listMyCredentials(c);

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('returns 200 with DID and credentials list', async () => {
      const mockDid = { id: 'did-1', did: 'did:key:abc' };
      const mockVcs = [{ id: 'vc-1', status: 'active' }];
      ssiRepo.findDidByUserId.mockResolvedValue(Result.ok(mockDid));
      ssiRepo.listVerifiableCredentialsByUserId.mockResolvedValue(Result.ok(mockVcs));

      const c = createMockContext(1);
      const res: any = await controller.listMyCredentials(c);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.did).toEqual(mockDid);
      expect(res.body.data.credentials).toEqual(mockVcs);
    });
  });

  describe('verifyCredential', () => {
    it('returns 500 if verifyVcUseCase is not configured', async () => {
      const controllerWithoutVerify = new SsiController(
        createDidUseCase,
        issueVcUseCase,
        revokeVcUseCase,
        ssiRepo
      );
      const c = createMockContext(undefined, { credentialDocument: { id: 'urn:uuid:vc-1' } });

      const res: any = await controllerWithoutVerify.verifyCredential(c);
      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('não configurado');
    });

    it('returns 400 with isValid: false when verification fails', async () => {
      verifyVcUseCase.execute.mockResolvedValue(Result.fail('Assinatura criptográfica inválida'));
      const c = createMockContext(undefined, { credentialDocument: { id: 'urn:uuid:bad' } });

      const res: any = await controller.verifyCredential(c);
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.isValid).toBe(false);
      expect(res.body.message).toContain('inválida');
    });

    it('returns 200 with verified data when verification succeeds', async () => {
      const verificationData = {
        isValid: true,
        subjectId: 'did:key:subject',
        claims: { name: 'João Silva' },
        credentialType: 'CivicIdentityCredential',
      };
      verifyVcUseCase.execute.mockResolvedValue(Result.ok(verificationData));
      const c = createMockContext(undefined, { credentialDocument: { id: 'urn:uuid:good' } });

      const res: any = await controller.verifyCredential(c);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual(verificationData);
    });

    it('verifies credential embedded in a Verifiable Presentation with challenge', async () => {
      const vpPayload = {
        '@context': ['https://www.w3.org/2018/credentials/v1'],
        type: ['VerifiablePresentation'],
        verifiableCredential: [{ id: 'urn:uuid:vc-embedded' }],
        proof: {
          type: 'Ed25519Signature2020',
          challenge: 'random-nonce-12345',
        },
      };

      verifyVcUseCase.execute.mockResolvedValue(
        Result.ok({ isValid: true, subjectId: 'did:key:subject', claims: {} })
      );

      const c = createMockContext(undefined, vpPayload);
      const res: any = await controller.verifyCredential(c);

      expect(res.status).toBe(200);
      expect(verifyVcUseCase.execute).toHaveBeenCalledWith({
        credentialDocument: { id: 'urn:uuid:vc-embedded' },
      });
      expect(res.body.data.presentationChallenge).toBe('random-nonce-12345');
    });
  });

  describe('listMyCredentials with vault', () => {
    it('decrypts claims for the holder when cryptoVault is configured', async () => {
      const mockDid = { id: 'did-1', did: 'did:key:abc' };
      const mockVcs = [{ id: 'vc-1', status: 'active', encryptedClaims: 'vault_cipher' }];
      ssiRepo.findDidByUserId.mockResolvedValue(Result.ok(mockDid));
      ssiRepo.listVerifiableCredentialsByUserId.mockResolvedValue(Result.ok(mockVcs));

      const mockVault = {
        encrypt: vi.fn(),
        decrypt: vi.fn().mockResolvedValue(JSON.stringify({ name: 'Maria Souza', cpf: '00011122233' })),
      };

      const controllerWithVault = new SsiController(
        createDidUseCase,
        issueVcUseCase,
        revokeVcUseCase,
        ssiRepo,
        verifyVcUseCase,
        mockVault as any,
        'secret-key'
      );

      const c = createMockContext(1);
      const res: any = await controllerWithVault.listMyCredentials(c);

      expect(res.status).toBe(200);
      expect(mockVault.decrypt).toHaveBeenCalledWith('vault_cipher', 'secret-key');
      expect(res.body.data.credentials[0].claims).toEqual({ name: 'Maria Souza', cpf: '00011122233' });
    });
  });

  describe('administrative revocation', () => {
    it('allows administrative revocation when user has ssi.credential.revoke permission', async () => {
      revokeVcUseCase.execute.mockResolvedValue(Result.ok(undefined));
      const c = createMockContext(999, { credentialId: 'vc-1' });
      c.get.mockImplementation((key: string) => {
        if (key === 'userId') return 999;
        if (key === 'permissions') return ['ssi.credential.revoke'];
        return undefined;
      });

      const res: any = await controller.revokeCredential(c);

      expect(res.status).toBe(200);
      expect(revokeVcUseCase.execute).toHaveBeenCalledWith({
        credentialId: 'vc-1',
        actorUserId: 999,
        isIssuerOrAdmin: true,
      });
    });
  });
});

