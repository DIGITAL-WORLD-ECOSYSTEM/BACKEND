import { describe, it, expect, beforeAll } from 'vitest';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { FinanceBootstrapService } from '../../src/infrastructure/services/FinanceBootstrapService';
import { DrizzleFinanceRepository } from '../../src/infrastructure/repositories/DrizzleFinanceRepository';
import { unlinkSync, existsSync } from 'fs';

describe('FinanceBootstrapService - Bootstrapping de Tesouraria e Contas do Sistema', () => {
  const dbFile = 'test_bootstrap_service.db';
  let sqlite: any;
  let db: any;

  beforeAll(async () => {
    if (existsSync(dbFile)) {
      try { unlinkSync(dbFile); } catch (e) {}
    }
    sqlite = createClient({ url: `file:${dbFile}` });
    db = drizzle(sqlite);

    // DDL de teste
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
        account_type TEXT NOT NULL CHECK(account_type IN ('user_available', 'treasury', 'operating', 'reserve', 'fees', 'escrow', 'reward_expense', 'yield_expense', 'clearing', 'opening_balance_equity', 'payment_revenue', 'refund_expense')),
        account_class TEXT NOT NULL CHECK(account_class IN ('asset', 'liability', 'equity', 'revenue', 'expense')),
        status TEXT NOT NULL CHECK(status IN ('active', 'inactive', 'suspended')),
        name TEXT NOT NULL,
        version INTEGER DEFAULT 1 NOT NULL,
        created_at INTEGER,
        updated_at INTEGER
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

    // Inserir usuário inicial
    await sqlite.execute(`INSERT INTO users (id, name) VALUES (1, 'Admin');`);
  }, 30000);

  it('deve inicializar com sucesso o banco e provisionar contas de Tesouraria, Operacional e Fee', async () => {
    const repo = new DrizzleFinanceRepository(db);

    // 1. Antes do bootstrap, getTreasuryAccount deve falhar
    const initialGet = await repo.getTreasuryAccount();
    expect(initialGet.isFailure).toBe(true);
    expect(initialGet.error).toContain('Treasury account not found');

    // 2. Executar bootstrap
    const seedRes = await FinanceBootstrapService.seedSystemAccounts(db, {
      currencyCode: 'BRL',
      initialBalanceBaseUnits: 1000000n,
    });

    if (seedRes.isFailure) console.log('SEED ERROR:', seedRes.error);
    expect(seedRes.isSuccess).toBe(true);
    const data = seedRes.getValue();
    expect(data.treasuryAccountId).toBeGreaterThan(0);

    // 3. Após bootstrap, getTreasuryAccount deve ter sucesso
    const treasuryGet = await repo.getTreasuryAccount();
    expect(treasuryGet.isSuccess).toBe(true);
    expect(treasuryGet.getValue().accountType).toBe('treasury');
  }, 30000);
});
