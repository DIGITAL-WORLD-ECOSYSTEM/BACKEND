import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { runAllMigrationsLibSql } from '../test_helpers/runMigrations';
import { FinanceBootstrapService } from '../../src/infrastructure/services/FinanceBootstrapService';
import { DrizzleUnitOfWork } from '../../src/infrastructure/repositories/DrizzleUnitOfWork';
import { DrizzleFinanceRepository } from '../../src/infrastructure/repositories/DrizzleFinanceRepository';
import { RecordTreasuryTransactionUseCase } from '../../src/application/finance/use-cases/RecordTreasuryTransactionUseCase';
import { unlinkSync, existsSync } from 'fs';

describe('Hardening de Concorrência & Idempotência Forte (50 Conexões Simultâneas)', () => {
  const dbFile = 'test_concurrency_same_key.db';
  let sqlite: any;
  let db: any;
  let assetId: number;

  let writeLock = Promise.resolve();
  const createUow = () => {
    return new DrizzleUnitOfWork({
      ...db,
      transaction: async (cb: any) => {
        let release: () => void = () => {};
        const acquire = new Promise<void>((resolve) => {
          release = resolve;
        });
        const prevLock = writeLock;
        writeLock = writeLock.then(() => acquire);
        await prevLock;

        try {
          const t = await sqlite.transaction('write');
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
        } finally {
          release();
        }
      }
    });
  };

  beforeAll(async () => {
    if (existsSync(dbFile)) {
      try { unlinkSync(dbFile); } catch (e) {}
    }
    sqlite = createClient({ url: `file:${dbFile}` });
    db = drizzle(sqlite);

    await runAllMigrationsLibSql(sqlite);

    // Inserir usuários de teste
    await sqlite.execute(`
      INSERT INTO users (id, subject_type, email, email_normalized, status, auth_epoch, created_at, updated_at)
      VALUES 
        (10, 'human', 'concurrency10@example.com', 'concurrency10@example.com', 'active', 1, unixepoch(), unixepoch()),
        (20, 'human', 'concurrency20@example.com', 'concurrency20@example.com', 'active', 1, unixepoch(), unixepoch());
    `);

    // Provisionar tesouraria
    const bootRes = await FinanceBootstrapService.seedSystemAccounts(db, {
      currencyCode: 'BRL',
      initialBalanceBaseUnits: 5000000n, // R$ 50.000,00
    });
    if (bootRes.isFailure) {
      console.error('BOOTSTRAP ERROR IN TEST:', bootRes.error);
    }
    assetId = bootRes.getValue().assetId;
  }, 40000);

  afterAll(() => {
    try {
      if (existsSync(dbFile)) unlinkSync(dbFile);
    } catch (e) {}
  });

  it('Família A: 50 requisições simultâneas com a MESMA key e MESMO comando -> 1 execução e 49 replays (zero duplicação)', async () => {
    const key = 'concurrency-family-a-key';
    const command = {
      userId: 10,
      type: 'deposit' as const,
      direction: 'INBOUND' as const,
      category: 'operational' as const,
      description: 'Family A Simultaneous Same Key Replay',
      amountBaseUnits: '1000',
      assetId,
      idempotencyKey: key,
    };

    // Dispara 50 chamadas simultâneas
    const promises = Array.from({ length: 50 }).map(async () => {
      const uow = createUow();
      const useCase = new RecordTreasuryTransactionUseCase(uow);
      return useCase.execute(command);
    });

    const results = await Promise.all(promises);

    // Todas devem ter tido sucesso (1 executada + 49 replays ou retries de replays)
    const successes = results.filter(r => r.isSuccess);
    expect(successes.length).toBe(50);

    const values = successes.map(r => r.getValue());
    const processed = values.filter(v => !v.isReplayed);
    const replayed = values.filter(v => v.isReplayed);

    expect(processed.length).toBe(1);
    expect(replayed.length).toBe(49);

    const txId = processed[0].transactionId;
    for (const r of replayed) {
      expect(r.transactionId).toBe(txId);
    }

    // Auditoria física do banco de dados
    const txRows = await sqlite.execute({
      sql: `SELECT COUNT(*) as cnt FROM financial_transactions WHERE description = 'Family A Simultaneous Same Key Replay'`,
      args: [],
    });
    expect(Number(txRows.rows[0].cnt)).toBe(1);

    const ledgerRows = await sqlite.execute({
      sql: `SELECT COUNT(*) as cnt FROM financial_ledger_entries WHERE transaction_id = ?`,
      args: [txId],
    });
    expect(Number(ledgerRows.rows[0].cnt)).toBe(2);

    // Validação de double-entry física no banco
    const sumRows = await sqlite.execute({
      sql: `
        SELECT 
          SUM(CASE WHEN direction = 'debit' THEN CAST(amount_base_units AS INTEGER) ELSE 0 END) as total_debit,
          SUM(CASE WHEN direction = 'credit' THEN CAST(amount_base_units AS INTEGER) ELSE 0 END) as total_credit
        FROM financial_ledger_entries WHERE transaction_id = ?
      `,
      args: [txId],
    });
    expect(Number(sumRows.rows[0].total_debit)).toBe(1000);
    expect(Number(sumRows.rows[0].total_credit)).toBe(1000);
  });

  it('Família B: 50 requisições simultâneas com a MESMA key mas COMANDOS DIFERENTES -> 1 execução e 49 conflitos 409', async () => {
    const key = 'concurrency-family-b-key';

    // Dispara 50 chamadas com a MESMA chave, mas com quantias diferentes
    const promises = Array.from({ length: 50 }).map(async (_, idx) => {
      const uow = createUow();
      const useCase = new RecordTreasuryTransactionUseCase(uow);
      return useCase.execute({
        userId: 10,
        type: 'deposit',
        direction: 'INBOUND',
        category: 'operational',
        description: `Family B Diversified Payload #${idx}`,
        amountBaseUnits: String(1000 + idx), // Quantia diferente por chamada
        assetId,
        idempotencyKey: key,
      });
    });

    const results = await Promise.all(promises);

    const successes = results.filter(r => r.isSuccess);
    const conflicts = results.filter(r => r.isFailure);

    // Exatamente 1 deve ser aceita e processada; as outras 49 devem sofrer conflito de idempotência
    expect(successes.length).toBe(1);
    expect(conflicts.length).toBe(49);

    for (const failure of conflicts) {
      const errMsg = String(failure.error);
      expect(errMsg).toMatch(/409 Conflict|idempotência|Idempotency/i);
    }
  });

  it('Família C: Múltiplas requisições concorrendo pelo mesmo saldo limitado com OCC -> proteção estrita contra double-spending', async () => {
    // 1. Provisiona saldo inicial conhecido para o usuário 20 (R$ 100,00 = 10000 unidades)
    const initUow = createUow();
    const initUseCase = new RecordTreasuryTransactionUseCase(initUow);
    const depRes = await initUseCase.execute({
      userId: 20,
      type: 'deposit',
      direction: 'INBOUND',
      category: 'operational',
      description: 'Initial balance for OCC competition',
      amountBaseUnits: '10000',
      assetId,
      idempotencyKey: 'occ-user20-init-dep',
    });
    expect(depRes.isSuccess).toBe(true);

    // 2. Dispara 20 retiradas concorrentes de 1000 unidades cada (total pretendido: 20.000, mas o saldo é só 10.000!)
    const withdrawPromises = Array.from({ length: 20 }).map(async (_, idx) => {
      const uow = createUow();
      const useCase = new RecordTreasuryTransactionUseCase(uow);
      return useCase.execute({
        userId: 20,
        type: 'withdrawal',
        direction: 'OUTBOUND',
        category: 'operational',
        description: `Competitive Withdrawal #${idx}`,
        amountBaseUnits: '1000',
        assetId,
        idempotencyKey: `occ-comp-withdraw-${idx}`,
      });
    });

    const results = await Promise.all(withdrawPromises);

    const successes = results.filter(r => r.isSuccess);
    const failures = results.filter(r => r.isFailure);

    // No máximo 10 saques podem ter tido sucesso (pois 10 * 1000 = 10000)!
    expect(successes.length).toBeLessThanOrEqual(10);
    expect(failures.length).toBeGreaterThanOrEqual(10);

    // 3. Auditoria do saldo final da conta do usuário 20: JAMAIS pode ser negativo!
    const repo = new DrizzleFinanceRepository(db);
    const userAccRes = await repo.getOrCreateUserAccount(20);
    const userAccId = userAccRes.getValue().id;

    const balRow = await sqlite.execute({
      sql: `SELECT available_base_units FROM account_balances WHERE account_id = ? AND asset_id = ?`,
      args: [userAccId, assetId],
    });
    const finalBalance = BigInt(balRow.rows[0].available_base_units as string);
    expect(finalBalance).toBeGreaterThanOrEqual(0n);

    // Saldo final deve ser exatamente o saldo inicial (10000) menos a soma dos saques com sucesso
    const totalWithdrawn = BigInt(successes.length) * 1000n;
    expect(finalBalance).toBe(10000n - totalWithdrawn);
  });
});
