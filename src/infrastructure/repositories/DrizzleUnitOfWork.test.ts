import { describe, it, expect, vi } from 'vitest';
import { DrizzleUnitOfWork } from './DrizzleUnitOfWork';
import { Result } from '../../shared/kernel/Result';

describe('DrizzleUnitOfWork', () => {
  it('should COMMIT when the callback returns a success Result', async () => {
    let commitTriggered = false;
    
    const mockTx = {
      isTx: true
    };
    
    const mockDb = {
      transaction: async (cb: any) => {
        await cb(mockTx);
        commitTriggered = true;
      }
    };

    const uow = new DrizzleUnitOfWork(mockDb);

    const result = await uow.execute(async (factory) => {
      return Result.ok();
    });

    expect(result.isSuccess).toBe(true);
    expect(commitTriggered).toBe(true);
  });

  it('should ROLLBACK when the callback returns a failure Result', async () => {
    let rollbackTriggered = false;
    
    const mockDb = {
      transaction: async (cb: any) => {
        try {
          await cb({
            isTx: true,
            rollback: () => {
              rollbackTriggered = true;
              throw new Error('Rollback');
            }
          });
        } catch (e: any) {
          if (e.message !== 'Rollback') {
            throw e;
          }
        }
      }
    };

    const uow = new DrizzleUnitOfWork(mockDb);

    const result = await uow.execute(async (factory) => {
      return Result.fail('Regra de negocio falhou');
    });

    expect(result.isFailure).toBe(true);
    expect(result.error).toBe('Regra de negocio falhou');
    expect(rollbackTriggered).toBe(true);
  });

  it('Repository Identity Test: should provide the EXACT SAME tx object to all repositories requested', async () => {
    const mockTx = {
      id: 'mock-tx-123',
      select: vi.fn(),
    };
    
    const mockDb = {
      transaction: async (cb: any) => {
        await cb(mockTx);
      }
    };

    const uow = new DrizzleUnitOfWork(mockDb);

    await uow.execute(async (factory) => {
      const userRepo = factory.getUserRepository() as any;
      const authRepo = factory.getAuthenticationRepository() as any;
      
      expect(userRepo.db).toBe(mockTx);
      expect(authRepo.db).toBe(mockTx);
      expect(userRepo.db).toBe(authRepo.db);
      
      return Result.ok();
    });
  });

  it('should isolate repositories so UseCase NEVER knows about Drizzle or DB', async () => {
    const mockDb = {
      transaction: async (cb: any) => await cb({ isTx: true })
    };

    const uow = new DrizzleUnitOfWork(mockDb);

    await uow.execute(async (factory) => {
      const repo = factory.getUserRepository();
      expect(repo.findByEmail).toBeDefined();
      expect((factory as any).tx).toBeUndefined();
      
      return Result.ok();
    });
  });

  it('Concurrent Writes: Multiple UoWs run independently', async () => {
    let transactionsRun = 0;
    
    const mockDb = {
      transaction: async (cb: any) => {
        transactionsRun++;
        await cb({ isTx: true });
      }
    };

    const uow1 = new DrizzleUnitOfWork(mockDb);
    const uow2 = new DrizzleUnitOfWork(mockDb);

    await Promise.all([
      uow1.execute(async () => Result.ok()),
      uow2.execute(async () => Result.ok())
    ]);

    expect(transactionsRun).toBe(2);
  });
});
