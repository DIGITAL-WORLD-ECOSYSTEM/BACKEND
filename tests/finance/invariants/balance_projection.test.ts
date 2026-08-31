import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { unlinkSync } from 'fs';
import { eq, and } from 'drizzle-orm';

import { DrizzleUnitOfWork } from '../../../src/infrastructure/repositories/DrizzleUnitOfWork';
import { LedgerTransaction, LedgerEntry } from '../../../src/domains/finance/entities/LedgerTransaction';
import { Money256 } from '../../../src/domains/finance/value-objects/Money256';
import { FinancialTransactionOrchestrator } from '../../../src/application/finance/services/FinancialTransactionOrchestrator';
import { accountBalances, financialLedgerEntries, financialAccounts } from '../../../src/db/finance/tables';
import { runAllMigrationsLibSql } from '../../test_helpers/runMigrations';

describe('Invariante DOD-04: Projeção de Saldo Materializado vs Soma Ponderada de Ledger', () => {
  let sqlite: any;
  let db: any;
  let uow: DrizzleUnitOfWork;
  const dbFile = 'test_balance_projection.db';

  beforeAll(async () => {
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
          await cb(proxyDb);
          await t.commit();
        } catch (err: any) {
          try { await t.rollback(); } catch (e) {}
          if (err.message === 'DRIZZLE_ROLLBACK') return;
          throw err;
        }
      }
    };

    await runAllMigrationsLibSql(sqlite);

    await sqlite.executeMultiple(`
      INSERT INTO users (id, email, email_normalized, status, created_at, updated_at) VALUES (1, 'user1@test.com', 'user1@test.com', 'active', 1000, 1000);
      INSERT INTO users (id, email, email_normalized, status, created_at, updated_at) VALUES (2, 'user2@test.com', 'user2@test.com', 'active', 1000, 1000);
      INSERT INTO financial_assets (id, symbol, code, name, type, decimals, status, created_at, updated_at) VALUES (1, 'BRL', 'BRL', 'Brazilian Real', 'fiat', 2, 'active', 1000, 1000);
      
      INSERT INTO financial_accounts (id, user_id, account_type, account_class, status, name, version, created_at, updated_at) VALUES (1, NULL, 'operating', 'asset', 'active', 'Operating Account', 1, 1000, 1000);
      INSERT INTO financial_accounts (id, user_id, account_type, account_class, status, name, version, created_at, updated_at) VALUES (2, 1, 'user_available', 'liability', 'active', 'User 1 Account', 1, 1000, 1000);
      INSERT INTO financial_accounts (id, user_id, account_type, account_class, status, name, version, created_at, updated_at) VALUES (3, 2, 'user_available', 'liability', 'active', 'User 2 Account', 1, 1000, 1000);
      INSERT INTO financial_accounts (id, user_id, account_type, account_class, status, name, version, created_at, updated_at) VALUES (4, NULL, 'fees', 'revenue', 'active', 'Fee Revenue Account', 1, 1000, 1000);

      INSERT INTO account_balances (account_id, asset_id, available_base_units, locked_base_units, version, updated_at) VALUES (1, 1, '1000000', '0', 1, 1000);
      INSERT INTO account_balances (account_id, asset_id, available_base_units, locked_base_units, version, updated_at) VALUES (2, 1, '0', '0', 1, 1000);
      INSERT INTO account_balances (account_id, asset_id, available_base_units, locked_base_units, version, updated_at) VALUES (3, 1, '0', '0', 1, 1000);
      INSERT INTO account_balances (account_id, asset_id, available_base_units, locked_base_units, version, updated_at) VALUES (4, 1, '0', '0', 1, 1000);
    `);

    uow = new DrizzleUnitOfWork(uowDb);
  });

  afterAll(() => {
    try { unlinkSync(dbFile); } catch (e) {}
  });

  it('DOD-04: Saldo materializado em account_balances deve coincidir 100% com a soma projetada do ledger por accountClass', async () => {
    // 1. Depósito 500 para User 1 (Conta 2) vindo da Operating (Conta 1)
    const tx1 = new LedgerTransaction({
      idempotencyKey: 'proj-tx-1',
      description: 'Deposit User 1',
      entries: [
        new LedgerEntry({ accountId: '1', amount: Money256.fromString('500', 1) as any, type: 'debit' }),
        new LedgerEntry({ accountId: '2', amount: Money256.fromString('500', 1) as any, type: 'credit' }),
      ],
    });

    const res1 = await uow.execute(async (f) => {
      const repo = f.getFinanceRepository();
      const orchestrator = new FinancialTransactionOrchestrator(repo);
      return await orchestrator.executePosting(tx1, 'hash1');
    });
    expect(res1.transactionId).toBeDefined();

    // 2. Transferência 200 de User 1 (Conta 2) para User 2 (Conta 3)
    const tx2 = new LedgerTransaction({
      idempotencyKey: 'proj-tx-2',
      description: 'Transfer User 1 -> User 2',
      entries: [
        new LedgerEntry({ accountId: '2', amount: Money256.fromString('200', 1) as any, type: 'debit' }),
        new LedgerEntry({ accountId: '3', amount: Money256.fromString('200', 1) as any, type: 'credit' }),
      ],
    });

    const res2 = await uow.execute(async (f) => {
      const repo = f.getFinanceRepository();
      const orchestrator = new FinancialTransactionOrchestrator(repo);
      return await orchestrator.executePosting(tx2, 'hash2');
    });
    expect(res2.transactionId).toBeDefined();

    // 3. Taxa 10 cobrada de User 1 (Conta 2) enviada para Fees Revenue (Conta 4)
    const tx3 = new LedgerTransaction({
      idempotencyKey: 'proj-tx-3',
      description: 'Fee Charge User 1',
      entries: [
        new LedgerEntry({ accountId: '2', amount: Money256.fromString('10', 1) as any, type: 'debit' }),
        new LedgerEntry({ accountId: '4', amount: Money256.fromString('10', 1) as any, type: 'credit' }),
      ],
    });

    const res3 = await uow.execute(async (f) => {
      const repo = f.getFinanceRepository();
      const orchestrator = new FinancialTransactionOrchestrator(repo);
      return await orchestrator.executePosting(tx3, 'hash3');
    });
    expect(res3.transactionId).toBeDefined();

    // 4. Verificação Invariante DOD-04 para todas as contas
    const accounts = await db.select().from(financialAccounts);

    for (const acc of accounts) {
      const balances = await db
        .select()
        .from(accountBalances)
        .where(and(eq(accountBalances.accountId, acc.id), eq(accountBalances.assetId, 1)));

      const materializedStr = balances[0]?.availableBaseUnits || '0';
      const materializedBigInt = BigInt(materializedStr);

      const entries = await db
        .select()
        .from(financialLedgerEntries)
        .where(and(eq(financialLedgerEntries.accountId, acc.id), eq(financialLedgerEntries.assetId, 1)));

      let debitSum = 0n;
      let creditSum = 0n;
      for (const entry of entries) {
        const val = BigInt(entry.amountBaseUnits);
        if (entry.direction === 'debit') debitSum += val;
        else if (entry.direction === 'credit') creditSum += val;
      }

      let initialBalance = acc.id === 1 ? 1000000n : 0n;
      let projectedBigInt = initialBalance;

      if (acc.accountClass === 'asset' || acc.accountClass === 'expense') {
        projectedBigInt += (debitSum - creditSum);
      } else if (acc.accountClass === 'liability' || acc.accountClass === 'revenue' || acc.accountClass === 'equity') {
        projectedBigInt += (creditSum - debitSum);
      }

      expect(materializedBigInt).toBe(projectedBigInt);
    }
  });
});
