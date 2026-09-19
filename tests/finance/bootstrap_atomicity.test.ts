import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { runAllMigrationsLibSql } from '../test_helpers/runMigrations';
import { FinanceBootstrapService } from '../../src/infrastructure/services/FinanceBootstrapService';
import { DrizzleUnitOfWork } from '../../src/infrastructure/repositories/DrizzleUnitOfWork';
import { DrizzleFinanceRepository } from '../../src/infrastructure/repositories/DrizzleFinanceRepository';
import { unlinkSync, existsSync } from 'fs';

describe('GATE 1 & 2: FinanceBootstrapService — Atomicidade e Executor Typing', () => {
  const dbFile = 'test_bootstrap_atomicity.db';
  let sqlite: any;
  let db: any;

  beforeEach(async () => {
    if (existsSync(dbFile)) {
      try { unlinkSync(dbFile); } catch (e) {}
    }
    sqlite = createClient({ url: `file:${dbFile}` });
    db = drizzle(sqlite);

    await runAllMigrationsLibSql(sqlite);
  }, 30000);

  afterEach(() => {
    try {
      if (existsSync(dbFile)) unlinkSync(dbFile);
    } catch (e) {}
  });

  it('Teste A — bootstrap normal: provisiona infraestrutura completa e abertura via Orchestrator', async () => {
    const uow = new DrizzleUnitOfWork(db);
    const repo = new DrizzleFinanceRepository(db);

    const initialAmount = 1000000n; // R$ 10.000,00
    const res = await FinanceBootstrapService.seedSystemAccounts(uow, {
      currencyCode: 'BRL',
      initialBalanceBaseUnits: initialAmount,
    });

    expect(res.isSuccess).toBe(true);
    const data = res.getValue();

    // 1. Asset criado
    const assetRow = await sqlite.execute({
      sql: 'SELECT id, code, status FROM financial_assets WHERE id = ?',
      args: [data.assetId],
    });
    expect(assetRow.rows.length).toBe(1);
    expect(assetRow.rows[0].code).toBe('BRL');
    expect(assetRow.rows[0].status).toBe('active');

    // 2. 9 system accounts criadas com userId NULL
    const accRows = await sqlite.execute({
      sql: "SELECT COUNT(*) as cnt FROM financial_accounts WHERE user_id IS NULL AND status = 'active'",
      args: [],
    });
    expect(Number(accRows.rows[0].cnt)).toBe(9);

    // 3. Opening transaction criada via Orchestrator
    const txRows = await sqlite.execute({
      sql: 'SELECT id, type, status, description FROM financial_transactions',
      args: [],
    });
    expect(txRows.rows.length).toBe(1);
    expect(txRows.rows[0].type).toBe('adjustment');
    expect(txRows.rows[0].status).toBe('completed');
    expect(txRows.rows[0].description).toBe('Genesis Opening Balance Equity Allocation');
    const txId = Number(txRows.rows[0].id);

    // 4. Ledger entries = 2 (débito e crédito) com partidas dobradas
    const ledgerRows = await sqlite.execute({
      sql: 'SELECT account_id, direction, amount_base_units FROM financial_ledger_entries WHERE transaction_id = ?',
      args: [txId],
    });
    expect(ledgerRows.rows.length).toBe(2);

    const debitEntry = ledgerRows.rows.find((r: any) => r.direction === 'debit');
    const creditEntry = ledgerRows.rows.find((r: any) => r.direction === 'credit');
    expect(Number(debitEntry.account_id)).toBe(data.treasuryAccountId);
    expect(debitEntry.amount_base_units).toBe('1000000');
    expect(Number(creditEntry.account_id)).toBe(data.openingEquityAccountId);
    expect(creditEntry.amount_base_units).toBe('1000000');

    // 5. Idempotency = 1 registro completed
    const idemRows = await sqlite.execute({
      sql: "SELECT key, status, financial_transaction_id FROM idempotency_keys WHERE scope = 'finance'",
      args: [],
    });
    expect(idemRows.rows.length).toBe(1);
    expect(idemRows.rows[0].status).toBe('completed');
    expect(Number(idemRows.rows[0].financial_transaction_id)).toBe(txId);

    // 6. Saldos conferidos via repo
    const treasuryBal = await repo.getTreasuryBalance();
    expect(treasuryBal.isSuccess).toBe(true);
    const brlTreasury = treasuryBal.getValue().find((b) => b.assetId === data.assetId);
    expect(brlTreasury?.availableBaseUnits).toBe('1000000');

    const equityBalRow = await sqlite.execute({
      sql: 'SELECT available_base_units FROM account_balances WHERE account_id = ? AND asset_id = ?',
      args: [data.openingEquityAccountId, data.assetId],
    });
    expect(equityBalRow.rows[0].available_base_units).toBe('1000000');
  });

  it('Teste B — bootstrap repetido: não duplica transação contábil nem saldo', async () => {
    const uow = new DrizzleUnitOfWork(db);
    const repo = new DrizzleFinanceRepository(db);

    // Primeira execução
    const res1 = await FinanceBootstrapService.seedSystemAccounts(uow, {
      currencyCode: 'BRL',
      initialBalanceBaseUnits: 500000n,
    });
    expect(res1.isSuccess).toBe(true);

    // Segunda execução com os mesmos parâmetros
    const res2 = await FinanceBootstrapService.seedSystemAccounts(uow, {
      currencyCode: 'BRL',
      initialBalanceBaseUnits: 500000n,
    });
    expect(res2.isSuccess).toBe(true);

    // Contagem física de registros no banco de dados
    const assetCount = await sqlite.execute('SELECT COUNT(*) as cnt FROM financial_assets');
    expect(Number(assetCount.rows[0].cnt)).toBe(1);

    const accCount = await sqlite.execute('SELECT COUNT(*) as cnt FROM financial_accounts');
    expect(Number(accCount.rows[0].cnt)).toBe(9);

    const txCount = await sqlite.execute('SELECT COUNT(*) as cnt FROM financial_transactions');
    expect(Number(txCount.rows[0].cnt)).toBe(1);

    const ledgerCount = await sqlite.execute('SELECT COUNT(*) as cnt FROM financial_ledger_entries');
    expect(Number(ledgerCount.rows[0].cnt)).toBe(2);

    const idemCount = await sqlite.execute('SELECT COUNT(*) as cnt FROM idempotency_keys');
    expect(Number(idemCount.rows[0].cnt)).toBe(1);

    // Saldo da tesouraria permanece rigorosamente 500000n
    const treasuryBal = await repo.getTreasuryBalance();
    const brl = treasuryBal.getValue().find((b) => b.assetId === res1.getValue().assetId);
    expect(brl?.availableBaseUnits).toBe('500000');
  });

  it('Teste C — mesmo bootstrap com mesmo conteúdo: preserva o transaction_id da abertura e não cria nova transação', async () => {
    const uow = new DrizzleUnitOfWork(db);

    const res1 = await FinanceBootstrapService.seedSystemAccounts(uow, {
      currencyCode: 'BRL',
      initialBalanceBaseUnits: 750000n,
    });
    expect(res1.isSuccess).toBe(true);

    const txRow1 = await sqlite.execute('SELECT id, created_at FROM financial_transactions LIMIT 1');
    const firstTxId = Number(txRow1.rows[0].id);

    const res2 = await FinanceBootstrapService.seedSystemAccounts(uow, {
      currencyCode: 'BRL',
      initialBalanceBaseUnits: 750000n,
    });
    expect(res2.isSuccess).toBe(true);

    // Verifica que o transactionId associado à chave de idempotência é o mesmo
    const idemRow = await sqlite.execute('SELECT financial_transaction_id FROM idempotency_keys LIMIT 1');
    expect(Number(idemRow.rows[0].financial_transaction_id)).toBe(firstTxId);

    // Verifica que nenhuma segunda transação foi criada
    const txTotal = await sqlite.execute('SELECT COUNT(*) as cnt FROM financial_transactions');
    expect(Number(txTotal.rows[0].cnt)).toBe(1);
  });

  it('Teste D — mesmo idempotency key com conteúdo diferente: acusa conflito e não altera saldos', async () => {
    const uow = new DrizzleUnitOfWork(db);
    const repo = new DrizzleFinanceRepository(db);

    // 1. Executa primeiro bootstrap com 100000n
    const res1 = await FinanceBootstrapService.seedSystemAccounts(uow, {
      currencyCode: 'BRL',
      initialBalanceBaseUnits: 100000n,
    });
    expect(res1.isSuccess).toBe(true);

    // 2. Tenta executar segundo bootstrap com valor DIFERENTE (200000n) para o mesmo ativo e contas
    // A chave de idempotência é idêntica: finance:bootstrap:opening-balance:${treasuryAccountId}:${assetId}
    const res2 = await FinanceBootstrapService.seedSystemAccounts(uow, {
      currencyCode: 'BRL',
      initialBalanceBaseUnits: 200000n,
    });

    // Deve falhar com conflito de idempotência
    expect(res2.isFailure).toBe(true);
    expect(String(res2.error)).toMatch(/conflict|idempotênc|idempotenc/i);

    // Saldo original deve ser mantido inalterado (100000n)
    const treasuryBal = await repo.getTreasuryBalance();
    const brl = treasuryBal.getValue().find((b) => b.assetId === res1.getValue().assetId);
    expect(brl?.availableBaseUnits).toBe('100000');

    // Nenhuma transação ou lançamento adicional
    const txCount = await sqlite.execute('SELECT COUNT(*) as cnt FROM financial_transactions');
    expect(Number(txCount.rows[0].cnt)).toBe(1);
    const ledgerCount = await sqlite.execute('SELECT COUNT(*) as cnt FROM financial_ledger_entries');
    expect(Number(ledgerCount.rows[0].cnt)).toBe(2);
  });

  it('Teste E — falha no final do fluxo: provoca rollback integral e não deixa resíduos no banco', async () => {
    // Cria um UoW que injeta uma falha intencional imediatamente antes do commit
    const failingUow = {
      async execute<T>(work: any): Promise<any> {
        const t = await sqlite.transaction('write');
        const proxyDb = drizzle(t) as any;
        proxyDb.rollback = () => { throw new Error('DRIZZLE_ROLLBACK'); };
        try {
          // Cria factory transacional
          const { DrizzleFinanceRepository } = await import('../../src/infrastructure/repositories/DrizzleFinanceRepository');
          const factory = {
            getFinanceRepository: () => new DrizzleFinanceRepository(proxyDb),
            getOutboxRepository: () => ({
              // Simula falha catastrófica no Outbox
              saveEvent: async () => {
                const { Result } = await import('../../src/shared/kernel/Result');
                return Result.fail('Injected Outbox Failure during Genesis');
              },
            }),
          };

          const res = await work(factory);
          if (res && res.isFailure) {
            await t.rollback();
            return res;
          }
          await t.commit();
          return res;
        } catch (err: any) {
          try { await t.rollback(); } catch (e) {}
          const { Result } = await import('../../src/shared/kernel/Result');
          return Result.fail(`Transação abortada: ${err.message}`);
        }
      }
    };

    const res = await FinanceBootstrapService.seedSystemAccounts(failingUow as any, {
      currencyCode: 'BRL',
      initialBalanceBaseUnits: 1000000n,
    });

    expect(res.isFailure).toBe(true);

    // Prova de atomicidade total: TUDO no banco deve estar completamente limpo (revertido pelo rollback)
    const txCount = await sqlite.execute('SELECT COUNT(*) as cnt FROM financial_transactions');
    expect(Number(txCount.rows[0].cnt)).toBe(0);

    const ledgerCount = await sqlite.execute('SELECT COUNT(*) as cnt FROM financial_ledger_entries');
    expect(Number(ledgerCount.rows[0].cnt)).toBe(0);

    const idemCount = await sqlite.execute('SELECT COUNT(*) as cnt FROM idempotency_keys');
    expect(Number(idemCount.rows[0].cnt)).toBe(0);

    const accCount = await sqlite.execute('SELECT COUNT(*) as cnt FROM financial_accounts');
    expect(Number(accCount.rows[0].cnt)).toBe(0);

    const balCount = await sqlite.execute('SELECT COUNT(*) as cnt FROM account_balances');
    expect(Number(balCount.rows[0].cnt)).toBe(0);

    const assetCount = await sqlite.execute('SELECT COUNT(*) as cnt FROM financial_assets');
    expect(Number(assetCount.rows[0].cnt)).toBe(0);
  });
});
