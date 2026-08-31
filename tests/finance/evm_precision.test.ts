import { describe, it, expect, beforeAll } from 'vitest';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { eq } from 'drizzle-orm';
import { DrizzleFinanceRepository } from '../../src/infrastructure/repositories/DrizzleFinanceRepository';
import { LedgerEntry } from '../../src/domains/finance/entities/LedgerTransaction';
import { Money } from '../../src/domains/finance/entities/Money';
import { accountBalances } from '../../src/db/finance/tables';
import { unlinkSync, existsSync } from 'fs';

describe('Precisão Monetária EVM 256-bit - Transações com > 53-bits', () => {
  const dbFile = 'test_evm_precision.db';
  let sqlite: any;
  let db: any;

  beforeAll(async () => {
    if (existsSync(dbFile)) {
      try { unlinkSync(dbFile); } catch (e) {}
    }
    sqlite = createClient({ url: `file:${dbFile}` });
    db = drizzle(sqlite);

    await sqlite.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL
      );
    `);
    await sqlite.execute(`
      CREATE TABLE IF NOT EXISTS financial_assets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL,
        symbol TEXT NOT NULL,
        name TEXT NOT NULL,
        decimals INTEGER NOT NULL,
        type TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER,
        updated_at INTEGER
      );
    `);
    await sqlite.execute(`
      CREATE TABLE IF NOT EXISTS financial_accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        account_type TEXT NOT NULL,
        account_class TEXT NOT NULL,
        status TEXT NOT NULL,
        name TEXT NOT NULL,
        version INTEGER DEFAULT 1 NOT NULL,
        created_at INTEGER,
        updated_at INTEGER
      );
    `);
    await sqlite.execute(`
      CREATE TABLE IF NOT EXISTS financial_transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        type TEXT NOT NULL,
        category TEXT DEFAULT 'other' NOT NULL,
        status TEXT DEFAULT 'pending' NOT NULL,
        source_type TEXT,
        source_id TEXT,
        correlation_id TEXT,
        description TEXT NOT NULL,
        version INTEGER DEFAULT 1 NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        completed_at INTEGER
      );
    `);
    await sqlite.execute(`
      CREATE TABLE IF NOT EXISTS financial_ledger_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        transaction_id INTEGER NOT NULL,
        account_id INTEGER NOT NULL,
        asset_id INTEGER NOT NULL,
        direction TEXT NOT NULL,
        amount_base_units TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
    await sqlite.execute(`
      CREATE TABLE IF NOT EXISTS account_balances (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id INTEGER NOT NULL,
        asset_id INTEGER NOT NULL,
        available_base_units TEXT DEFAULT '0' NOT NULL,
        locked_base_units TEXT DEFAULT '0' NOT NULL,
        version INTEGER DEFAULT 1 NOT NULL,
        updated_at INTEGER
      );
    `);

    // Inserir registros iniciais
    await sqlite.execute(`INSERT INTO users (id, name) VALUES (1, 'User 1');`);
    await sqlite.execute(`INSERT INTO financial_assets (id, code, symbol, name, decimals, type, status) VALUES (1, 'USDT', 'USDT', 'Tether EVM 18 decimals', 18, 'crypto', 'active');`);
    await sqlite.execute(`INSERT INTO financial_accounts (id, user_id, account_type, account_class, status, name) VALUES (1, 1, 'user', 'liability', 'active', 'User Account');`);
    await sqlite.execute(`INSERT INTO financial_accounts (id, user_id, account_type, account_class, status, name) VALUES (2, 1, 'treasury', 'asset', 'active', 'Treasury Vault');`);
  }, 30000);

  it('deve processar lançamentos contábeis com valores EVM de 18 decimais (ex: 10^24 base units, excedendo 53-bits) sem estouro ou perda de precisão', async () => {
    const repo = new DrizzleFinanceRepository(db);

    // 100,000,000 USDT com 18 decimais = 100,000,000 * 10^18 = 10^26 base units
    const hugeEvmAmount = 100000000000000000000000000n; // > Number.MAX_SAFE_INTEGER (9007199254740991)
    const money = new Money(hugeEvmAmount, '1');

    const entry1 = new LedgerEntry({
      accountId: '1',
      amount: money,
      type: 'credit',
      description: 'EVM Deposit'
    });

    const entry2 = new LedgerEntry({
      accountId: '2',
      amount: money,
      type: 'debit',
      description: 'EVM Deposit Treasury'
    });

    // 1. Inserir Transação
    const txId = await repo.insertTransaction({
      userId: 1,
      type: 'deposit',
      category: 'trading',
      status: 'completed',
      description: 'Deposit Huge EVM Token',
    });

    // 2. Inserir Entradas no Ledger (deve gravar TEXT com a string exata do BigInt)
    await repo.insertLedgerEntries([entry1, entry2], txId);

    // 3. Atualizar saldos com OCC usando BigInt puro
    const successUser = await repo.updateBalanceWithOCC('1', '1', hugeEvmAmount, 'credit');
    expect(successUser).toBe(true);

    const successTreasury = await repo.updateBalanceWithOCC('2', '1', hugeEvmAmount, 'debit');
    expect(successTreasury).toBe(true);

    // 4. Consultar saldo no banco de dados e verificar a exatidão do BigInt (TEXT -> BigInt)
    const [userBalRow] = await db
      .select()
      .from(accountBalances)
      .where(eq(accountBalances.accountId, 1))
      .limit(1);

    expect(BigInt(userBalRow.availableBaseUnits)).toBe(hugeEvmAmount);
    expect(userBalRow.availableBaseUnits).toBe(hugeEvmAmount.toString());
  });
});
