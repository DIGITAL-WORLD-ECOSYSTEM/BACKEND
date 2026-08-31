import { describe, it, expect, beforeAll } from 'vitest';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { eq } from 'drizzle-orm';
import { DrizzleFinanceRepository } from '../../src/infrastructure/repositories/DrizzleFinanceRepository';
import { LedgerEntry } from '../../src/domains/finance/entities/LedgerTransaction';
import { Money256 } from '../../src/domains/finance/value-objects/Money256';
import { accountBalances } from '../../src/db/finance/tables';
import { unlinkSync, existsSync } from 'fs';
import { runAllMigrationsLibSql } from '../test_helpers/runMigrations';

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

    await runAllMigrationsLibSql(sqlite);

    // Inserir registros iniciais
    await sqlite.execute(`INSERT INTO users (id, email, email_normalized, status, created_at, updated_at) VALUES (1, 'evm@test.com', 'evm@test.com', 'active', 1000, 1000);`);
    await sqlite.execute(`INSERT INTO financial_assets (id, code, symbol, name, decimals, type, status, created_at, updated_at) VALUES (1, 'USDT', 'USDT', 'Tether EVM 18 decimals', 18, 'crypto', 'active', 1000, 1000);`);
    await sqlite.execute(`INSERT INTO financial_accounts (id, user_id, account_type, account_class, status, name, version, created_at, updated_at) VALUES (1, 1, 'user_available', 'liability', 'active', 'User Account', 1, 1000, 1000);`);
    await sqlite.execute(`INSERT INTO financial_accounts (id, user_id, account_type, account_class, status, name, version, created_at, updated_at) VALUES (2, NULL, 'treasury', 'asset', 'active', 'Treasury Vault', 1, 1000, 1000);`);
  }, 30000);

  it('deve processar lançamentos contábeis com valores EVM de 18 decimais (ex: 10^24 base units, excedendo 53-bits) sem estouro ou perda de precisão', async () => {
    const repo = new DrizzleFinanceRepository(db);

    // 100,000,000 USDT com 18 decimais = 100,000,000 * 10^18 = 10^26 base units
    const hugeEvmAmount = 100000000000000000000000000n; // > Number.MAX_SAFE_INTEGER (9007199254740991)
    const money = Money256.fromBigInt(hugeEvmAmount, 1);

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
