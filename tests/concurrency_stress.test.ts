import { describe, it, expect } from 'vitest';
import { DrizzleFinanceRepository } from '../src/infrastructure/repositories/DrizzleFinanceRepository';
import { DrizzleAuthenticationRepositoryAdapter } from '../src/infrastructure/repositories/DrizzleAuthenticationRepositoryAdapter';
import { DrizzleAuthTransactionRepository } from '../src/infrastructure/repositories/DrizzleAuthTransactionRepository';
import { AuthenticationTransaction } from '../src/domains/identity/entities/AuthenticationTransaction';

describe('Concurrency & Double-Spend Forensic Stress Suite', () => {
  describe('Finance Domain - OCC Balance & Double-Spend Protection', () => {
    it('enforces OCC atomicity: only 1 of N concurrent updates targeting version 1 succeeds', async () => {
      let currentBalance = 100;
      let currentVersion = 1;

      const mockDb = {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: async () => [{ id: 1, availableBaseUnits: currentBalance, version: currentVersion, accountClass: 'asset' }],
            }),
          }),
        }),
        update: () => ({
          set: () => ({
            where: () => {
              if (currentVersion === 1) {
                currentBalance -= 50;
                currentVersion += 1;
                return { meta: { changes: 1 }, rowsAffected: 1 };
              }
              return { meta: { changes: 0 }, rowsAffected: 0 };
            },
          }),
        }),
      };

      const repo = new DrizzleFinanceRepository(mockDb as any);

      // Issue 10 simultaneous debit requests of $50 each, all reading version 1
      const attempts = Array.from({ length: 10 }).map(() =>
        repo.updateBalanceWithOCC('1', '1', 50n, 'debit')
      );

      const results = await Promise.all(attempts);
      const successes = results.filter((res) => res === 'UPDATED');
      const failures = results.filter((res) => res === 'OCC_CONFLICT');

      // Exactly 1 update succeeds against version 1; the other 9 fail OCC!
      expect(successes.length).toBe(1);
      expect(failures.length).toBe(9);
      expect(currentBalance).toBe(50);
    });

    it('rejects non-positive monetary amounts in OCC update', async () => {
      const mockDb = {};
      const repo = new DrizzleFinanceRepository(mockDb as any);

      await expect(
        repo.updateBalanceWithOCC('1', '1', -100n, 'debit')
      ).rejects.toThrow('Invalid base units amount for OCC update');
    });
  });

  describe('Identity/Auth Domain - WebAuthn Replay & Monotonicity', () => {
    it('enforces strictly monotonic signCount updates and rejects lower or equal counts', async () => {
      const currentSignCount = 10;

      const mockDb = {
        select: () => ({
          from: () => ({
            innerJoin: () => ({
              where: () => ({
                limit: async () => [
                  {
                    id: 1,
                    authenticatorId: 1,
                    userId: 1,
                    credentialId: 'cred-123',
                    publicKeyCose: 'cose',
                    signCount: currentSignCount,
                  },
                ],
              }),
            }),
          }),
        }),
        update: () => ({
          set: () => ({
            where: () => {
              return { meta: { changes: 0 }, rowsAffected: 0 };
            },
          }),
        }),
      };

      const authRepo = new DrizzleAuthenticationRepositoryAdapter(mockDb as any);

      // Attempting to update signCount with equal value (10 <= 10) -> Throws rollback error!
      await expect(
        authRepo.updateWebAuthnSignCount('cred-123', 10)
      ).rejects.toThrow('WebAuthn signCount rollback detected: 10 <= 10');

      // Attempting to update signCount with lower value (8 <= 10) -> Throws rollback error!
      await expect(
        authRepo.updateWebAuthnSignCount('cred-123', 8)
      ).rejects.toThrow('WebAuthn signCount rollback detected: 8 <= 10');
    });
  });

  describe('Auth Transaction OCC & Expiration', () => {
    it('rejects status update when transaction version mismatches or zero rows updated', async () => {
      const mockDb = {
        update: () => ({
          set: () => ({
            where: () => [],
          }),
        }),
      };

      const txRepo = new DrizzleAuthTransactionRepository(mockDb as any);

      const domainTx = new AuthenticationTransaction({
        id: 'tx-uuid-1',
        userId: 1,
        status: 'completed',
        initialAal: 1,
        currentAal: 2,
        targetAal: 2,
        method: 'webauthn',
        context: 'login',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 60000),
        failureCount: 0,
        authEpochAtStart: 1,
        riskLevel: 'low',
      });

      await expect(txRepo.updateTransaction(domainTx)).rejects.toThrow(
        'AuthenticationTransaction OCC failed or transaction locked'
      );
    });
  });
});
