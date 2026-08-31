import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { readFileSync, unlinkSync } from 'fs';
import { eq, and } from 'drizzle-orm';

import { DrizzleUnitOfWork } from '../../src/infrastructure/repositories/DrizzleUnitOfWork';
import { DoubleEntryLedgerService } from '../../src/domains/finance/services/DoubleEntryLedgerService';
import { ReverseTransactionUseCase } from '../../src/domains/finance/use-cases/ReverseTransactionUseCase';
import { LedgerTransaction, LedgerEntry } from '../../src/domains/finance/entities/LedgerTransaction';
import { Money } from '../../src/domains/finance/entities/Money';
import { accountBalances, financialAccounts } from '../../src/db/finance/tables';

describe('Invariante DOD-17: Transações de Estorno (ReverseTransactionUseCase)', () => {
  let sqlite: any;
  let db: any;
  let uow: DrizzleUnitOfWork;
  let ledgerService: DoubleEntryLedgerService;
  let reverseUseCase: ReverseTransactionUseCase;
  const dbFile = 'test_reversal.db';

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
      INSERT INTO financial_assets (id, symbol, code, name, type, decimals, status, created_at, updated_at) VALUES (1, 'BRL', 'BRL', 'Brazilian Real', 'fiat', 2, 'active', 1000, 1000);
      
      INSERT INTO financial_accounts (id, user_id, account_type, account_class, status, name, version, created_at, updated_at) VALUES (1, NULL, 'operating', 'asset', 'active', 'Operating Account', 1, 1000, 1000);
      INSERT INTO financial_accounts (id, user_id, account_type, account_class, status, name, version, created_at, updated_at) VALUES (2, 1, 'user_available', 'liability', 'active', 'User 1 Account', 1, 1000, 1000);

      INSERT INTO account_balances (account_id, asset_id, available_base_units, locked_base_units, version, updated_at) VALUES (1, 1, '100000', '0', 1, 1000);
      INSERT INTO account_balances (account_id, asset_id, available_base_units, locked_base_units, version, updated_at) VALUES (2, 1, '0', '0', 1, 1000);
    `);

    uow = new DrizzleUnitOfWork(uowDb);
    ledgerService = new DoubleEntryLedgerService();
    reverseUseCase = new ReverseTransactionUseCase(uow, ledgerService);
  }, 30000);

  afterAll(() => {
    try { unlinkSync(dbFile); } catch (e) {}
  });

  it('DOD-17: Executar estorno deve gerar lançamentos espelho invertidos e restaurar o saldo ao valor original', async () => {
    // 1. Executa transação original de depósito (100 base units de Operating para User 1)
    const originalTx = new LedgerTransaction({
      idempotencyKey: 'orig-dep-100',
      description: 'Original Deposit 100',
      entries: [
        new LedgerEntry({ accountId: '1', amount: new Money(100n, '1'), type: 'debit' }),
        new LedgerEntry({ accountId: '2', amount: new Money(100n, '1'), type: 'credit' }),
      ],
    });

    const origRes = await uow.execute((f) => ledgerService.recordTransaction(originalTx, f, 'orig-hash'));
    expect(origRes.isSuccess).toBe(true);
    const originalTxId = origRes.getValue().transactionId!;

    // Verifica saldos pós-depósito
    const b1AfterDep = await db.select().from(accountBalances).where(and(eq(accountBalances.accountId, 1), eq(accountBalances.assetId, 1)));
    const b2AfterDep = await db.select().from(accountBalances).where(and(eq(accountBalances.accountId, 2), eq(accountBalances.assetId, 1)));
    expect(b1AfterDep[0].availableBaseUnits).toBe('100100'); // Asset aumenta com Débito (100000 + 100)
    expect(b2AfterDep[0].availableBaseUnits).toBe('100');    // Liability aumenta com Crédito (0 + 100)

    // 2. Executa estorno (ReverseTransactionUseCase)
    const revRes = await reverseUseCase.execute({
      originalTransactionId: originalTxId,
      idempotencyKey: 'rev-dep-100',
      reason: 'Solicitação do cliente / Erro operacional',
      requestHash: 'rev-hash',
    });

    if (revRes.isFailure) console.log('revRes error:', revRes.error);
    expect(revRes.isSuccess).toBe(true);

    // 3. Valida que os saldos das contas foram 100% restaurados aos valores originais (Original + Estorno == 0)
    const b1Final = await db.select().from(accountBalances).where(and(eq(accountBalances.accountId, 1), eq(accountBalances.assetId, 1)));
    const b2Final = await db.select().from(accountBalances).where(and(eq(accountBalances.accountId, 2), eq(accountBalances.assetId, 1)));

    expect(b1Final[0].availableBaseUnits).toBe('100000');
    expect(b2Final[0].availableBaseUnits).toBe('0');
  });
});
