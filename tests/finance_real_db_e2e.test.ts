import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { unlinkSync } from 'fs';
import { eq } from 'drizzle-orm';

import { DrizzleUnitOfWork } from '../src/infrastructure/repositories/DrizzleUnitOfWork';
import { LedgerTransaction, LedgerEntry } from '../src/domains/finance/entities/LedgerTransaction';
import { Money256 } from '../src/domains/finance/value-objects/Money256';
import { FinancialTransactionOrchestrator } from '../src/application/finance/services/FinancialTransactionOrchestrator';
import { idempotencyKeys, outboxEvents } from '../src/db/infrastructure/tables';
import { financialTransactions, financialLedgerEntries, accountBalances } from '../src/db/finance/tables';
import { Result } from '../src/shared/kernel/Result';
import { runAllMigrationsLibSql } from './test_helpers/runMigrations';

describe('Finance Core E2E Certification (Real DB)', () => {
  let sqlite: any;
  let db: any;
  let uow: DrizzleUnitOfWork;

  beforeAll(async () => {
    sqlite = createClient({ url: 'file:test_e2e_real.db' });
    db = drizzle(sqlite);
    
    const uowDb = {
      ...db,
      transaction: async (cb: any) => {
        const t = await sqlite.transaction('write');
        const proxyDb = drizzle(t) as any;
        proxyDb.rollback = () => { 
           throw new Error('drizzle-rollback'); 
        };
        try {
           const res = await cb(proxyDb);
           await t.commit();
           return res;
        } catch (err: any) {
           try { await t.rollback(); } catch (e) {}
           if (err.message === 'drizzle-rollback') return;
           throw err;
        }
      }
    };

    await runAllMigrationsLibSql(sqlite);

    await sqlite.executeMultiple(`
      INSERT INTO users (id, email, email_normalized, status, created_at, updated_at) VALUES (1, 'user1@test.com', 'user1@test.com', 'active', 1000, 1000);
      INSERT INTO users (id, email, email_normalized, status, created_at, updated_at) VALUES (2, 'user2@test.com', 'user2@test.com', 'active', 1000, 1000);
      INSERT INTO financial_assets (id, symbol, code, name, type, decimals, status, created_at, updated_at) VALUES (1, 'BRL', 'BRL', 'Brazilian Real', 'fiat', 2, 'active', 1000, 1000);
    `);

    uow = new DrizzleUnitOfWork(uowDb);
  }, 30000);

  afterAll(() => {
    sqlite.close();
    try { unlinkSync('test_e2e_real.db'); } catch (e) {}
  });

  const getFullState = async () => {
    return {
      idem: await db.select().from(idempotencyKeys),
      txs: await db.select().from(financialTransactions),
      entries: await db.select().from(financialLedgerEntries),
      balances: await db.select().from(accountBalances),
      outbox: await db.select().from(outboxEvents),
    };
  };

  it('Happy path: 1 tx + 2 ledger entries + balances corretos + outbox + idempotency completed', async () => {
    await uow.execute(async (f) => {
      await f.getFinanceRepository().getOrCreateOperatingAccount();
      await f.getFinanceRepository().getOrCreateUserAccount(1);
      return Result.ok(true);
    });

    const idemKey = 'happy-path-key';
    const reqHash = 'hash123';
    const amount = Money256.fromString('5000', 1);

    const tx = new LedgerTransaction({
      idempotencyKey: idemKey,
      userId: 1,
      description: 'Test Deposit',
      entries: [
        new LedgerEntry({ accountId: '1', amount: amount as any, type: 'debit' }),
        new LedgerEntry({ accountId: '2', amount: amount as any, type: 'credit' })
      ]
    });

    const resultRes = await uow.execute(async (factory) => {
      const repo = factory.getFinanceRepository();
      const orchestrator = new FinancialTransactionOrchestrator(repo);
      const postResult = await orchestrator.executePosting(tx, reqHash);
      return Result.ok(postResult);
    });

    expect(resultRes.isSuccess).toBe(true);
    const result = resultRes.getValue();
    expect(result.transactionId).toBeDefined();

    const state = await getFullState();
    expect(state.txs.length).toBe(1);
    expect(state.txs[0].status).toBe('completed');
    expect(state.entries.length).toBe(2);
    expect(state.balances.length).toBe(2);
    
    expect(state.outbox.length).toBe(1);
    
    const idem = state.idem.find((i: any) => i.key === idemKey);
    expect(idem).toBeDefined();
    expect(idem.status).toBe('completed');
    expect(idem.financialTransactionId).toBe(state.txs[0].id);
  });

  it('Rollback: falha forçada resulta em banco intocado (0 registros persistidos vazados)', async () => {
    const initialState = await getFullState();
    const amount = Money256.fromString('99999', 1);

    const tx = new LedgerTransaction({
      idempotencyKey: 'rollback-key',
      userId: 1,
      description: 'Will fail due to insufficient funds / bad logic',
      entries: [
        new LedgerEntry({ accountId: '1', amount: amount as any, type: 'credit' }), 
        new LedgerEntry({ accountId: '2', amount: amount as any, type: 'debit' })   
      ]
    });

    const result = await uow.execute(async (factory) => {
      const repo = factory.getFinanceRepository();
      const orchestrator = new FinancialTransactionOrchestrator(repo);
      const postResult = await orchestrator.executePosting(tx, 'hash-fail');
      return Result.ok(postResult);
    });

    expect(result.isFailure).toBe(true);

    const finalState = await getFullState();
    expect(finalState.txs.length).toBe(initialState.txs.length);
    expect(finalState.entries.length).toBe(initialState.entries.length);
    expect(finalState.idem.length).toBe(initialState.idem.length);
    expect(finalState.outbox.length).toBe(initialState.outbox.length);
  });

  it('Same key + same hash: replay da mesma tx (Idempotente)', async () => {
    const idemKey = 'happy-path-key';
    const amount = Money256.fromString('5000', 1);
    
    const tx = new LedgerTransaction({
      idempotencyKey: idemKey,
      userId: 1,
      description: 'Test Deposit',
      entries: [
        new LedgerEntry({ accountId: '1', amount: amount as any, type: 'debit' }),
        new LedgerEntry({ accountId: '2', amount: amount as any, type: 'credit' })
      ]
    });

    const resultRes = await uow.execute(async (factory) => {
      const repo = factory.getFinanceRepository();
      const orchestrator = new FinancialTransactionOrchestrator(repo);
      const postResult = await orchestrator.executePosting(tx, 'hash123');
      return Result.ok(postResult);
    });

    expect(resultRes.isSuccess).toBe(true);
    expect(resultRes.getValue().isReplayed).toBe(true);
  });

  it('Same key + different hash: 409 Conflict', async () => {
    const idemKey = 'happy-path-key';
    const amount = Money256.fromString('100', 1);
    
    const tx = new LedgerTransaction({
      idempotencyKey: idemKey,
      userId: 1,
      description: 'Modified Deposit',
      entries: [
        new LedgerEntry({ accountId: '1', amount: amount as any, type: 'debit' }),
        new LedgerEntry({ accountId: '2', amount: amount as any, type: 'credit' })
      ]
    });

    const result = await uow.execute(async (factory) => {
      const repo = factory.getFinanceRepository();
      const orchestrator = new FinancialTransactionOrchestrator(repo);
      const postResult = await orchestrator.executePosting(tx, 'hash-diferente');
      return Result.ok(postResult);
    });

    expect(result.isFailure).toBe(true);
    expect(result.error).toContain('Conflito de idempotência');
  });

  it('Concorrência: exatamente 1 tx processada em Race Condition (barrier simulada)', async () => {
    const idemKey = 'race-condition-key';
    const reqHash = 'race-hash';

    const claimRes = await uow.execute(async (factory) => {
       const repo = factory.getFinanceRepository();
       await repo.claimIdempotency(idemKey, 2, 'finance', reqHash);
       return Result.ok(true);
    });

    expect(claimRes.isSuccess).toBe(true);

    const result = await uow.execute(async (factory) => {
       const claimed = await factory.getFinanceRepository().claimIdempotency(idemKey, 2, 'finance', reqHash);
       if (!claimed) {
          return Result.fail('Transação em andamento (Idempotency Key Processing).');
       }
       return Result.ok(true);
    });

    expect(result.isFailure).toBe(true);
    expect(result.error).toContain('Transação em andamento (Idempotency Key Processing).');

    const idemRows = await db.select().from(idempotencyKeys).where(eq(idempotencyKeys.key, idemKey));
    expect(idemRows.length).toBe(1);
    expect(idemRows[0].status).toBe('processing');
  });
});
