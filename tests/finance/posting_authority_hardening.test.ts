import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { eq } from 'drizzle-orm';
import { unlinkSync } from 'fs';

import { DrizzleUnitOfWork } from '../../src/infrastructure/repositories/DrizzleUnitOfWork';
import { LedgerTransaction, LedgerEntry } from '../../src/domains/finance/entities/LedgerTransaction';
import { Money256 } from '../../src/domains/finance/value-objects/Money256';
import { FinancialTransactionOrchestrator } from '../../src/application/finance/services/FinancialTransactionOrchestrator';
import { RecordLedgerTransactionUseCase } from '../../src/application/finance/use-cases/RecordLedgerTransactionUseCase';
import {
  financialAccounts,
  financialTransactions,
  financialLedgerEntries,
  accountBalances,
  financialAssets,
} from '../../src/db/finance/tables';
import { idempotencyKeys, outboxEvents } from '../../src/db/infrastructure/tables';
import {
  AccountInactiveError,
  AssetInactiveError,
  InvalidAccountClassError,
  InvalidStateTransitionError,
} from '../../src/domains/finance/errors/FinancialError';
import { runAllMigrationsLibSql } from '../test_helpers/runMigrations';

describe('Gate 3/4 Hardening: Autoridade Física de Posting e Fechamento de Bypasses', () => {
  let sqlite: any;
  let db: any;
  let uow: DrizzleUnitOfWork;
  const DB_NAME = 'test_posting_authority_hardening.db';

  beforeAll(async () => {
    sqlite = createClient({ url: `file:${DB_NAME}` });
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
          try {
            await t.rollback();
          } catch (e) {}
          if (err.message === 'drizzle-rollback') return;
          throw err;
        }
      },
    };

    await runAllMigrationsLibSql(sqlite);

    await sqlite.executeMultiple(`
      INSERT INTO users (id, email, email_normalized, status, created_at, updated_at)
        VALUES (10, 'user10@hardening.com', 'user10@hardening.com', 'active', 1000, 1000);
      INSERT INTO users (id, email, email_normalized, status, created_at, updated_at)
        VALUES (20, 'user20@hardening.com', 'user20@hardening.com', 'active', 1000, 1000);

      -- Ativo 1: BRL (active)
      INSERT INTO financial_assets (id, symbol, code, name, type, decimals, status, created_at, updated_at)
        VALUES (1, 'BRL', 'BRL', 'Brazilian Real', 'fiat', 2, 'active', 1000, 1000);
      -- Ativo 2: INACTIVE_TOKEN (inactive)
      INSERT INTO financial_assets (id, symbol, code, name, type, decimals, status, created_at, updated_at)
        VALUES (2, 'INAC', 'INAC', 'Inactive Token', 'crypto', 8, 'inactive', 1000, 1000);

      -- Conta 1: User 10 (user_available, liability, active)
      INSERT INTO financial_accounts (id, user_id, account_type, account_class, status, name, version, created_at, updated_at)
        VALUES (1, 10, 'user_available', 'liability', 'active', 'User 10 Account', 1, 1000, 1000);
      -- Conta 2: Treasury (treasury, asset, active)
      INSERT INTO financial_accounts (id, user_id, account_type, account_class, status, name, version, created_at, updated_at)
        VALUES (2, NULL, 'treasury', 'asset', 'active', 'Treasury Vault', 1, 1000, 1000);
      -- Conta 3: User 20 INACTIVE (user_available, liability, inactive)
      INSERT INTO financial_accounts (id, user_id, account_type, account_class, status, name, version, created_at, updated_at)
        VALUES (3, 20, 'user_available', 'liability', 'inactive', 'User 20 Inactive Account', 1, 1000, 1000);
      -- Conta 4: Incompatible class (fees com class 'asset' ao invés de 'revenue')
      INSERT INTO financial_accounts (id, user_id, account_type, account_class, status, name, version, created_at, updated_at)
        VALUES (4, NULL, 'fees', 'asset', 'active', 'Mismatched Fees Account', 1, 1000, 1000);

      INSERT INTO account_balances (id, account_id, asset_id, available_base_units, locked_base_units, version, updated_at)
        VALUES (1, 1, 1, '5000', '0', 1, 1000);
      INSERT INTO account_balances (id, account_id, asset_id, available_base_units, locked_base_units, version, updated_at)
        VALUES (2, 2, 1, '50000', '0', 1, 1000);
      INSERT INTO account_balances (id, account_id, asset_id, available_base_units, locked_base_units, version, updated_at)
        VALUES (3, 3, 1, '1000', '0', 1, 1000);
    `);

    uow = new DrizzleUnitOfWork(uowDb);
  }, 30000);

  afterAll(() => {
    sqlite.close();
    try {
      unlinkSync(DB_NAME);
    } catch (e) {}
  });

  const getDBCounts = async () => {
    const txs = (await db.select().from(financialTransactions)).length;
    const entries = (await db.select().from(financialLedgerEntries)).length;
    const idem = (await db.select().from(idempotencyKeys)).length;
    const outbox = (await db.select().from(outboxEvents)).length;
    return { txs, entries, idem, outbox };
  };

  it('VETOR 1: Rejeita conta inexistente ANTES de qualquer INSERT no banco', async () => {
    const initialState = await getDBCounts();
    const amount = Money256.fromString('100', 1);

    const tx = LedgerTransaction.create({
      idempotencyKey: 'test-nonexistent-acc-key',
      userId: 10,
      description: 'Tentativa com conta inexistente',
      transactionType: 'deposit',
      category: 'deposit',
      entries: [
        new LedgerEntry({ accountId: '999999', amount, type: 'debit' }),
        new LedgerEntry({ accountId: '2', amount, type: 'credit' }),
      ],
    });

    const result = await uow.execute(async (factory) => {
      const repo = factory.getFinanceRepository();
      const orchestrator = new FinancialTransactionOrchestrator(repo, factory.getOutboxRepository());
      return await orchestrator.executePosting(tx);
    });

    expect(result.isFailure).toBe(true);
    expect(result.error).toContain('Conta financeira #999999 não encontrada');

    const finalState = await getDBCounts();
    expect(finalState.txs).toBe(initialState.txs);
    expect(finalState.entries).toBe(initialState.entries);
    expect(finalState.idem).toBe(initialState.idem);
    expect(finalState.outbox).toBe(initialState.outbox);
  });

  it('VETOR 1: Rejeita conta inativa com AccountInactiveError antes do insert', async () => {
    const initialState = await getDBCounts();
    const amount = Money256.fromString('100', 1);

    const tx = LedgerTransaction.create({
      idempotencyKey: 'test-inactive-acc-key',
      userId: 10,
      description: 'Tentativa com conta inativa',
      transactionType: 'transfer',
      category: 'operational',
      entries: [
        new LedgerEntry({ accountId: '1', amount, type: 'debit' }),
        new LedgerEntry({ accountId: '3', amount, type: 'credit' }),
      ],
    });

    const result = await uow.execute(async (factory) => {
      const repo = factory.getFinanceRepository();
      const orchestrator = new FinancialTransactionOrchestrator(repo, factory.getOutboxRepository());
      return await orchestrator.executePosting(tx);
    });

    expect(result.isFailure).toBe(true);
    expect(result.error).toContain('Movimentações somente são permitidas em contas ativas');

    const finalState = await getDBCounts();
    expect(finalState.txs).toBe(initialState.txs);
    expect(finalState.entries).toBe(initialState.entries);
  });

  it('VETOR 2: Rejeita conta inativa MESMO QUANDO delta líquido é zero (Fechamento do Delta Zero)', async () => {
    const initialState = await getDBCounts();
    const amount = Money256.fromString('100', 1);

    // Conta 3 está inativa, mas debit 100 e credit 100 na Conta 3 somam delta 0!
    // No código antigo, o OCC pulava com continue; e a conta inativa passava!
    const tx = LedgerTransaction.create({
      idempotencyKey: 'test-delta-zero-inactive-key',
      userId: 10,
      description: 'Transação com delta zero em conta inativa',
      transactionType: 'transfer',
      category: 'operational',
      entries: [
        new LedgerEntry({ accountId: '3', amount, type: 'debit', description: 'Leg 1 Debit' }),
        new LedgerEntry({ accountId: '3', amount, type: 'credit', description: 'Leg 1 Credit' }),
        new LedgerEntry({ accountId: '1', amount, type: 'debit', description: 'Leg 2 Debit' }),
        new LedgerEntry({ accountId: '2', amount, type: 'credit', description: 'Leg 2 Credit' }),
      ],
    });

    const result = await uow.execute(async (factory) => {
      const repo = factory.getFinanceRepository();
      const orchestrator = new FinancialTransactionOrchestrator(repo, factory.getOutboxRepository());
      return await orchestrator.executePosting(tx);
    });

    expect(result.isFailure).toBe(true);
    expect(result.error).toContain('Movimentações somente são permitidas em contas ativas');

    const finalState = await getDBCounts();
    expect(finalState.txs).toBe(initialState.txs);
    expect(finalState.entries).toBe(initialState.entries);
  });

  it('VETOR 1: Rejeita ativo suspenso/inativo com AssetInactiveError antes de qualquer INSERT', async () => {
    const initialState = await getDBCounts();
    const amountSuspended = Money256.fromString('50', 2);

    const tx = LedgerTransaction.create({
      idempotencyKey: 'test-suspended-asset-key',
      userId: 10,
      description: 'Tentativa com ativo suspenso',
      transactionType: 'deposit',
      category: 'deposit',
      entries: [
        new LedgerEntry({ accountId: '2', amount: amountSuspended, type: 'debit' }),
        new LedgerEntry({ accountId: '1', amount: amountSuspended, type: 'credit' }),
      ],
    });

    const result = await uow.execute(async (factory) => {
      const repo = factory.getFinanceRepository();
      const orchestrator = new FinancialTransactionOrchestrator(repo, factory.getOutboxRepository());
      return await orchestrator.executePosting(tx);
    });

    expect(result.isFailure).toBe(true);
    expect(result.error).toContain('Operações financeiras exigem que o ativo esteja ativo');

    const finalState = await getDBCounts();
    expect(finalState.txs).toBe(initialState.txs);
    expect(finalState.entries).toBe(initialState.entries);
  });

  it('VETOR 4: Rejeita conta com AccountClass incompatível segundo AccountClassPolicy', async () => {
    const initialState = await getDBCounts();
    const amount = Money256.fromString('25', 1);

    // Conta 4 possui accountType 'fees', mas accountClass 'asset' (fees só aceita 'revenue')
    const tx = LedgerTransaction.create({
      idempotencyKey: 'test-incompatible-class-key',
      userId: 10,
      description: 'Tentativa com conta com classe incompatível',
      transactionType: 'fee',
      category: 'fee',
      entries: [
        new LedgerEntry({ accountId: '1', amount, type: 'debit' }),
        new LedgerEntry({ accountId: '4', amount, type: 'credit' }),
      ],
    });

    const result = await uow.execute(async (factory) => {
      const repo = factory.getFinanceRepository();
      const orchestrator = new FinancialTransactionOrchestrator(repo, factory.getOutboxRepository());
      return await orchestrator.executePosting(tx);
    });

    expect(result.isFailure).toBe(true);
    expect(result.error).toContain('Classe de conta "asset" é incompatível com o tipo de conta "fees"');

    const finalState = await getDBCounts();
    expect(finalState.txs).toBe(initialState.txs);
    expect(finalState.entries).toBe(initialState.entries);
  });

  it('FLUXO COMPLETO DE SUCESSO: pending -> processing -> completed e Outbox persistido', async () => {
    const amount = Money256.fromString('150', 1);
    const key = 'test-full-success-pipeline-key';

    const tx = LedgerTransaction.create({
      idempotencyKey: key,
      userId: 10,
      description: 'Postagem com ciclo de vida completo',
      transactionType: 'deposit',
      category: 'deposit',
      entries: [
        new LedgerEntry({ accountId: '2', amount, type: 'debit' }),
        new LedgerEntry({ accountId: '1', amount, type: 'credit' }),
      ],
    });

    // Executa via RecordLedgerTransactionUseCase (ponto de entrada de aplicação)
    const useCase = new RecordLedgerTransactionUseCase(uow);
    const result = await useCase.execute(tx);

    expect(result.isSuccess).toBe(true);
    const { transactionId, isReplayed } = result.getValue();
    expect(transactionId).toBeGreaterThan(0);
    expect(isReplayed).toBe(false);

    // Verificar se no banco de dados o status final é estritamente 'completed'
    const [savedTx] = await db
      .select()
      .from(financialTransactions)
      .where(eq(financialTransactions.id, transactionId));
    expect(savedTx.status).toBe('completed');

    // Verificar se o evento de outbox foi registrado
    const [savedEvent] = await db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.aggregateId, String(transactionId)));
    expect(savedEvent).toBeDefined();
    expect(savedEvent.aggregateType).toBe('LedgerTransaction');

    // Testar Idempotency Replay (P0-1): segunda chamada idêntica deve retornar replay com sucesso
    const replayResult = await useCase.execute(tx);
    expect(replayResult.isSuccess).toBe(true);
    expect(replayResult.getValue().transactionId).toBe(transactionId);
    expect(replayResult.getValue().isReplayed).toBe(true);
  });
});
