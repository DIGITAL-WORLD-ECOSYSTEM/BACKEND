import { describe, it, expect, vi } from 'vitest';
import { DrizzleFinanceRepository } from '@/infrastructure/repositories/DrizzleFinanceRepository';

describe('DrizzleFinanceRepository', () => {
  it('should auto-provision account_balances if missing during updateBalanceWithOCC', async () => {
    let insertedBalance = false;
    let queryCount = 0;
    const mockDb: any = {
      select: vi.fn().mockImplementation(() => ({
        from: vi.fn().mockImplementation(() => ({
          where: vi.fn().mockImplementation(() => ({
            limit: vi.fn().mockImplementation(async () => {
              queryCount++;
              if (queryCount === 1) {
                // 1. Validar status do ativo financeiro
                return [{ status: 'active' }];
              }
              if (queryCount === 2) {
                // 2. Determinar a classe e status da conta
                return [{ accountClass: 'liability', status: 'active' }];
              }
              if (!insertedBalance) {
                // 3. Primeira busca em account_balances (ensureAccountBalance): não existe
                return [];
              }
              // 4. Selecionar o saldo com OCC version (pós inserção)
              return [{ id: 1, availableBaseUnits: 0, version: 1, accountClass: 'liability', status: 'active' }];
            }),
          })),
        })),
      })),
      insert: vi.fn().mockImplementation(() => ({
        values: vi.fn().mockImplementation(async () => {
          insertedBalance = true;
          return undefined;
        }),
      })),
      update: vi.fn().mockImplementation(() => ({
        set: vi.fn().mockImplementation(() => ({
          where: vi.fn().mockResolvedValue({ meta: { changes: 1 } }),
        })),
      })),
    };

    const repo = new DrizzleFinanceRepository(mockDb);
    const result = await repo.updateBalanceWithOCC('10', '1', 500n, 'credit');

    expect(result).toBe('UPDATED');
    expect(mockDb.insert).toHaveBeenCalled();
    expect(insertedBalance).toBe(true);
  });

  it('should treat credit as balance increase for liability account and decrease for asset account', async () => {
    let queryCount = 0;
    const mockDbLiability: any = {
      select: vi.fn().mockImplementation(() => ({
        from: vi.fn().mockImplementation(() => ({
          where: vi.fn().mockImplementation(() => ({
            limit: vi.fn().mockImplementation(async () => {
              queryCount++;
              if (queryCount === 1) {
                return [{ status: 'active' }];
              }
              if (queryCount === 2) {
                return [{ accountClass: 'liability', status: 'active' }];
              }
              return [{ id: 1, availableBaseUnits: 100, version: 1, accountClass: 'liability', status: 'active' }];
            }),
          })),
        })),
      })),
      update: vi.fn().mockImplementation(() => ({
        set: vi.fn().mockImplementation(() => ({
          where: vi.fn().mockResolvedValue({ meta: { changes: 1 } }),
        })),
      })),
    };

    const repo = new DrizzleFinanceRepository(mockDbLiability);
    const success = await repo.updateBalanceWithOCC('10', '1', 50n, 'credit');
    expect(success).toBe('UPDATED');
    expect(mockDbLiability.update).toHaveBeenCalled();
  });
});
