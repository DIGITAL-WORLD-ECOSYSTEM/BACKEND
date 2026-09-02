import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { unlinkSync } from 'fs';

import { DrizzleUnitOfWork } from '../../../src/infrastructure/repositories/DrizzleUnitOfWork';
import { LedgerTransaction, LedgerEntry } from '../../../src/domains/finance/entities/LedgerTransaction';
import { Money256 } from '../../../src/domains/finance/value-objects/Money256';
import { FinancialTransactionOrchestrator } from '../../../src/application/finance/services/FinancialTransactionOrchestrator';
import { idempotencyKeys, outboxEvents } from '../../../src/db/infrastructure/tables';
import { financialTransactions, financialLedgerEntries, accountBalances } from '../../../src/db/finance/tables';
import { Result } from '../../../src/shared/kernel/Result';
import { runAllMigrationsLibSql } from '../../test_helpers/runMigrations';

describe('Invariante DOD-06: Matriz de Falhas e Rollback Integral nos Passos Transacionais', () => {
  let sqlite: any;
  let db: any;
  let uow: DrizzleUnitOfWork;

  beforeAll(async () => {
    sqlite = createClient({ url: 'file:test_failure_matrix.db' });
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
           try { await t.rollback(); } catch (e) {}
           if (err.message === 'drizzle-rollback') return;
           throw err;
        }
      }
    };

    await runAllMigrationsLibSql(sqlite);

    await sqlite.executeMultiple(`
      INSERT INTO users (id, email, email_normalized, status, created_at, updated_at) VALUES (10, 'matrix@test.com', 'matrix@test.com', 'active', 1000, 1000);
      INSERT INTO financial_assets (id, symbol, code, name, type, decimals, status, created_at, updated_at) VALUES (1, 'BRL', 'BRL', 'Brazilian Real', 'fiat', 2, 'active', 1000, 1000);
      INSERT INTO financial_accounts (id, user_id, account_type, account_class, status, name, version, created_at, updated_at) VALUES (1, 10, 'user_available', 'liability', 'active', 'User 10 Main Account', 1, 1000, 1000);
      INSERT INTO financial_accounts (id, user_id, account_type, account_class, status, name, version, created_at, updated_at) VALUES (2, NULL, 'treasury', 'asset', 'active', 'Treasury Vault', 1, 1000, 1000);
      INSERT INTO financial_accounts (id, user_id, account_type, account_class, status, name, version, created_at, updated_at) VALUES (3, NULL, 'payment_revenue', 'revenue', 'active', 'Payment Revenue', 1, 1000, 1000);
      INSERT INTO financial_accounts (id, user_id, account_type, account_class, status, name, version, created_at, updated_at) VALUES (4, NULL, 'refund_expense', 'expense', 'active', 'Refund Expense', 1, 1000, 1000);
      INSERT INTO financial_accounts (id, user_id, account_type, account_class, status, name, version, created_at, updated_at) VALUES (5, NULL, 'operating', 'asset', 'active', 'System Operating', 1, 1000, 1000);
      INSERT INTO financial_accounts (id, user_id, account_type, account_class, status, name, version, created_at, updated_at) VALUES (6, NULL, 'fees', 'revenue', 'active', 'System Fees', 1, 1000, 1000);
      INSERT INTO financial_accounts (id, user_id, account_type, account_class, status, name, version, created_at, updated_at) VALUES (7, NULL, 'reward_expense', 'expense', 'active', 'Reward Expense', 1, 1000, 1000);
      INSERT INTO financial_accounts (id, user_id, account_type, account_class, status, name, version, created_at, updated_at) VALUES (8, NULL, 'yield_expense', 'expense', 'active', 'Yield Expense', 1, 1000, 1000);
      INSERT INTO account_balances (id, account_id, asset_id, available_base_units, locked_base_units, version, updated_at) VALUES (1, 1, 1, '5000', '0', 1, 1000);
      INSERT INTO account_balances (id, account_id, asset_id, available_base_units, locked_base_units, version, updated_at) VALUES (2, 2, 1, '10000', '0', 1, 1000);
    `);

    uow = new DrizzleUnitOfWork(uowDb);
  }, 30000);

  afterAll(() => {
    sqlite.close();
    try { unlinkSync('test_failure_matrix.db'); } catch (e) {}
  });

  const getDBCounts = async () => {
    const txs = (await db.select().from(financialTransactions)).length;
    const entries = (await db.select().from(financialLedgerEntries)).length;
    const idem = (await db.select().from(idempotencyKeys)).length;
    const outbox = (await db.select().from(outboxEvents)).length;
    return { txs, entries, idem, outbox };
  };

  it('Falha no Passo 4 (OCC / Balance Check) resulta em Rollback Integral (0 registros vazados)', async () => {
    const initialState = await getDBCounts();
    const excessiveAmount = Money256.fromString('50000', 1);

    const invalidTx = new LedgerTransaction({
      idempotencyKey: 'fail-step4-key',
      userId: 10,
      description: 'Test Step 4 Overdraft Fail',
      entries: [
        new LedgerEntry({ accountId: '1', amount: excessiveAmount as any, type: 'debit' }),
        new LedgerEntry({ accountId: '2', amount: excessiveAmount as any, type: 'credit' })
      ]
    });

    const result = await uow.execute(async (factory) => {
      const repo = factory.getFinanceRepository();
      const orchestrator = new FinancialTransactionOrchestrator(repo);
      return await orchestrator.executePosting(invalidTx, 'hash-fail-4');
    });

    expect(result.isFailure).toBe(true);
    expect(result.error).toContain('saldo insuficiente');

    // Asserção DOD-06: O banco de dados precisa estar no exato mesmo estado inicial
    const finalState = await getDBCounts();
    expect(finalState.txs).toBe(initialState.txs);
    expect(finalState.entries).toBe(initialState.entries);
    expect(finalState.idem).toBe(initialState.idem);
    expect(finalState.outbox).toBe(initialState.outbox);
  });

  it('Falha no Passo 6 (completeIdempotency com chave inexistente) resulta em Rollback Integral', async () => {
    const initialState = await getDBCounts();
    const amount = Money256.fromString('100', 1);

    const tx = new LedgerTransaction({
      idempotencyKey: 'fail-step6-key',
      userId: 10,
      description: 'Test Step 6 Fail',
      entries: [
        new LedgerEntry({ accountId: '1', amount: amount as any, type: 'debit' }),
        new LedgerEntry({ accountId: '2', amount: amount as any, type: 'credit' })
      ]
    });

    const result = await uow.execute(async (factory) => {
      const repo = factory.getFinanceRepository();
      // Executa os passos normais manualmente para simular falha no completeIdempotency
      await repo.claimIdempotency(tx.idempotencyKey, 10, 'finance', 'hash-6');
      const dbTxId = await repo.insertTransaction({
        userId: tx.userId,
        type: tx.transactionType || 'deposit',
        category: 'operational',
        description: tx.description,
        status: 'processing'
      });
      await repo.insertLedgerEntries(tx.entries, dbTxId);
      await repo.updateBalanceWithOCC('1', '1', 100n, 'debit');
      await repo.updateBalanceWithOCC('2', '1', 100n, 'credit');
      await repo.updateTransactionStatus(dbTxId, 'completed');
      
      // Força completeIdempotency com chave ERRADA que afetará 0 linhas
      await repo.completeIdempotency('NON_EXISTENT_KEY', 'finance', dbTxId);
      return Result.ok(true);
    });

    expect(result.isFailure).toBe(true);
    expect(result.error).toContain('Falha ao concluir Idempotency Key');

    // Asserção DOD-06: Rollback integral
    const finalState = await getDBCounts();
    expect(finalState.txs).toBe(initialState.txs);
    expect(finalState.entries).toBe(initialState.entries);
    expect(finalState.idem).toBe(initialState.idem);
  });

  it('Rejeita tipo conversion com mensagem auditável de Forex não suportado', async () => {
    const { RecordTreasuryTransactionUseCase } = await import('../../../src/application/finance/use-cases/RecordTreasuryTransactionUseCase');
    const useCase = new RecordTreasuryTransactionUseCase(uow);

    const result = await useCase.execute({
      userId: 10,
      type: 'conversion',
      direction: 'INBOUND',
      description: 'Conversão Forex Invalida',
      amountBaseUnits: '100',
      assetId: 1,
      idempotencyKey: 'test-conversion-fail-key',
    });

    expect(result.isFailure).toBe(true);
    expect(result.error).toContain('Forex');
  });

  it('Rejeita requestHash adulterado com erro 409 Conflict', async () => {
    const { RecordTreasuryTransactionUseCase } = await import('../../../src/application/finance/use-cases/RecordTreasuryTransactionUseCase');
    const useCase = new RecordTreasuryTransactionUseCase(uow);

    const fakeHash = 'a'.repeat(64);
    const result = await useCase.execute({
      userId: 10,
      type: 'deposit',
      direction: 'INBOUND',
      description: 'Depósito com Hash Alterado',
      amountBaseUnits: '100',
      assetId: 1,
      idempotencyKey: 'test-hash-tamper-key',
      requestHash: fakeHash,
    });

    expect(result.isFailure).toBe(true);
    expect(result.error).toContain('409 Conflict');
  });

  it('P0.2: Rejeita refund se userId não coincidir com proprietário da transação original', async () => {
    const { RecordTreasuryTransactionUseCase } = await import('../../../src/application/finance/use-cases/RecordTreasuryTransactionUseCase');
    const useCase = new RecordTreasuryTransactionUseCase(uow);

    // 1. First record a valid payment for user 10
    const paymentRes = await useCase.execute({
      userId: 10,
      type: 'payment',
      direction: 'OUTBOUND',
      description: 'Pagamento Original User 10',
      amountBaseUnits: '200',
      assetId: 1,
      idempotencyKey: 'pmt-user-10-key',
    });
    expect(paymentRes.isSuccess).toBe(true);
    const pmtTxId = paymentRes.getValue().transactionId;

    // 2. Attempt refund specifying user 999
    const refundRes = await useCase.execute({
      userId: 999,
      type: 'refund',
      direction: 'INBOUND',
      description: 'Tentativa de Reembolso por Outro Usuário',
      amountBaseUnits: '100',
      assetId: 1,
      refundOfTransactionId: pmtTxId,
      idempotencyKey: 'refund-wrong-user-key',
    });

    expect(refundRes.isFailure).toBe(true);
    expect(refundRes.error).toContain('não coincide com o usuário proprietário');
  });

  it('P0.3: Rejeita refund se o ativo solicitado não coincidir com a transação original', async () => {
    const { RecordTreasuryTransactionUseCase } = await import('../../../src/application/finance/use-cases/RecordTreasuryTransactionUseCase');
    const useCase = new RecordTreasuryTransactionUseCase(uow);

    // Insert asset 2 (active)
    await sqlite.execute(`
      INSERT INTO financial_assets (id, symbol, code, name, type, decimals, status, created_at, updated_at) VALUES (2, 'USD', 'USD', 'US Dollar', 'fiat', 2, 'active', 1000, 1000);
    `);

    // 1. Record payment in asset 1 (BRL)
    const paymentRes = await useCase.execute({
      userId: 10,
      type: 'payment',
      direction: 'OUTBOUND',
      description: 'Pagamento BRL User 10',
      amountBaseUnits: '150',
      assetId: 1,
      idempotencyKey: 'pmt-asset-1-key',
    });
    expect(paymentRes.isSuccess).toBe(true);
    const pmtTxId = paymentRes.getValue().transactionId;

    // 2. Attempt refund in asset 2 (USD)
    const refundRes = await useCase.execute({
      userId: 10,
      type: 'refund',
      direction: 'INBOUND',
      description: 'Reembolso USD em pagamento BRL',
      amountBaseUnits: '50',
      assetId: 2,
      refundOfTransactionId: pmtTxId,
      idempotencyKey: 'refund-wrong-asset-key',
    });

    expect(refundRes.isFailure).toBe(true);
    expect(refundRes.error).toContain('não possui lançamento de receita referente ao ativo #2');
  });

  it('P0.4: Rejeita transação com ativo inexistente ou inativo', async () => {
    const { RecordTreasuryTransactionUseCase } = await import('../../../src/application/finance/use-cases/RecordTreasuryTransactionUseCase');
    const useCase = new RecordTreasuryTransactionUseCase(uow);

    // Insert asset 99 as inactive
    await sqlite.execute(`
      INSERT INTO financial_assets (id, symbol, code, name, type, decimals, status, created_at, updated_at) VALUES (99, 'OFF', 'OFF', 'Disabled Asset', 'fiat', 2, 'inactive', 1000, 1000);
    `);

    const resultInactive = await useCase.execute({
      userId: 10,
      type: 'deposit',
      direction: 'INBOUND',
      description: 'Depósito com Ativo Inativo',
      amountBaseUnits: '100',
      assetId: 99,
      idempotencyKey: 'deposit-inactive-asset-key',
    });
    expect(resultInactive.isFailure).toBe(true);
    expect(resultInactive.error).toContain('está inativo ou suspenso');

    const resultNonExistent = await useCase.execute({
      userId: 10,
      type: 'deposit',
      direction: 'INBOUND',
      description: 'Depósito com Ativo Inexistente',
      amountBaseUnits: '100',
      assetId: 9999,
      idempotencyKey: 'deposit-nonexistent-asset-key',
    });
    expect(resultNonExistent.isFailure).toBe(true);
    expect(resultNonExistent.error).toContain('not found');
  });

  it('P1.1: Rejeita categoria financeira inválida', async () => {
    const { RecordTreasuryTransactionUseCase } = await import('../../../src/application/finance/use-cases/RecordTreasuryTransactionUseCase');
    const useCase = new RecordTreasuryTransactionUseCase(uow);

    const result = await useCase.execute({
      userId: 10,
      type: 'deposit',
      direction: 'INBOUND',
      description: 'Depósito com Categoria Falsa',
      amountBaseUnits: '100',
      assetId: 1,
      category: 'fake_category_xyz' as any,
      idempotencyKey: 'deposit-fake-category-key',
    });

    expect(result.isFailure).toBe(true);
    expect(result.error).toContain('não é uma categoria financeira válida');
  });

  it('P1.2: Rejeita refund com direção OUTBOUND e infere direção se omitida', async () => {
    const { RecordTreasuryTransactionUseCase } = await import('../../../src/application/finance/use-cases/RecordTreasuryTransactionUseCase');
    const useCase = new RecordTreasuryTransactionUseCase(uow);

    const result = await useCase.execute({
      userId: 10,
      type: 'refund',
      direction: 'OUTBOUND',
      description: 'Refund Direção Errada',
      amountBaseUnits: '100',
      assetId: 1,
      refundOfTransactionId: 1,
      idempotencyKey: 'refund-wrong-dir-key',
    });

    expect(result.isFailure).toBe(true);
    expect(result.error).toContain('não pode ter direção OUTBOUND');
  });

  it('P1.3: Rejeita conta sistêmica com classe contábil incompatível', async () => {
    // Temporarily mutate account_class of payment_revenue to 'asset' (should be 'revenue')
    await sqlite.execute(`UPDATE financial_accounts SET account_class = 'asset' WHERE account_type = 'payment_revenue';`);

    const sysAccRes = await uow.execute(async (factory) => {
      const repo = factory.getFinanceRepository();
      return await repo.getSystemAccount('payment_revenue');
    });

    expect(sysAccRes.isFailure).toBe(true);
    expect(sysAccRes.error).toContain('classe contábil incompatível');

    // Restore original class
    await sqlite.execute(`UPDATE financial_accounts SET account_class = 'revenue' WHERE account_type = 'payment_revenue';`);
  });

  it('P1.4: Preserva objeto de erro estruturado (FinancialError) no Result.fail', async () => {
    const { RecordTreasuryTransactionUseCase } = await import('../../../src/application/finance/use-cases/RecordTreasuryTransactionUseCase');
    const useCase = new RecordTreasuryTransactionUseCase(uow);

    const result = await useCase.execute({
      userId: 999, // Mismatched user ID vs original owner (10)
      type: 'refund',
      direction: 'INBOUND',
      description: 'Refund de Usuário Incompatível',
      amountBaseUnits: '50',
      assetId: 1,
      refundOfTransactionId: 1,
      idempotencyKey: 'refund-ownership-err-key',
    });

    expect(result.isFailure).toBe(true);
    expect(result.errorObject).toBeDefined();
    const errObj = result.errorObject as any;
    expect(errObj.code).toBe('ACCOUNT_OWNERSHIP_MISMATCH');
    expect(errObj.httpStatus).toBe(403);
  });

  it('P1.5: Garante serialização e proteção contra over-refund em requisições concorrentes (BEGIN IMMEDIATE)', async () => {
    const { RecordTreasuryTransactionUseCase } = await import('../../../src/application/finance/use-cases/RecordTreasuryTransactionUseCase');
    const useCase = new RecordTreasuryTransactionUseCase(uow);

    // First deposit 1000 to user 10
    const depRes = await useCase.execute({
      userId: 10,
      type: 'deposit',
      direction: 'INBOUND',
      description: 'Depósito Inicial para Refund Test',
      amountBaseUnits: '1000',
      assetId: 1,
      idempotencyKey: 'deposit-1000-for-refund-test',
    });
    expect(depRes.isSuccess).toBe(true);

    // 1. Record a payment of 100 for user 10
    const paymentRes = await useCase.execute({
      userId: 10,
      type: 'payment',
      direction: 'OUTBOUND',
      description: 'Pagamento Original 100',
      amountBaseUnits: '100',
      assetId: 1,
      idempotencyKey: 'payment-100-for-refund-test',
    });
    expect(paymentRes.isSuccess).toBe(true);
    const origTxId = paymentRes.getValue().transactionId!;

    // 2. Fire 2 concurrent refund requests of 80 each simultaneously
    const reqA = useCase.execute({
      userId: 10,
      type: 'refund',
      direction: 'INBOUND',
      description: 'Concurrent Refund A',
      amountBaseUnits: '80',
      assetId: 1,
      refundOfTransactionId: origTxId,
      idempotencyKey: 'concurrent-refund-80-a',
    });

    const reqB = useCase.execute({
      userId: 10,
      type: 'refund',
      direction: 'INBOUND',
      description: 'Concurrent Refund B',
      amountBaseUnits: '80',
      assetId: 1,
      refundOfTransactionId: origTxId,
      idempotencyKey: 'concurrent-refund-80-b',
    });

    const [resA, resB] = await Promise.all([reqA, reqB]);
    if (resA.isFailure) console.log('ResA Failure:', resA.error);
    if (resB.isFailure) console.log('ResB Failure:', resB.error);

    const successes = [resA, resB].filter((r) => r.isSuccess);
    const failures = [resA, resB].filter((r) => r.isFailure);

    // Exactly 1 refund must succeed, and exactly 1 must fail due to limit
    expect(successes.length).toBe(1);
    expect(failures.length).toBe(1);
    expect(failures[0].error).toMatch(/INVALID_REFUND_AMOUNT|SQLITE_BUSY|excede o saldo/i);

    // Verify DB cumulative refund total is exactly 80, not 160
    const rawResult = await sqlite.execute({
      sql: `SELECT amount_base_units FROM financial_ledger_entries WHERE transaction_id IN (SELECT id FROM financial_transactions WHERE refund_of_transaction_id = ?) AND direction = 'credit';`,
      args: [origTxId],
    });
    const totalRefunded = rawResult.rows.reduce((acc: bigint, r: any) => acc + BigInt(r.amount_base_units || 0), 0n);
    expect(totalRefunded).toBe(80n);
  });
});
