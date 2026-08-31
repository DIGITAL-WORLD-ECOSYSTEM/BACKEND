import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { unlinkSync, existsSync } from 'fs';
import { DrizzleUnitOfWork } from '../../src/infrastructure/repositories/DrizzleUnitOfWork';
import { FinanceBootstrapService } from '../../src/infrastructure/services/FinanceBootstrapService';
import { runAllMigrationsLibSql } from '../test_helpers/runMigrations';

describe('Gate 4: Failure Injection Matrix & Atomic Rollback Certification (FIN-015 / FIN-024)', () => {
  const dbFile = 'test_failure_injection.db';
  let sqlite: any;
  let db: any;

  beforeEach(async () => {
    if (existsSync(dbFile)) {
      try { unlinkSync(dbFile); } catch (e) {}
    }
    sqlite = createClient({ url: `file:${dbFile}` });
    db = drizzle(sqlite);

    await runAllMigrationsLibSql(sqlite);

    // Ensure user 1 exists for FK constraint
    await sqlite.execute(`INSERT INTO users (id, email, email_normalized, status, created_at, updated_at) VALUES (1, 'user1@test.com', 'user1@test.com', 'active', 1000, 1000)`);
  });

  afterEach(() => {
    try { unlinkSync(dbFile); } catch (e) {}
  });

  it('guarantees 100% atomic rollback on error during transaction execution', async () => {
    const uowDb = {
      ...db,
      transaction: async (cb: any) => {
        const t = await sqlite.transaction('write');
        const proxyDb = drizzle(t) as any;
        proxyDb.rollback = () => {
          throw new Error('DRIZZLE_ROLLBACK');
        };
        try {
          await cb(proxyDb);
          await t.commit();
        } catch (err: any) {
          try { await t.rollback(); } catch (e) {}
          if (err.message === 'DRIZZLE_ROLLBACK') return;
          throw err;
        }
      }
    };

    await FinanceBootstrapService.seedSystemAccounts(uowDb, { currencyCode: 'BRL' });
    const uow = new DrizzleUnitOfWork(uowDb);

    const countBeforeTx = Number((await sqlite.execute('SELECT COUNT(*) as c FROM financial_transactions')).rows[0].c);
    const countBeforeLedger = Number((await sqlite.execute('SELECT COUNT(*) as c FROM financial_ledger_entries')).rows[0].c);
    const countBeforeIdem = Number((await sqlite.execute('SELECT COUNT(*) as c FROM idempotency_keys')).rows[0].c);

    // Inject failure inside transaction boundary
    const result = await uow.execute(async (factory) => {
      const repo = factory.getFinanceRepository();

      await repo.claimIdempotency('fail-key-1', 1, 'finance', 'hash1');
      await repo.insertTransaction({
        userId: 1,
        type: 'deposit',
        category: 'deposit',
        description: 'Failed Deposit Test',
        status: 'processing',
      });

      // Simulate crash inside UoW Transaction
      throw new Error('Simulated Crash inside UoW Transaction');
    });

    expect(result.isFailure).toBe(true);
    expect(result.error).toContain('Simulated Crash inside UoW Transaction');

    const countAfterTx = Number((await sqlite.execute('SELECT COUNT(*) as c FROM financial_transactions')).rows[0].c);
    const countAfterLedger = Number((await sqlite.execute('SELECT COUNT(*) as c FROM financial_ledger_entries')).rows[0].c);
    const countAfterIdem = Number((await sqlite.execute('SELECT COUNT(*) as c FROM idempotency_keys')).rows[0].c);

    // Zero partial writes persisted
    expect(countAfterTx).toBe(countBeforeTx);
    expect(countAfterLedger).toBe(countBeforeLedger);
    expect(countAfterIdem).toBe(countBeforeIdem);
  });
});
