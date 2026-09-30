import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CivilIdentityController } from '@/interfaces/http/controllers/civil-identity/CivilIdentityController';
import { Result } from '@/shared/kernel/Result';

describe('CivilIdentityController', () => {
  let registerUseCase: any;
  let submitKycUseCase: any;
  let civilRepo: any;
  let controller: CivilIdentityController;

  beforeEach(() => {
    registerUseCase = { execute: vi.fn() };
    submitKycUseCase = { execute: vi.fn() };
    civilRepo = {
      findCitizenByUserId: vi.fn(),
      findDocumentsByUserId: vi.fn(),
      getLatestKycByUserId: vi.fn(),
    };
    controller = new CivilIdentityController(registerUseCase, submitKycUseCase, civilRepo);
  });

  function createMockContext(userId?: number, body?: any) {
    return {
      get: vi.fn((key: string) => {
        if (key === 'userId') return userId;
        if (key === 'user') return userId ? { userId } : undefined;
        return undefined;
      }),
      req: {
        json: vi.fn().mockResolvedValue(body || {}),
      },
      json: vi.fn((data: any, status = 200) => ({
        status,
        body: data,
      })),
    } as any;
  }

  describe('register', () => {
    it('returns 401 if user is not authenticated', async () => {
      const c = createMockContext(undefined);
      const res: any = await controller.register(c);
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('returns 201 with citizen data on success', async () => {
      const citizen = { userId: 5, legalFirstName: 'Ana', civilStatus: 'pending' };
      registerUseCase.execute.mockResolvedValue(Result.ok(citizen));

      const c = createMockContext(5, {
        legalFirstName: 'Ana',
        legalLastName: 'Pereira',
        nationalityCode: 'BR',
      });

      const res: any = await controller.register(c);
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual(citizen);
      expect(registerUseCase.execute).toHaveBeenCalledWith({
        userId: 5,
        legalFirstName: 'Ana',
        legalLastName: 'Pereira',
        nationalityCode: 'BR',
        birthDate: undefined,
        maritalStatus: undefined,
      });
    });

    it('returns 400 when use case fails validation', async () => {
      registerUseCase.execute.mockResolvedValue(Result.fail('Nome obrigatório'));
      const c = createMockContext(5, {});

      const res: any = await controller.register(c);
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('Nome obrigatório');
    });
  });

  describe('submitKyc', () => {
    it('returns 401 if user is not authenticated', async () => {
      const c = createMockContext(undefined);
      const res: any = await controller.submitKyc(c);
      expect(res.status).toBe(401);
    });

    it('returns 201 with kyc record on success', async () => {
      const kyc = { id: 10, userId: 5, status: 'submitted' };
      submitKycUseCase.execute.mockResolvedValue(Result.ok(kyc));

      const c = createMockContext(5, {
        documentType: 'cpf',
        documentNumber: '12345678901',
      });

      const res: any = await controller.submitKyc(c);
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual(kyc);
    });

    it('returns 400 when domain invariant fails (citizen does not exist)', async () => {
      submitKycUseCase.execute.mockResolvedValue(
        Result.fail('Cidadão não encontrado. É necessário registrar os dados civis antes de submeter verificação KYC.')
      );

      const c = createMockContext(5, {
        documentType: 'cpf',
        documentNumber: '12345678901',
      });

      const res: any = await controller.submitKyc(c);
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('Cidadão não encontrado');
    });
  });

  describe('getMe', () => {
    it('returns 401 if user is not authenticated', async () => {
      const c = createMockContext(undefined);
      const res: any = await controller.getMe(c);
      expect(res.status).toBe(401);
    });

    it('returns 200 with aggregated citizen, documentsCount, and latestKyc', async () => {
      const citizen = { userId: 5, legalFirstName: 'Ana', civilStatus: 'verified' };
      const docs = [{ id: 1 }, { id: 2 }];
      const kyc = { id: 10, status: 'approved' };

      civilRepo.findCitizenByUserId.mockResolvedValue(citizen);
      civilRepo.findDocumentsByUserId.mockResolvedValue(docs);
      civilRepo.getLatestKycByUserId.mockResolvedValue(kyc);

      const c = createMockContext(5);
      const res: any = await controller.getMe(c);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.citizen).toEqual(citizen);
      expect(res.body.data.documentsCount).toBe(2);
      expect(res.body.data.latestKyc).toEqual(kyc);
    });
  });
});
