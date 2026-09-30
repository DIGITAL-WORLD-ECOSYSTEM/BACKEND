import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { Web3WalletController } from '@/interfaces/http/controllers/web3/Web3WalletController';
import { createWeb3Router } from '@/interfaces/http/routes/web3/web3.routes';
import { Result } from '@/shared/kernel/Result';

describe('Web3WalletController & Web3 Routes (P1 Shielding)', () => {
  const mockUseCase = {
    execute: vi.fn(),
  };

  const createController = () => new Web3WalletController(mockUseCase as any);

  describe('Web3WalletController - createUserWallet', () => {
    it('should reject unauthenticated request when userId is missing', async () => {
      const controller = createController();
      const c = {
        get: vi.fn().mockReturnValue(undefined),
        req: { json: vi.fn().mockResolvedValue({}) },
        json: vi.fn((body, status) => ({ body, status })),
      } as any;

      const res = await controller.createUserWallet(c);
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('Acesso negado: Usuário não autenticado.');
    });

    it('should correctly extract userId from sessionGuard c.get("userId")', async () => {
      const controller = createController();
      mockUseCase.execute.mockResolvedValueOnce(
        Result.ok({ walletId: 10, address: '0x1234567890123456789012345678901234567890' })
      );

      const c = {
        get: vi.fn((key: string) => {
          if (key === 'userId') return 42;
          if (key === 'user') return { userId: 42, sessionId: 'sess-1' };
          return undefined;
        }),
        req: {
          json: vi.fn().mockResolvedValue({ networkId: 56, label: 'BSC Wallet', isPrimary: true }),
        },
        json: vi.fn((body, status) => ({ body, status })),
      } as any;

      const res = await controller.createUserWallet(c);
      expect(mockUseCase.execute).toHaveBeenCalledWith({
        userId: 42,
        networkId: 56,
        label: 'BSC Wallet',
        isPrimary: true,
      });
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.walletId).toBe(10);
    });

    it('should support user.userId when c.get("userId") is not explicitly set', async () => {
      const controller = createController();
      mockUseCase.execute.mockResolvedValueOnce(
        Result.ok({ walletId: 11, address: '0xabcdef' })
      );

      const c = {
        get: vi.fn((key: string) => {
          if (key === 'user') return { userId: 99 };
          return undefined;
        }),
        req: { json: vi.fn().mockResolvedValue({}) },
        json: vi.fn((body, status) => ({ body, status })),
      } as any;

      const res = await controller.createUserWallet(c);
      expect(mockUseCase.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 99,
          networkId: 1,
        })
      );
      expect(res.status).toBe(201);
    });
  });

  describe('Web3WalletController - batchCreateWallets', () => {
    it('should reject when targetUserId is missing and caller is unauthenticated', async () => {
      const controller = createController();
      const c = {
        get: vi.fn().mockReturnValue(undefined),
        req: { json: vi.fn().mockResolvedValue({ count: 5 }) },
        json: vi.fn((body, status) => ({ body, status })),
      } as any;

      const res = await controller.batchCreateWallets(c);
      expect(res.status).toBe(400);
      expect(res.body.message).toContain('targetUserId é obrigatório no lote.');
    });

    it('should reject batch count exceeding safety limit of 500', async () => {
      const controller = createController();
      const c = {
        get: vi.fn().mockReturnValue(1),
        req: { json: vi.fn().mockResolvedValue({ count: 501, targetUserId: 1 }) },
        json: vi.fn((body, status) => ({ body, status })),
      } as any;

      const res = await controller.batchCreateWallets(c);
      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Limite de segurança: O lote deve conter entre 1 e 500 carteiras.');
    });

    it('should execute batch creation and aggregate results', async () => {
      const controller = createController();
      mockUseCase.execute
        .mockResolvedValueOnce(Result.ok({ walletId: 1, address: '0x1' }))
        .mockResolvedValueOnce(Result.fail('Database error'))
        .mockResolvedValueOnce(Result.ok({ walletId: 3, address: '0x3' }));

      const c = {
        get: vi.fn().mockReturnValue(1),
        req: { json: vi.fn().mockResolvedValue({ count: 3, targetUserId: 10, networkId: 56 }) },
        json: vi.fn((body, status) => ({ body, status })),
      } as any;

      const res = await controller.batchCreateWallets(c);
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.errors).toHaveLength(1);
    });
  });

  describe('Web3 Route Protection with sessionGuard and RBAC', () => {
    it('should reject unauthenticated request to /wallets/create (missing Bearer token)', async () => {
      const controller = createController();
      const router = createWeb3Router(controller);

      const res = await router.fetch(
        new Request('http://localhost/wallets/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ networkId: 56 }),
        }),
        { JWT_SECRET: 'secret' } as any
      );

      expect(res.status).toBe(401);
      const data = await res.json() as any;
      expect(data.success).toBe(false);
      expect(data.message).toContain('Authentication required (Bearer token missing).');
    });

    it('should reject unauthenticated request to /admin/wallets/batch (missing Bearer token)', async () => {
      const controller = createController();
      const router = createWeb3Router(controller);

      const res = await router.fetch(
        new Request('http://localhost/admin/wallets/batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ count: 10, targetUserId: 1 }),
        }),
        { JWT_SECRET: 'secret' } as any
      );

      expect(res.status).toBe(401);
      const data = await res.json() as any;
      expect(data.success).toBe(false);
    });
  });
});
