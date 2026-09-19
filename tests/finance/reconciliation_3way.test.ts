import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { accountBalances, financialLedgerEntries, fiatProviders } from '../../src/db/finance/tables';
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

  it('supports ingestion-first model with fingerprint idempotency and reconciliation matching', async () => {
    const repo = new DrizzleFinanceRepository(db);

    // Ensure fiat provider exists
    const [existingProvider] = await db.select().from(fiatProviders).where(eq(fiatProviders.id, 1));
    if (!existingProvider) {
      await db.insert(fiatProviders).values({
        id: 1,
        name: 'Banco Itaú',
        code: 'ITAU',
        type: 'bank',
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    const fingerprint = 'sha256:itau:tx-bank-999:2026-09-18:500.00:credit';

    // 1. Ingest bank transaction without financial_transaction_id
    const insertRes = await repo.insertFiatExternalTransaction({
      providerId: 1,
      externalTransactionId: 'EXT-TX-999',
      rawAmount: '500.00',
      amountBaseUnits: '50000',
      direction: 'credit',
      assetId: 1,
      rawDescription: 'TED RECEBIDA - CLIENTE ALICE',
      bankTimestamp: new Date('2026-09-18T12:00:00Z'),
      sourceFile: 'extrato_itau_20260918.ofx',
      sourceFileHash: 'hash-file-ofx-001',
      rowFingerprint: fingerprint,
      status: 'pending',
      reconciliationStatus: 'unmatched',
      financialTransactionId: null,
    });

    expect(insertRes.isSuccess).toBe(true);
    const externalTxId = insertRes.getValue();
    expect(externalTxId).toBeGreaterThan(0);

    // 2. Query by fingerprint
    const queryRes = await repo.getFiatExternalTransactionByFingerprint(fingerprint);
    expect(queryRes.isSuccess).toBe(true);
    const fetched = queryRes.getValue();
    expect(fetched).not.toBeNull();
    expect(fetched.externalTransactionId).toBe('EXT-TX-999');
    expect(fetched.reconciliationStatus).toBe('unmatched');
    expect(fetched.financialTransactionId).toBeNull();

    // 3. Ingesting again with same fingerprint should fail or return error due to unique index
    const dupRes = await repo.insertFiatExternalTransaction({
      providerId: 1,
      externalTransactionId: 'EXT-TX-999-DUP',
      rawAmount: '500.00',
      direction: 'credit',
      rowFingerprint: fingerprint,
    });
    expect(dupRes.isFailure).toBe(true);

    // 4. Update reconciliation status to 'matched' with internal transaction
    const updateRes = await repo.updateFiatExternalTransactionReconciliation(externalTxId, {
      status: 'completed',
      reconciliationStatus: 'matched',
      financialTransactionId: 1,
    });
    expect(updateRes.isSuccess).toBe(true);

    const reFetchedRes = await repo.getFiatExternalTransactionByFingerprint(fingerprint);
    expect(reFetchedRes.isSuccess).toBe(true);
    const updated = reFetchedRes.getValue();
    expect(updated.reconciliationStatus).toBe('matched');
    expect(updated.status).toBe('completed');
    expect(updated.financialTransactionId).toBe(1);
  });
});

