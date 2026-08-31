import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { unlinkSync } from 'fs';

import { DrizzleUnitOfWork } from '../../../src/infrastructure/repositories/DrizzleUnitOfWork';
import { LedgerTransaction, LedgerEntry } from '../../../src/domains/finance/entities/LedgerTransaction';
import { Money256 } from '../../../src/domains/finance/value-objects/Money256';
import { FinancialTransactionOrchestrator } from '../../../src/application/finance/services/FinancialTransactionOrchestrator';
import { idempotencyKeys, outboxEvents } from '../../../src/db/infrastructure/tables';
import { financialTransactions, financialLedgerEntries, accountBalances } from '../../../src/db/finance/tables';
import { Result } from '../../../src/shared/kernel/Result';
import { runAllMigrationsLibSql } from '../../test_helpers/runMigrations';

describe('Invariante DOD-06: Matriz de Falhas e Rollback Integral nos Passos Transacionais', () => {
  let sqlite: any;
  let db: any;
  let uow: DrizzleUnitOfWork;

  beforeAll(async () => {
    sqlite = createClient({ url: 'file:test_failure_matrix.db' });
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
           await cb(proxyDb);
           await t.commit();
        } catch (err: any) {
           try { await t.rollback(); } catch (e) {}
           if (err.message === 'drizzle-rollback') return;
           throw err;
        }
      }
    };

    await runAllMigrationsLibSql(sqlite);

    await sqlite.executeMultiple(`
      INSERT INTO users (id, email, email_normalized, status, created_at, updated_at) VALUES (10, 'matrix@test.com', 'matrix@test.com', 'active', 1000, 1000);
      INSERT INTO financial_assets (id, symbol, code, name, type, decimals, status, created_at, updated_at) VALUES (1, 'BRL', 'BRL', 'Brazilian Real', 'fiat', 2, 'active', 1000, 1000);
      INSERT INTO financial_accounts (id, user_id, account_type, account_class, status, name, version, created_at, updated_at) VALUES (1, 10, 'user_available', 'liability', 'active', 'User 10 Main Account', 1, 1000, 1000);
      INSERT INTO financial_accounts (id, user_id, account_type, account_class, status, name, version, created_at, updated_at) VALUES (2, NULL, 'treasury', 'asset', 'active', 'Treasury Vault', 1, 1000, 1000);
      INSERT INTO account_balances (id, account_id, asset_id, available_base_units, locked_base_units, version, updated_at) VALUES (1, 1, 1, '500', '0', 1, 1000);
      INSERT INTO account_balances (id, account_id, asset_id, available_base_units, locked_base_units, version, updated_at) VALUES (2, 2, 1, '10000', '0', 1, 1000);
    `);

    uow = new DrizzleUnitOfWork(uowDb);
  }, 30000);

  afterAll(() => {
    sqlite.close();
    try { unlinkSync('test_failure_matrix.db'); } catch (e) {}
  });

  const getDBCounts = async () => {
    const txs = (await db.select().from(financialTransactions)).length;
    const entries = (await db.select().from(financialLedgerEntries)).length;
    const idem = (await db.select().from(idempotencyKeys)).length;
    const outbox = (await db.select().from(outboxEvents)).length;
    return { txs, entries, idem, outbox };
  };

  it('Falha no Passo 4 (OCC / Balance Check) resulta em Rollback Integral (0 registros vazados)', async () => {
    const initialState = await getDBCounts();
    const excessiveAmount = Money256.fromString('50000', 1);

    const invalidTx = new LedgerTransaction({
      idempotencyKey: 'fail-step4-key',
      userId: 10,
      description: 'Test Step 4 Overdraft Fail',
      entries: [
        new LedgerEntry({ accountId: '1', amount: excessiveAmount as any, type: 'debit' }),
        new LedgerEntry({ accountId: '2', amount: excessiveAmount as any, type: 'credit' })
      ]
    });

    const result = await uow.execute(async (factory) => {
      const repo = factory.getFinanceRepository();
      const orchestrator = new FinancialTransactionOrchestrator(repo);
      return await orchestrator.executePosting(invalidTx, 'hash-fail-4');
    });

    expect(result.isFailure).toBe(true);
    expect(result.error).toContain('saldo insuficiente');

    // Asserção DOD-06: O banco de dados precisa estar no exato mesmo estado inicial
    const finalState = await getDBCounts();
    expect(finalState.txs).toBe(initialState.txs);
    expect(finalState.entries).toBe(initialState.entries);
    expect(finalState.idem).toBe(initialState.idem);
    expect(finalState.outbox).toBe(initialState.outbox);
  });

  it('Falha no Passo 6 (completeIdempotency com chave inexistente) resulta em Rollback Integral', async () => {
    const initialState = await getDBCounts();
    const amount = Money256.fromString('100', 1);

    const tx = new LedgerTransaction({
      idempotencyKey: 'fail-step6-key',
      userId: 10,
      description: 'Test Step 6 Fail',
      entries: [
        new LedgerEntry({ accountId: '1', amount: amount as any, type: 'debit' }),
        new LedgerEntry({ accountId: '2', amount: amount as any, type: 'credit' })
      ]
    });

    const result = await uow.execute(async (factory) => {
      const repo = factory.getFinanceRepository();
      // Executa os passos normais manualmente para simular falha no completeIdempotency
      await repo.claimIdempotency(tx.idempotencyKey, 10, 'finance', 'hash-6');
      const dbTxId = await repo.insertTransaction({
        userId: tx.userId,
        type: tx.transactionType || 'deposit',
        category: 'operational',
        description: tx.description,
        status: 'processing'
      });
      await repo.insertLedgerEntries(tx.entries, dbTxId);
      await repo.updateBalanceWithOCC('1', '1', 100n, 'debit');
      await repo.updateBalanceWithOCC('2', '1', 100n, 'credit');
      await repo.updateTransactionStatus(dbTxId, 'completed');
      
      // Força completeIdempotency com chave ERRADA que afetará 0 linhas
      await repo.completeIdempotency('NON_EXISTENT_KEY', 'finance', dbTxId);
      return Result.ok(true);
    });

    expect(result.isFailure).toBe(true);
    expect(result.error).toContain('Falha ao concluir Idempotency Key');

    // Asserção DOD-06: Rollback integral
    const finalState = await getDBCounts();
    expect(finalState.txs).toBe(initialState.txs);
    expect(finalState.entries).toBe(initialState.entries);
    expect(finalState.idem).toBe(initialState.idem);
  });
});
