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

      const res = (await controller.createUserWallet(c)) as any;
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

      const res = (await controller.createUserWallet(c)) as any;
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

      const res = (await controller.createUserWallet(c)) as any;
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

      const res = (await controller.batchCreateWallets(c)) as any;
      expect(res.status).toBe(400);
      expect(res.body.message).toContain('targetUserId é obrigatório no lote.');
    });

    it('should reject batch count exceeding safety limit of 50 or non-integer', async () => {
      const controller = createController();
      const c = {
        get: vi.fn().mockReturnValue(1),
        req: { json: vi.fn().mockResolvedValue({ count: 51, targetUserId: 1 }) },
        json: vi.fn((body, status) => ({ body, status })),
      } as any;

      const res = (await controller.batchCreateWallets(c)) as any;
      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Limite de segurança: O lote deve conter um número inteiro entre 1 e 50 carteiras.');
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

      const res = (await controller.batchCreateWallets(c)) as any;
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.errors).toHaveLength(1);
    });
  });

  describe('Web3WalletController - getUserWallets & getActiveWallet', () => {
    it('should return 200 with sanitized wallet list for authenticated user', async () => {
      const mockGetWallets = {
        execute: vi.fn().mockResolvedValue(
          Result.ok([
            { id: 1, address: '0x1', networkId: 56, provenance: 'internal', isPrimary: true },
            { id: 2, address: '0x2', networkId: 56, provenance: 'internal', isPrimary: false },
          ])
        ),
      };

      const controller = new Web3WalletController(mockUseCase as any, mockGetWallets as any);
      const c = {
        get: vi.fn((key) => (key === 'userId' ? 42 : undefined)),
        json: vi.fn((body, status) => ({ body, status })),
      } as any;

      const res = (await controller.getUserWallets(c)) as any;
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(2);
      expect(mockGetWallets.execute).toHaveBeenCalledWith({ userId: 42 });
    });

    it('should return 200 with active wallet or 404 if user has no active wallet', async () => {
      const mockGetActive = {
        execute: vi
          .fn()
          .mockResolvedValueOnce(Result.ok({ id: 1, address: '0x1', isPrimary: true }))
          .mockResolvedValueOnce(Result.ok(null)),
      };

      const controller = new Web3WalletController(mockUseCase as any, undefined, mockGetActive as any);
      const c = {
        get: vi.fn((key) => (key === 'userId' ? 42 : undefined)),
        json: vi.fn((body, status) => ({ body, status })),
      } as any;

      const res1 = (await controller.getActiveWallet(c)) as any;
      expect(res1.status).toBe(200);
      expect(res1.body.data.address).toBe('0x1');

      const res2 = (await controller.getActiveWallet(c)) as any;
      expect(res2.status).toBe(404);
      expect(res2.body.success).toBe(false);
    });

    it('should return 200 with on-chain balance when getWalletBalance succeeds', async () => {
      const mockGetBalance = {
        execute: vi.fn().mockResolvedValue(
          Result.ok({
            address: '0x1',
            native: { symbol: 'BNB', balanceFormatted: '1.5' },
            tokens: [{ symbol: 'USDT', balanceFormatted: '100' }],
          })
        ),
      };

      const controller = new Web3WalletController(mockUseCase as any, undefined, undefined, mockGetBalance as any);
      const c = {
        get: vi.fn((key) => (key === 'userId' ? 42 : undefined)),
        req: { param: vi.fn().mockReturnValue('0x1111222233334444555566667777888899990000') },
        json: vi.fn((body, status) => ({ body, status })),
      } as any;

      const res = (await controller.getWalletBalance(c)) as any;
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.native.balanceFormatted).toBe('1.5');
      expect(res.body.data.tokens[0].symbol).toBe('USDT');
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

    it('should reject unauthenticated request to /wallets (missing Bearer token)', async () => {
      const controller = createController();
      const router = createWeb3Router(controller);

      const res = await router.fetch(
        new Request('http://localhost/wallets', { method: 'GET' }),
        { JWT_SECRET: 'secret' } as any
      );

      expect(res.status).toBe(401);
    });

    it('should reject unauthenticated request to /wallets/active (missing Bearer token)', async () => {
      const controller = createController();
      const router = createWeb3Router(controller);

      const res = await router.fetch(
        new Request('http://localhost/wallets/active', { method: 'GET' }),
        { JWT_SECRET: 'secret' } as any
      );

      expect(res.status).toBe(401);
    });

    it('should reject unauthenticated request to /wallets/:address/balance (missing Bearer token)', async () => {
      const controller = createController();
      const router = createWeb3Router(controller);

      const res = await router.fetch(
        new Request('http://localhost/wallets/0x1111222233334444555566667777888899990000/balance', { method: 'GET' }),
        { JWT_SECRET: 'secret' } as any
      );

      expect(res.status).toBe(401);
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
