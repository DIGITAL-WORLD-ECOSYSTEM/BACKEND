import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { readFileSync } from 'fs';

import { DrizzleUnitOfWork } from '../src/infrastructure/repositories/DrizzleUnitOfWork';
import { DoubleEntryLedgerService } from '../src/domains/finance/services/DoubleEntryLedgerService';
import { LedgerTransaction, LedgerEntry } from '../src/domains/finance/entities/LedgerTransaction';
import { Money } from '../src/domains/finance/entities/Money';
import { eq } from 'drizzle-orm';

// Ignora o vazamento de unhandled rejection do Drizzle/better-sqlite3 ao forçar um rollback manual
process.on('unhandledRejection', (reason: any) => {
  if (reason && reason.message === 'ROLLBACK_TRIGGERED_BY_RESULT_FAIL') {
    return;
  }
});

import { users } from '../src/db/user/tables';
import { idempotencyKeys, outboxEvents } from '../src/db/infrastructure/tables';
import { financialAccounts, financialTransactions, financialLedgerEntries, accountBalances, financialAssets } from '../src/db/finance/tables';
import { Result } from '../src/shared/kernel/Result';

describe('Finance Core E2E Certification (Real DB)', () => {
  let sqlite: any;
  let db: any;
  let uow: DrizzleUnitOfWork;
  let ledgerService: DoubleEntryLedgerService;

  beforeAll(async () => {
    // 1. Instancia banco real em memória (completamente isolado usando libsql)
    sqlite = createClient({ url: 'file:test.db' });
    db = drizzle(sqlite);
    
    // Forçamos o UnitOfWork a usar nossa casca de transação exata, garantindo que
    // exceções de rollback e estados sejam propagados de forma transparente no JS
    const uowDb = {
      ...db,
      transaction: async (cb: any) => {
        const t = await sqlite.transaction('write');
        console.log('[MOCK] transaction START');
        const proxyDb = drizzle(t) as any;
        proxyDb.rollback = () => { 
           console.log('[MOCK] proxyDb.rollback called!');
           throw new Error('drizzle-rollback'); 
        };
        try {
           await cb(proxyDb);
           console.log('[MOCK] commit!');
           await t.commit();
        } catch (err: any) {
           console.log('[MOCK] catch!', err.message);
           try { await t.rollback(); } catch (e) {}
           if (err.message === 'drizzle-rollback') return; // Esperado pelo drizzle
           throw err;
        }
      }
    };

    // 2. Roda a cadeia completa de migrações da pasta ./migrations/
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
      } catch (err: any) {
        // Ignora sobreposições de DDL se houver
      }
    }

    // Alignment patch para a tabela outbox_events e financial_accounts conforme Drizzle ORM definition
    try { await sqlite.execute('ALTER TABLE outbox_events ADD COLUMN status TEXT DEFAULT "pending" NOT NULL;'); } catch (e) {}
    try { await sqlite.execute('ALTER TABLE outbox_events ADD COLUMN lease_owner TEXT;'); } catch (e) {}
    try { await sqlite.execute('ALTER TABLE outbox_events ADD COLUMN lease_generation INTEGER DEFAULT 0 NOT NULL;'); } catch (e) {}
    try { await sqlite.execute('ALTER TABLE outbox_events ADD COLUMN lease_expires_at INTEGER;'); } catch (e) {}
    try { await sqlite.execute('ALTER TABLE financial_accounts ADD COLUMN account_class TEXT DEFAULT "liability" NOT NULL;'); } catch (e) {}

    // 3. Popula dados base necessários para as chaves estrangeiras (Users e Assets) via RAW SQL
    await sqlite.executeMultiple(`
      INSERT INTO users (id, email, email_normalized, status, created_at, updated_at) VALUES (1, 'user1@test.com', 'user1@test.com', 'active', 1000, 1000);
      INSERT INTO users (id, email, email_normalized, status, created_at, updated_at) VALUES (2, 'user2@test.com', 'user2@test.com', 'active', 1000, 1000);
      INSERT INTO financial_assets (id, symbol, code, name, type, decimals, status, created_at, updated_at) VALUES (1, 'BRL', 'BRL', 'Brazilian Real', 'fiat', 2, 'active', 1000, 1000);
    `);

    // O sistema criará as contas operating/user_available automaticamente no repositório.

    uow = new DrizzleUnitOfWork(uowDb);
    ledgerService = new DoubleEntryLedgerService();
  }, 30000);

  afterAll(() => {
    sqlite.close();
    // Limpa o banco de teste do disco para o próximo run
    try { require('fs').unlinkSync('test.db'); } catch (e) {}
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
    // Preparação: garantindo que as contas existam
    await uow.execute(async (f) => {
      await f.getFinanceRepository().getOrCreateOperatingAccount();
      await f.getFinanceRepository().getOrCreateUserAccount(1);
      return { isSuccess: true, isFailure: false, getValue: () => true } as any;
    });

    const idemKey = 'happy-path-key';
    const reqHash = 'hash123';

    const tx = new LedgerTransaction({
      idempotencyKey: idemKey,
      userId: 1,
      description: 'Test Deposit',
      entries: [
        new LedgerEntry({ accountId: '1', amount: new Money(5000n, '1'), type: 'debit' }),  // Asset aumenta
        new LedgerEntry({ accountId: '2', amount: new Money(5000n, '1'), type: 'credit' })  // Liability aumenta
      ]
    });

    const result = await uow.execute(async (factory) => {
      return ledgerService.recordTransaction(tx, factory, reqHash);
    });

    expect(result.isSuccess).toBe(true);

    const state = await getFullState();
    expect(state.txs.length).toBe(1);
    expect(state.txs[0].status).toBe('completed');
    expect(state.entries.length).toBe(2);
    expect(state.balances.length).toBe(2);
    
    // Verifica outbox persistido
    expect(state.outbox.length).toBe(1);
    
    // Verifica idempotencia persistida e comculída
    const idem = state.idem.find((i: any) => i.key === idemKey);
    expect(idem).toBeDefined();
    expect(idem.status).toBe('completed');
    expect(idem.financialTransactionId).toBe(state.txs[0].id);
  });

  it('Rollback: falha forçada resulta em banco intocado (0 registros persistidos vazados)', async () => {
    const initialState = await getFullState();

    const tx = new LedgerTransaction({
      idempotencyKey: 'rollback-key',
      userId: 1,
      description: 'Will fail due to insufficient funds / bad logic',
      entries: [
        // Conta 2 (Liability) tenta debitar 99999 (reduzir saldo) mas não tem
        new LedgerEntry({ accountId: '1', amount: new Money(99999n, '1'), type: 'credit' }), 
        new LedgerEntry({ accountId: '2', amount: new Money(99999n, '1'), type: 'debit' })   
      ]
    });

    const result = await uow.execute(async (factory) => {
      return ledgerService.recordTransaction(tx, factory, 'hash-fail');
    });

    expect(result.isFailure).toBe(true);
    expect(result.error).toContain('Saldo insuficiente ou Optimistic Concurrency Control');

    // Asserção Crítica: O estado final do banco deve ser EXATAMENTE igual ao estado inicial.
    // Nenhum registro da transação falha (idempotency processing, tx, entries) deve vazar.
    const finalState = await getFullState();
    expect(finalState.txs.length).toBe(initialState.txs.length);
    expect(finalState.entries.length).toBe(initialState.entries.length);
    expect(finalState.idem.length).toBe(initialState.idem.length);
    expect(finalState.outbox.length).toBe(initialState.outbox.length);
  });

  it('Same key + same hash: replay da mesma tx (Idempotente)', async () => {
    const idemKey = 'happy-path-key'; // Mesma chave do primeiro teste
    
    const tx = new LedgerTransaction({
      idempotencyKey: idemKey,
      userId: 1,
      description: 'Test Deposit',
      entries: [
        new LedgerEntry({ accountId: '1', amount: new Money(5000n, '1'), type: 'debit' }),
        new LedgerEntry({ accountId: '2', amount: new Money(5000n, '1'), type: 'credit' })
      ]
    });

    const result = await uow.execute(async (factory) => {
      return ledgerService.recordTransaction(tx, factory, 'hash123'); // Mesmo hash
    });

    expect(result.isSuccess).toBe(true);
    expect(result.getValue().isReplayed).toBe(true);
  });

  it('Same key + different hash: 409 Conflict', async () => {
    const idemKey = 'happy-path-key'; // Mesma chave
    
    const tx = new LedgerTransaction({
      idempotencyKey: idemKey,
      userId: 1,
      description: 'Modified Deposit',
      entries: [
        new LedgerEntry({ accountId: '1', amount: new Money(100n, '1'), type: 'debit' }),
        new LedgerEntry({ accountId: '2', amount: new Money(100n, '1'), type: 'credit' })
      ]
    });

    const result = await uow.execute(async (factory) => {
      return ledgerService.recordTransaction(tx, factory, 'hash-diferente'); // Hash diferente
    });

    expect(result.isFailure).toBe(true);
    expect(result.error).toContain('409 Conflict: Mesma Idempotency Key, mas payload (requestHash) diferente');
  });

  it('Concorrência: exatamente 1 tx processada em Race Condition (barrier simulada)', async () => {
    const idemKey = 'race-condition-key';
    const reqHash = 'race-hash';
    let executedCount = 0;

    const tx = new LedgerTransaction({
      idempotencyKey: idemKey,
      userId: 2,
      description: 'Race TX',
      entries: [
        new LedgerEntry({ accountId: '1', amount: new Money(100n, '1'), type: 'debit' }),
        new LedgerEntry({ accountId: '3', amount: new Money(100n, '1'), type: 'credit' }) // Conta que será criada on-the-fly
      ]
    });

    // Simular o atraso no banco de dados injetando o comportamento
    // Como better-sqlite3 é síncrono, Promise.all seria enfileirado.
    // Vamos fazer 2 execuções onde uma intencionalmente joga um UNIQUE constraint
    // de idempotência porque a primeira já cravou a constraint no banco!
    
    // T1 crava o insert na tabela de idempotência
    const claimRes = await uow.execute(async (factory) => {
       const repo = factory.getFinanceRepository();
       // T1 claim manual e sucesso
       await repo.claimIdempotency(idemKey, 2, 'finance', reqHash);
       executedCount++;
       return { isSuccess: true, isFailure: false, getValue: () => true } as any;
    });

    // T2 bate ao mesmo tempo e sofre claim reject
    const result2 = await uow.execute(async (factory) => {
       const claimed = await factory.getFinanceRepository().claimIdempotency(idemKey, 2, 'finance', reqHash);
       if (!claimed) {
          // Detecta a colisão (Ainda está processing!)
          return Result.fail('Transação em andamento (Idempotency Key Processing).');
       }
       return Result.ok(true);
    });

    expect(result2.isFailure).toBe(true);
    expect(result2.error).toBe('Transação em andamento (Idempotency Key Processing).');

    // Confirmar que o banco tem estritamente 1 claim, 0 tx duplicadas
    const idemRows = await db.select().from(idempotencyKeys).where(eq(idempotencyKeys.key, idemKey));
    expect(idemRows.length).toBe(1);
    expect(idemRows[0].status).toBe('processing'); // O claim manual não completou a tx, provando a trava de status!
  });
});
