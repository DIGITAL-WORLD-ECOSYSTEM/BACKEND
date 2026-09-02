import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { unlinkSync, existsSync } from 'fs';
import { DrizzleUnitOfWork } from '../../src/infrastructure/repositories/DrizzleUnitOfWork';
import { FinanceBootstrapService } from '../../src/infrastructure/services/FinanceBootstrapService';
import { Money256 } from '../../src/domains/finance/value-objects/Money256';
import { AccountingEntryPolicy } from '../../src/domains/finance/policies/AccountingEntryPolicy';
import { LedgerTransaction, LedgerEntry } from '../../src/domains/finance/entities/LedgerTransaction';
import { FinancialTransactionOrchestrator } from '../../src/application/finance/services/FinancialTransactionOrchestrator';
import { runAllMigrationsLibSql } from '../test_helpers/runMigrations';
import { Result } from '../../src/shared/kernel/Result';

describe('Gate 4: Real Double-Spend Multi-Client Concurrency Stress Certification', () => {
  const dbFile = 'test_concurrency_stress.db';
  let sqlite: any;
  let db: any;

  beforeAll(async () => {
    if (existsSync(dbFile)) {
      try { unlinkSync(dbFile); } catch (e) {}
    }
    sqlite = createClient({ url: `file:${dbFile}` });
    db = drizzle(sqlite);
    await runAllMigrationsLibSql(sqlite);
  }, 30000);

  afterAll(() => {
    try { sqlite.close(); } catch (e) {}
    try { unlinkSync(dbFile); } catch (e) {}
  });

  it('proves zero double-spend under 10 concurrent debit requests', async () => {
    // 1. Bootstrap system accounts and asset BRL (assetId = 1)
    const bootstrapRes = await FinanceBootstrapService.seedSystemAccounts(db, {
      currencyCode: 'BRL',
      initialBalanceBaseUnits: 1000n, // Treasury initial balance
    });
    expect(bootstrapRes.isSuccess).toBe(true);
    const { assetId, treasuryAccountId } = bootstrapRes.getValue();

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

    const uow = new DrizzleUnitOfWork(uowDb);

    // Ensure user 42 exists for FK constraint
    await sqlite.execute(`INSERT INTO users (id, email, email_normalized, status, created_at, updated_at) VALUES (42, 'user42@test.com', 'user42@test.com', 'active', 1000, 1000)`);

    // 2. Deposit 100 base units into User Account #42
    const depositRes = await uow.execute(async (factory) => {
      const repo = factory.getFinanceRepository();
      const userAccRes = await repo.getOrCreateUserAccount(42);
      const userAccountId = userAccRes.getValue().id;

      const entriesRaw = AccountingEntryPolicy.createDepositEntries({
        treasuryAccountId,
        userAccountId,
        amount: Money256.fromString('100', assetId),
        description: 'Initial User 42 Balance',
      });

      const ledgerEntries = entriesRaw.map(
        (r) =>
          new LedgerEntry({
            accountId: String(r.accountId),
            amount: r.amount as any,
            type: r.entryType,
            description: r.description,
          })
      );

      const tx = new LedgerTransaction({
        idempotencyKey: 'deposit-init-42',
        description: 'Initial Deposit',
        entries: ledgerEntries,
        transactionType: 'deposit',
        userId: 42,
      });

      const orchestrator = new FinancialTransactionOrchestrator(repo);
      return Result.ok(await orchestrator.executePosting(tx));
    });

    if (depositRes.isFailure) console.error('DEPOSIT 42 FAILED:', depositRes.error);
    expect(depositRes.getValue().transactionId).toBeDefined();

    // 3. Launch 10 concurrent debit requests of 20 base units each
    const concurrentRequests = Array.from({ length: 10 }).map((_, idx) => async () => {
      try {
        const res = await uow.execute(async (factory) => {
          const repo = factory.getFinanceRepository();
          const userAccRes = await repo.getOrCreateUserAccount(42);
          const userAccountId = userAccRes.getValue().id;

          const entriesRaw = AccountingEntryPolicy.createWithdrawalEntries({
            treasuryAccountId,
            userAccountId,
            amount: Money256.fromString('20', assetId),
            description: `Concurrent Debit #${idx + 1}`,
          });

          const ledgerEntries = entriesRaw.map(
            (r) =>
              new LedgerEntry({
                accountId: String(r.accountId),
                amount: r.amount as any,
                type: r.entryType,
                description: r.description,
              })
          );

          const tx = new LedgerTransaction({
            idempotencyKey: `debit-concurrent-${idx + 1}`,
            description: `Debit #${idx + 1}`,
            entries: ledgerEntries,
            transactionType: 'withdrawal',
            userId: 42,
          });

          const orchestrator = new FinancialTransactionOrchestrator(repo);
          return Result.ok(await orchestrator.executePosting(tx));
        });
        if (res.isFailure) {
          console.log(`Debit #${idx + 1} failed:`, res.error);
          return { error: res.error };
        }
        return res;
      } catch (err: any) {
        console.log(`Debit #${idx + 1} threw:`, err.message);
        return { error: err.message || 'Debit failed' };
      }
    });

    const results = await Promise.all(concurrentRequests.map((fn) => fn()));

    const successful = results.filter((r: any) => r && r.isSuccess === true);
    const failed = results.filter((r: any) => !r || r.isSuccess !== true);

    console.log(`SUCCESSFUL: ${successful.length}, FAILED: ${failed.length}`);

    // Verify User 42 final balance is non-negative and zero double spend
    const finalBalanceRes = await sqlite.execute('SELECT available_base_units FROM account_balances WHERE account_id = (SELECT id FROM financial_accounts WHERE user_id = 42)');
    const finalBal = BigInt(finalBalanceRes.rows[0].available_base_units);
    
    // Total debited = successful.length * 20
    // Remaining balance + debited MUST EQUAL initial balance (100)
    expect(finalBal + BigInt(successful.length * 20)).toBe(100n);
    expect(finalBal >= 0n).toBe(true);
  });

  it('Gate B: Multi-Client Independent Connections Concurrency Stress Certification', async () => {
    const dbFileB = 'test_concurrency_stress_b.db';
    if (existsSync(dbFileB)) {
      try { unlinkSync(dbFileB); } catch (e) {}
    }
    const sqliteB = createClient({ url: `file:${dbFileB}` });
    const dbB = drizzle(sqliteB);
    await runAllMigrationsLibSql(sqliteB);

    // 1. Setup initial balance with primary DB connection
    const bootstrapRes = await FinanceBootstrapService.seedSystemAccounts(dbB, {
      currencyCode: 'BRL',
      initialBalanceBaseUnits: 1000n,
    });
    expect(bootstrapRes.isSuccess).toBe(true);
    const { assetId, treasuryAccountId } = bootstrapRes.getValue();

    await sqliteB.execute(`INSERT INTO users (id, email, email_normalized, status, created_at, updated_at) VALUES (55, 'user55@test.com', 'user55@test.com', 'active', 1000, 1000)`);

    // Initial deposit of 200 units to user 55
    const primaryUow = new DrizzleUnitOfWork({
      ...dbB,
      transaction: async (cb: any) => {
        const t = await sqliteB.transaction('write');
        const proxyDb = drizzle(t) as any;
        proxyDb.rollback = () => { throw new Error('DRIZZLE_ROLLBACK'); };
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
    });

    const initDepRes = await primaryUow.execute(async (factory) => {
      const repo = factory.getFinanceRepository();
      const userAccRes = await repo.getOrCreateUserAccount(55);
      const userAccountId = userAccRes.getValue().id;

      const entriesRaw = AccountingEntryPolicy.createDepositEntries({
        treasuryAccountId,
        userAccountId,
        amount: Money256.fromString('200', assetId),
        description: 'Initial Deposit User 55',
      });

      const ledgerEntries = entriesRaw.map(
        (r) => new LedgerEntry({ accountId: String(r.accountId), amount: r.amount as any, type: r.entryType, description: r.description })
      );

      const tx = new LedgerTransaction({
        idempotencyKey: 'deposit-init-55',
        description: 'Initial Deposit User 55',
        entries: ledgerEntries,
        transactionType: 'deposit',
        userId: 55,
      });

      const orchestrator = new FinancialTransactionOrchestrator(repo);
      return Result.ok(await orchestrator.executePosting(tx));
    });

    if (initDepRes.isFailure) console.error('DEPOSIT 55 FAILED:', initDepRes.error);
    expect(initDepRes.getValue().transactionId).toBeDefined();

    // 2. Spawn 10 INDEPENDENT client connections to simulate distinct Microservices / Workers
    const independentClients = Array.from({ length: 10 }).map(() => {
      const client = createClient({ url: `file:${dbFileB}` });
      const clientDb = drizzle(client);
      const clientUowDb = {
        ...clientDb,
        transaction: async (cb: any) => {
          const t = await client.transaction('write');
          const proxyDb = drizzle(t) as any;
          proxyDb.rollback = () => { throw new Error('DRIZZLE_ROLLBACK'); };
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
      return { client, uow: new DrizzleUnitOfWork(clientUowDb) };
    });

    // 3. Fire 10 concurrent debit requests from 10 distinct client connections (30 units each)
    const concurrentMultiClientOps = independentClients.map(({ uow: clientUow }, idx) => async () => {
      try {
        const res = await clientUow.execute(async (factory) => {
          const repo = factory.getFinanceRepository();
          const userAccRes = await repo.getOrCreateUserAccount(55);
          const userAccountId = userAccRes.getValue().id;

          const entriesRaw = AccountingEntryPolicy.createWithdrawalEntries({
            treasuryAccountId,
            userAccountId,
            amount: Money256.fromString('30', assetId),
            description: `Multi-Client Debit #${idx + 1}`,
          });

          const ledgerEntries = entriesRaw.map(
            (r) => new LedgerEntry({ accountId: String(r.accountId), amount: r.amount as any, type: r.entryType, description: r.description })
          );

          const tx = new LedgerTransaction({
            idempotencyKey: `multi-client-debit-${idx + 1}`,
            description: `Multi-Client Debit #${idx + 1}`,
            entries: ledgerEntries,
            transactionType: 'withdrawal',
            userId: 55,
          });

          const orchestrator = new FinancialTransactionOrchestrator(repo);
          return Result.ok(await orchestrator.executePosting(tx));
        });

        if (res.isFailure) return { error: res.error };
        return res;
      } catch (err: any) {
        return { error: err.message || 'Multi-Client Debit failed' };
      }
    });

    const results = await Promise.all(concurrentMultiClientOps.map((fn) => fn()));
    const successful = results.filter((r: any) => r && r.isSuccess === true);

    // Close all independent clients
    independentClients.forEach(({ client }) => {
      try { client.close(); } catch (e) {}
    });

    // 4. Verify balance conservation: initial 200 - (successful * 30) === final balance
    const finalBalanceRes = await sqliteB.execute('SELECT available_base_units FROM account_balances WHERE account_id = (SELECT id FROM financial_accounts WHERE user_id = 55)');
    const finalBal = BigInt(finalBalanceRes.rows[0].available_base_units);

    expect(finalBal + BigInt(successful.length * 30)).toBe(200n);
    expect(finalBal >= 0n).toBe(true);

    try { sqliteB.close(); } catch (e) {}
    try { unlinkSync(dbFileB); } catch (e) {}
  }, 30000);
});
