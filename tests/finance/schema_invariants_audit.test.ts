import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import {
  financialAssets,
  financialAccounts,
  financialTransactions,
  accountBalances,
  reconciliationRecords,
  MAX_UINT256_BASE_UNITS_TEXT,
} from '../../src/db/finance/tables';
import { runAllMigrationsLibSql } from '../test_helpers/runMigrations';
import { unlinkSync, existsSync } from 'fs';

describe('Schema Invariants & Security Audit Verification (FIN-DB-001, 004, 008, 011)', () => {
  const dbFile = 'test_schema_audit.db';
  let sqlite: any;
  let db: any;

  async function expectCheckViolation(promise: Promise<any>, constraintPattern = /CHECK constraint failed/i) {
    try {
      await promise;
      expect.unreachable('Expected query to fail with CHECK constraint violation');
    } catch (err: any) {
      const fullMsg = `${err.message || ''} ${err.cause?.message || ''} ${String(err)}`;
      expect(fullMsg).toMatch(constraintPattern);
    }
  }

  beforeAll(async () => {
    if (existsSync(dbFile)) {
      try { unlinkSync(dbFile); } catch (e) {}
    }
    sqlite = createClient({ url: `file:${dbFile}` });
    db = drizzle(sqlite);

    await runAllMigrationsLibSql(sqlite);

    // Seed minimal fixtures
    await sqlite.execute(
      `INSERT INTO financial_assets (id, code, symbol, name, decimals, type, status, created_at, updated_at)
       VALUES (1, 'USD', 'USD', 'US Dollar', 2, 'fiat', 'active', 1000, 1000);`
    );
    await sqlite.execute(
      `INSERT INTO financial_accounts (id, user_id, account_type, account_class, status, name, version, created_at, updated_at)
       VALUES (1, NULL, 'treasury', 'asset', 'active', 'Treasury', 1, 1000, 1000);`
    );
  }, 30000);

  afterAll(() => {
    try { sqlite.close(); } catch (e) {}
    try { unlinkSync(dbFile); } catch (e) {}
  });

  describe('FIN-DB-001 & FIN-DB-008: Reconciliation Exact Balance Matching Constraints', () => {
    it('permits matched record when expected == actual and difference == 0', async () => {
      await expect(
        db.insert(reconciliationRecords).values({
          accountId: 1,
          assetId: 1,
          expectedBalanceBaseUnits: '10000',
          actualBalanceBaseUnits: '10000',
          differenceBaseUnits: '0',
          status: 'matched',
          reconciliationRunId: 'run-matched-ok',
        })
      ).resolves.toBeDefined();
    });

    it('rejects matched record when expected != actual even if difference is passed as 0 (false match)', async () => {
      await expectCheckViolation(
        db.insert(reconciliationRecords).values({
          accountId: 1,
          assetId: 1,
          expectedBalanceBaseUnits: '10000',
          actualBalanceBaseUnits: '10500', // differs!
          differenceBaseUnits: '0',        // falsified 0 difference!
          status: 'matched',
          reconciliationRunId: 'run-matched-fraud',
        }),
        /ck_reconciliation_status_difference/i
      );
    });

    it('permits mismatch record when expected != actual and difference != 0', async () => {
      await expect(
        db.insert(reconciliationRecords).values({
          accountId: 1,
          assetId: 1,
          expectedBalanceBaseUnits: '10000',
          actualBalanceBaseUnits: '10500',
          differenceBaseUnits: '500',
          status: 'mismatch',
          reconciliationRunId: 'run-mismatch-ok',
        })
      ).resolves.toBeDefined();
    });

    it('rejects mismatch record when expected == actual even if difference is reported as non-zero (false mismatch)', async () => {
      await expectCheckViolation(
        db.insert(reconciliationRecords).values({
          accountId: 1,
          assetId: 1,
          expectedBalanceBaseUnits: '10000',
          actualBalanceBaseUnits: '10000', // identical!
          differenceBaseUnits: '50',       // fake difference!
          status: 'mismatch',
          reconciliationRunId: 'run-mismatch-fraud',
        }),
        /ck_reconciliation_status_difference/i
      );
    });

    it('rejects resolved record when expected == actual (cannot resolve what is not mismatched)', async () => {
      await expectCheckViolation(
        db.insert(reconciliationRecords).values({
          accountId: 1,
          assetId: 1,
          expectedBalanceBaseUnits: '10000',
          actualBalanceBaseUnits: '10000',
          differenceBaseUnits: '50',
          status: 'resolved',
          reconciliationRunId: 'run-resolved-fraud',
          resolvedAt: new Date(),
          resolvedByUserId: null,
        }),
        /CHECK constraint failed/i
      );
    });
  });

  describe('FIN-DB-011: uint256 Persistence Boundary & Canonical Decimal Formatting', () => {
    it('accepts zero (0) in balance columns', async () => {
      await expect(
        db.insert(accountBalances).values({
          accountId: 1,
          assetId: 1,
          availableBaseUnits: '0',
          lockedBaseUnits: '0',
        })
      ).resolves.toBeDefined();
    });

    it('accepts values strictly above JavaScript 53-bit MAX_SAFE_INTEGER (9007199254740991)', async () => {
      const over53Bit = '9007199254740992';
      await expect(
        db.update(accountBalances).set({
          availableBaseUnits: over53Bit,
        })
      ).resolves.toBeDefined();
    });

    it('accepts exact MAX_UINT256 (2^256 - 1)', async () => {
      await expect(
        db.update(accountBalances).set({
          availableBaseUnits: MAX_UINT256_BASE_UNITS_TEXT,
        })
      ).resolves.toBeDefined();
    });

    it('rejects values strictly exceeding MAX_UINT256 (2^256 - 1) with 78 digits', async () => {
      // Last digit 5 changed to 6
      const overflow78Digits = '115792089237316195423570985008687907853269984665640564039457584007913129639936';
      await expectCheckViolation(
        db.update(accountBalances).set({
          availableBaseUnits: overflow78Digits,
        })
      );
    });

    it('rejects numbers with 79 digits or more', async () => {
      const overflow79Digits = '1' + '0'.repeat(78); // 79 digits
      await expectCheckViolation(
        db.update(accountBalances).set({
          availableBaseUnits: overflow79Digits,
        })
      );
    });

    it('rejects numbers with leading zeroes (non-canonical)', async () => {
      await expectCheckViolation(
        db.update(accountBalances).set({
          availableBaseUnits: '0100',
        })
      );
    });

    it('rejects negative numbers for unsigned amounts', async () => {
      await expectCheckViolation(
        db.update(accountBalances).set({
          availableBaseUnits: '-100',
        })
      );
    });

    it('rejects floating point decimals in baseUnits', async () => {
      await expectCheckViolation(
        db.update(accountBalances).set({
          availableBaseUnits: '100.50',
        })
      );
    });

    it('rejects strings with whitespace padding', async () => {
      await expectCheckViolation(
        db.update(accountBalances).set({
          availableBaseUnits: ' 100 ',
        })
      );
    });
  });

  describe('FIN-DB-004: Self-referential Foreign Key Typing & Compilation', () => {
    it('verifies financialTransactions compiles and references self without type escapes', () => {
      expect(financialTransactions.reversalOfTransactionId).toBeDefined();
      expect(financialTransactions.refundOfTransactionId).toBeDefined();
    });
  });
});
