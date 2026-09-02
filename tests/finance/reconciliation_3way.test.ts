import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { accountBalances, financialLedgerEntries } from '../../src/db/finance/tables';
import { users } from '../../src/db/user/tables';
import { FinanceBootstrapService } from '../../src/infrastructure/services/FinanceBootstrapService';
import { DrizzleFinanceRepository } from '../../src/infrastructure/repositories/DrizzleFinanceRepository';
import { DrizzleUnitOfWork } from '../../src/infrastructure/repositories/DrizzleUnitOfWork';
import { RecordTreasuryTransactionUseCase } from '../../src/application/finance/use-cases/RecordTreasuryTransactionUseCase';
import { runAllMigrationsLibSql } from '../test_helpers/runMigrations';
import { eq } from 'drizzle-orm';
import { unlinkSync, existsSync } from 'fs';

describe('3-Way Reconciliation Suite (External Provider <-> Ledger Projection <-> Materialized Balance)', () => {
  const dbFile = 'test_rec_3way.db';
  let sqlite: any;
  let db: any;
  let uow: DrizzleUnitOfWork;

  beforeAll(async () => {
    if (existsSync(dbFile)) {
      try { unlinkSync(dbFile); } catch (e) {}
    }
    sqlite = createClient({ url: `file:${dbFile}` });
    db = drizzle(sqlite);

    const uowDb = {
      ...db,
      transaction: async (cb: any) => {
        const t = await sqlite.transaction('write');
        const proxyDb = drizzle(t) as any;
        proxyDb.rollback = () => {
          throw new Error('DRIZZLE_ROLLBACK');
        };
        try {
          const res = await cb(proxyDb);
          await t.commit();
          return res;
        } catch (err: any) {
          try { await t.rollback(); } catch (e) {}
          if (err.message === 'DRIZZLE_ROLLBACK') return;
          throw err;
        }
      }
    };

    await runAllMigrationsLibSql(sqlite);
    uow = new DrizzleUnitOfWork(uowDb);
    await FinanceBootstrapService.seedSystemAccounts(db, { currencyCode: 'BRL' });
  }, 30000);

  afterAll(() => {
    try { sqlite.close(); } catch (e) {}
    try { unlinkSync(dbFile); } catch (e) {}
  });

  it('validates 3-way balance equality: External Provider Custody == Ledger Projection == Materialized Balance', async () => {
    // Insert user
    const [user] = await db.insert(users).values({
      name: 'Alice Reconciliation',
      email: 'alice.rec@example.com',
      emailNormalized: 'alice.rec@example.com',
      passwordHash: 'hash',
      role: 'user',
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    }).returning();

    const recordUseCase = new RecordTreasuryTransactionUseCase(uow);

    // 1. Perform deposit of 500.00 BRL (50000 base units)
    const depositRes = await recordUseCase.execute({
      userId: user.id,
      type: 'deposit',
      direction: 'INBOUND',
      amountBaseUnits: '50000',
      assetId: 1,
      description: 'Initial deposit',
      idempotencyKey: 'rec-dep-1',
    });
    expect(depositRes.isSuccess).toBe(true);

    // 2. Perform withdrawal of 200.00 BRL (20000 base units)
    const withdrawRes = await recordUseCase.execute({
      userId: user.id,
      type: 'withdrawal',
      direction: 'OUTBOUND',
      amountBaseUnits: '20000',
      assetId: 1,
      description: 'Partial withdrawal',
      idempotencyKey: 'rec-wd-1',
    });
    expect(withdrawRes.isSuccess).toBe(true);

    // Fetch user account
    const repo = new DrizzleFinanceRepository(db);
    const userAccRes = await repo.getOrCreateUserAccount(user.id);
    const userAccountId = userAccRes.getValue().id;

    // A. Materialized Balance
    const [balanceRow] = await db
      .select()
      .from(accountBalances)
      .where(eq(accountBalances.accountId, userAccountId));
    const materializedBalance = BigInt(balanceRow.availableBaseUnits);

    // B. Ledger Projection Balance
    const ledgerEntries = await db
      .select()
      .from(financialLedgerEntries)
      .where(eq(financialLedgerEntries.accountId, userAccountId));

    let ledgerProjection = 0n;
    for (const entry of ledgerEntries) {
      const amount = BigInt(entry.amountBaseUnits);
      if (entry.direction === 'credit') {
        ledgerProjection += amount; // Liability account: Credit increases
      } else {
        ledgerProjection -= amount; // Liability account: Debit decreases
      }
    }

    // C. Simulated External Provider Custody (Net Inbound = 50000 - 20000 = 30000)
    const externalProviderCustody = 30000n;

    // 3-Way Equality Assertion
    expect(materializedBalance).toBe(30000n);
    expect(ledgerProjection).toBe(30000n);
    expect(materializedBalance).toBe(ledgerProjection);
    expect(ledgerProjection).toBe(externalProviderCustody);
  });
});
