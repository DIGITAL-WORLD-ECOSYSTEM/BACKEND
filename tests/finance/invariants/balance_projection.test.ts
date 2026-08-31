import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { readFileSync, unlinkSync } from 'fs';
import { eq, and, sql } from 'drizzle-orm';

import { DrizzleUnitOfWork } from '../../../src/infrastructure/repositories/DrizzleUnitOfWork';
import { DoubleEntryLedgerService } from '../../../src/domains/finance/services/DoubleEntryLedgerService';
import { LedgerTransaction, LedgerEntry } from '../../../src/domains/finance/entities/LedgerTransaction';
import { Money } from '../../../src/domains/finance/entities/Money';
import { accountBalances, financialLedgerEntries, financialAccounts } from '../../../src/db/finance/tables';

describe('Invariante DOD-04: Projeção de Saldo Materializado vs Soma Ponderada de Ledger', () => {
  let sqlite: any;
  let db: any;
  let uow: DrizzleUnitOfWork;
  let ledgerService: DoubleEntryLedgerService;
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

    const migrationFiles = [
      './migrations/0000_white_raider.sql',
      './migrations/0001_parallel_veda.sql',
      './migrations/0002_solid_barracuda.sql',
      './migrations/0004_preflight_audit.sql',
      './migrations/0005_data_remediation.sql',
      './migrations/0006_constraints.sql',
    ];

    for (const file of migrationFiles) {
      try {
        const sqlContent = readFileSync(file, 'utf8')
          .replace(/--> statement-breakpoint/g, ';');
        await sqlite.executeMultiple(sqlContent);
      } catch (err: any) {}
    }

    try { await sqlite.execute('ALTER TABLE outbox_events ADD COLUMN status TEXT DEFAULT "pending" NOT NULL;'); } catch (e) {}
    try { await sqlite.execute('ALTER TABLE outbox_events ADD COLUMN lease_owner TEXT;'); } catch (e) {}
    try { await sqlite.execute('ALTER TABLE outbox_events ADD COLUMN lease_generation INTEGER DEFAULT 0 NOT NULL;'); } catch (e) {}
    try { await sqlite.execute('ALTER TABLE outbox_events ADD COLUMN lease_expires_at INTEGER;'); } catch (e) {}
    try { await sqlite.execute('ALTER TABLE financial_accounts ADD COLUMN account_class TEXT DEFAULT "liability" NOT NULL;'); } catch (e) {}

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
    ledgerService = new DoubleEntryLedgerService();
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
        new LedgerEntry({ accountId: '1', amount: new Money(500n, '1'), type: 'debit' }),
        new LedgerEntry({ accountId: '2', amount: new Money(500n, '1'), type: 'credit' }),
      ],
    });

    const res1 = await uow.execute((f) => ledgerService.recordTransaction(tx1, f, 'hash1'));
    if (res1.isFailure) console.log('res1 error:', res1.error);
    expect(res1.isSuccess).toBe(true);

    // 2. Transferência 200 de User 1 (Conta 2) para User 2 (Conta 3)
    const tx2 = new LedgerTransaction({
      idempotencyKey: 'proj-tx-2',
      description: 'Transfer User 1 -> User 2',
      entries: [
        new LedgerEntry({ accountId: '2', amount: new Money(200n, '1'), type: 'debit' }),
        new LedgerEntry({ accountId: '3', amount: new Money(200n, '1'), type: 'credit' }),
      ],
    });

    const res2 = await uow.execute((f) => ledgerService.recordTransaction(tx2, f, 'hash2'));
    expect(res2.isSuccess).toBe(true);

    // 3. Taxa 10 cobrada de User 1 (Conta 2) enviada para Fees Revenue (Conta 4)
    const tx3 = new LedgerTransaction({
      idempotencyKey: 'proj-tx-3',
      description: 'Fee Charge User 1',
      entries: [
        new LedgerEntry({ accountId: '2', amount: new Money(10n, '1'), type: 'debit' }),
        new LedgerEntry({ accountId: '4', amount: new Money(10n, '1'), type: 'credit' }),
      ],
    });

    const res3 = await uow.execute((f) => ledgerService.recordTransaction(tx3, f, 'hash3'));
    if (res3.isFailure) console.log('res3 error:', res3.error);
    expect(res3.isSuccess).toBe(true);

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

      // Fórmula por accountClass (Seção 3 do Plano Diretor)
      // Base inicial das contas no setup (Operating iniciou com 1000000 de saldo inicial)
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
