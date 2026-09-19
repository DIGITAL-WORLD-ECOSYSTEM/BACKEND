import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { unlinkSync, existsSync } from 'fs';
import { runAllMigrationsLibSql } from '../test_helpers/runMigrations';
import { DrizzleUnitOfWork } from '../../src/infrastructure/repositories/DrizzleUnitOfWork';
import { DrizzleFinanceRepository } from '../../src/infrastructure/repositories/DrizzleFinanceRepository';
import { GetTreasuryBalanceUseCase } from '../../src/application/finance/use-cases/GetTreasuryBalanceUseCase';
import { RecordTreasuryTransactionUseCase } from '../../src/application/finance/use-cases/RecordTreasuryTransactionUseCase';
import { RecordTransferUseCase } from '../../src/application/finance/use-cases/RecordTransferUseCase';
import { FinanceController } from '../../src/interfaces/http/controllers/finance/FinanceController';
import { FinancialTransactionStateMachine } from '../../src/domains/finance/services/FinancialTransactionStateMachine';
import { InsufficientBalanceError, FinancialError } from '../../src/domains/finance/errors/FinancialError';
import { Result } from '../../src/shared/kernel/Result';
import { Hono } from 'hono';
import { financialAccounts, outboxEvents, accountBalances } from '../../src/db/schema';
import { eq } from 'drizzle-orm';

describe('Fase 4: Certificação e Hardening Definitivo (P0-A a P0-D, P1-A a P1-F)', () => {
  const dbFile = 'test_phase4_hardening.db';
  let sqlite: any;
  let db: any;
  let uow: DrizzleUnitOfWork;
  let financeRepo: DrizzleFinanceRepository;
  let getBalanceUseCase: GetTreasuryBalanceUseCase;
  let recordTxUseCase: RecordTreasuryTransactionUseCase;
  let recordTransferUseCase: RecordTransferUseCase;
  let controller: FinanceController;

  beforeAll(async () => {
    if (existsSync(dbFile)) {
      try { unlinkSync(dbFile); } catch (e) {}
    }

    sqlite = createClient({ url: `file:${dbFile}` });
    db = drizzle(sqlite);

    // Run all migrations including new 0011
    await runAllMigrationsLibSql(sqlite);

    // Setup initial test data
    await sqlite.executeMultiple(`
      INSERT INTO users (id, email, email_normalized, status, created_at, updated_at) VALUES 
        (1, 'alice@test.com', 'alice@test.com', 'active', 1000, 1000),
        (2, 'bob@test.com', 'bob@test.com', 'active', 1000, 1000),
        (3, 'charlie@test.com', 'charlie@test.com', 'active', 1000, 1000);

      INSERT INTO financial_assets (id, symbol, code, name, type, decimals, status, created_at, updated_at) VALUES 
        (1, 'BRL', 'BRL', 'Real Brasileiro', 'fiat', 2, 'active', 1000, 1000);
    `);

    // Create transactional UoW helper for libSQL
    const uowDb = {
      ...db,
      transaction: async (cb: any, opts?: any) => {
        const t = await sqlite.transaction('write');
        const proxyDb = drizzle(t) as any;
        proxyDb.rollback = () => { throw new Error('drizzle-rollback'); };
        try {
          const res = await cb(proxyDb);
          await t.commit();
          return res;
        } catch (err: any) {
          try { await t.rollback(); } catch (e) {}
          if (err.message === 'drizzle-rollback' || err.message === 'ROLLBACK_TRIGGERED_BY_RESULT_FAIL') throw err;
          throw err;
        }
      }
    };

    uow = new DrizzleUnitOfWork(uowDb);
    financeRepo = new DrizzleFinanceRepository(db);
    getBalanceUseCase = new GetTreasuryBalanceUseCase(uow);
    recordTxUseCase = new RecordTreasuryTransactionUseCase(uow);
    recordTransferUseCase = new RecordTransferUseCase(uow);
    controller = new FinanceController(getBalanceUseCase, recordTxUseCase, financeRepo, recordTransferUseCase);
  }, 40000);

  afterAll(() => {
    sqlite?.close();
    try {
      if (existsSync(dbFile)) unlinkSync(dbFile);
    } catch (e) {}
  });

  it('P0-A: DrizzleUnitOfWork deve rejeitar execuções sob driver D1 direto com erro arquitetural descritivo', async () => {
    const mockD1Db: any = {
      session: {
        client: {
          batch: () => {},
        },
        constructor: { name: 'DrizzleD1Session' }
      }
    };

    const d1Uow = new DrizzleUnitOfWork(mockD1Db);
    await expect(d1Uow.execute(async () => Result.ok(1))).rejects.toThrow(
      /DrizzleUnitOfWork exige driver com transações interativas/
    );
  });

  it('P0-B: Autorização fail-closed — operações privilegiadas devem ser bloqueadas para não-administradores', async () => {
    // 1. Usuário comum (sem admin) tentando executar 'reward' na rota genérica
    const unauthContext: any = {
      req: {
        json: async () => ({
          type: 'reward',
          direction: 'INBOUND',
          amountBaseUnits: '1000',
          assetId: 1,
          idempotencyKey: 'test-reward-unauth-001',
          targetUserId: 2,
        }),
        header: () => undefined,
      },
      get: (key: string) => {
        if (key === 'userId') return 2;
        if (key === 'permissions') return ['finance.transaction.create'];
        return undefined;
      },
      json: (data: any, status: number) => ({ status, data }),
    };

    const resReward = await controller.recordTransactionWithType(unauthContext);
    expect(resReward.status).toBe(403);
    expect(resReward.data.message).toContain('restrita a administradores');

    // 2. Usuário comum tentando depositar na conta de terceiro
    const depositThirdPartyContext: any = {
      req: {
        json: async () => ({
          type: 'deposit',
          direction: 'INBOUND',
          amountBaseUnits: '1000',
          assetId: 1,
          idempotencyKey: 'test-deposit-thirdparty-001',
          targetUserId: 1, // Alice (diferente do ator Bob)
        }),
        header: () => undefined,
      },
      get: (key: string) => {
        if (key === 'userId') return 2; // Bob
        if (key === 'permissions') return ['finance.deposit.create'];
        return undefined;
      },
      json: (data: any, status: number) => ({ status, data }),
    };

    const resDepositThirdParty = await controller.recordTransactionWithType(depositThirdPartyContext, 'deposit');
    expect(resDepositThirdParty.status).toBe(403);
    expect(resDepositThirdParty.data.message).toContain('Você não tem autorização para movimentar contas de terceiros');
  });

  it('P0-C: Migration 0011 — índice singleton uq_treasury_active_singleton e deduplicação forense', async () => {
    // Verifica que a tesouraria ativa é singleton e ordenada por ID
    const treasuryRes = await financeRepo.getTreasuryAccount();
    // Provisiona infraestrutura inicial se não existir
    if (treasuryRes.isFailure) {
      await uow.execute(async (factory) => {
        const repo = factory.getFinanceRepository();
        return repo.provisionTreasuryInfrastructure({
          defaultAssetCode: 'BRL',
          defaultAssetSymbol: 'R$',
          defaultAssetName: 'Real Brasileiro',
          defaultAssetDecimals: 2,
          initialTreasuryBalanceBaseUnits: '1000000',
        });
      });
    }

    const treasuryAfter = await financeRepo.getTreasuryAccount();
    expect(treasuryAfter.isSuccess).toBe(true);
    expect(treasuryAfter.getValue().accountType).toBe('treasury');
    expect(treasuryAfter.getValue().status).toBe('active');

    // Tentar criar uma SEGUNDA conta de tesouraria ativa diretamente no banco deve falhar pelo índice único uq_treasury_active_singleton
    await expect(
      sqlite.execute(`
        INSERT INTO financial_accounts (account_type, account_class, status, name, version, created_at, updated_at)
        VALUES ('treasury', 'asset', 'active', 'Tesouraria Duplicada Invalida', 1, 1000, 1000);
      `)
    ).rejects.toThrow(/UNIQUE constraint failed|uq_treasury_active_singleton/);
  });

  it('P0-D: Rota /transfers deve executar RecordTransferUseCase (transferência entre usuários P2P)', async () => {
    // 1. Cria saldo para Alice (user 1) via depósito
    const depositRes = await recordTxUseCase.execute({
      userId: 1,
      actorUserId: 1,
      type: 'deposit',
      direction: 'INBOUND',
      amountBaseUnits: '50000',
      assetId: 1,
      description: 'Depósito para Alice',
      idempotencyKey: 'alice-deposit-p0d',
    });
    expect(depositRes.isSuccess).toBe(true);

    // 2. Executa transferência de Alice (user 1) para Bob (user 2) via controller.recordTransfer()
    const transferContext: any = {
      req: {
        json: async () => ({
          destinationUserId: 2,
          amountBaseUnits: '20000',
          assetId: 1,
          description: 'Transferência de Alice para Bob',
          idempotencyKey: 'transfer-alice-bob-001',
        }),
        header: (name: string) => {
          if (name.toLowerCase() === 'idempotency-key') return 'transfer-alice-bob-001';
          return undefined;
        },
      },
      get: (key: string) => {
        if (key === 'userId') return 1; // Alice
        return undefined;
      },
      header: () => {},
      json: (data: any, status: number) => ({ status, data }),
    };

    const resTransfer = await controller.recordTransfer(transferContext);
    expect(resTransfer.status).toBe(201);
    expect(resTransfer.data.success).toBe(true);
    expect(resTransfer.data.data.transactionId).toBeDefined();
    expect(resTransfer.data.data.isReplayed).toBe(false);

    // 3. Verifica saldos pós-transferência
    const aliceAccRes = await financeRepo.getOrCreateUserAccount(1);
    const bobAccRes = await financeRepo.getOrCreateUserAccount(2);
    expect(aliceAccRes.isSuccess).toBe(true);
    expect(bobAccRes.isSuccess).toBe(true);

    const [aliceBal] = await db.select().from(accountBalances).where(eq(accountBalances.accountId, aliceAccRes.getValue().id));
    const [bobBal] = await db.select().from(accountBalances).where(eq(accountBalances.accountId, bobAccRes.getValue().id));

    expect(aliceBal.availableBaseUnits).toBe('30000');
    expect(bobBal.availableBaseUnits).toBe('20000');
  });

  it('P1-A: Exceções tipadas (FinancialError) devem ser preservadas sem conversão para string', async () => {
    // Tentativa de transferência com saldo insuficiente (Alice tenta transferir 999999)
    const transferContextOverdraft: any = {
      req: {
        json: async () => ({
          destinationUserId: 2,
          amountBaseUnits: '99999999',
          assetId: 1,
          description: 'Transferência acima do saldo',
          idempotencyKey: 'transfer-overdraft-001',
        }),
        header: (name: string) => {
          if (name.toLowerCase() === 'idempotency-key') return 'transfer-overdraft-001';
          return undefined;
        },
      },
      get: (key: string) => (key === 'userId' ? 1 : undefined),
      header: () => {},
      json: (data: any, status: number) => ({ status, data }),
    };

    const res = await controller.recordTransfer(transferContextOverdraft);
    expect(res.status).toBe(400); // Controller mapeia erro de saldo
    expect(res.data.success).toBe(false);
    expect(res.data.message).toMatch(/saldo insuficiente/i);
  });

  it('P1-B: Replay de idempotência determinístico deve retornar 200 OK mesmo após conta ficar inativa', async () => {
    // 1. Cria transação legítima
    const origRes = await recordTxUseCase.execute({
      userId: 1,
      actorUserId: 1,
      type: 'deposit',
      direction: 'INBOUND',
      amountBaseUnits: '1000',
      assetId: 1,
      description: 'Depósito para teste de replay',
      idempotencyKey: 'replay-test-key-001',
    });
    expect(origRes.isSuccess).toBe(true);
    const origTxId = origRes.getValue().transactionId;

    // 2. Suspende a conta de Alice (simulando alteração posterior de estado)
    const aliceAcc = (await financeRepo.getOrCreateUserAccount(1)).getValue();
    await sqlite.execute({
      sql: "UPDATE financial_accounts SET status = 'suspended' WHERE id = ?",
      args: [aliceAcc.id],
    });

    // 3. Replay da mesma requisição com a mesma chave e payload
    const replayRes = await recordTxUseCase.execute({
      userId: 1,
      actorUserId: 1,
      type: 'deposit',
      direction: 'INBOUND',
      amountBaseUnits: '1000',
      assetId: 1,
      description: 'Depósito para teste de replay',
      idempotencyKey: 'replay-test-key-001',
    });

    // Deve retornar sucesso e isReplayed = true sem falhar na verificação de conta ativa!
    expect(replayRes.isSuccess).toBe(true);
    expect(replayRes.getValue().transactionId).toBe(origTxId);
    expect(replayRes.getValue().isReplayed).toBe(true);

    // Restaura conta para os próximos testes
    await sqlite.execute({
      sql: "UPDATE financial_accounts SET status = 'active' WHERE id = ?",
      args: [aliceAcc.id],
    });
  });

  it('P1-B (Refund): Replay de refund integral deve retornar 200 OK e não estourar limite acumulado', async () => {
    // 1. Cria pagamento de 500
    const payRes = await recordTxUseCase.execute({
      userId: 1,
      actorUserId: 1,
      type: 'payment',
      direction: 'OUTBOUND',
      amountBaseUnits: '500',
      assetId: 1,
      description: 'Pagamento original para refund',
      idempotencyKey: 'pay-for-full-refund',
    });
    expect(payRes.isSuccess).toBe(true);
    const paymentTxId = payRes.getValue().transactionId;

    // 2. Reembolso integral de 500
    const refundRes1 = await recordTxUseCase.execute({
      userId: 1,
      actorUserId: 1,
      type: 'refund',
      direction: 'INBOUND',
      amountBaseUnits: '500',
      assetId: 1,
      description: 'Refund integral',
      idempotencyKey: 'refund-full-key-001',
      refundOfTransactionId: paymentTxId,
    });
    expect(refundRes1.isSuccess).toBe(true);
    expect(refundRes1.getValue().isReplayed).toBe(false);

    // 3. Replay do reembolso integral com a mesma chave
    const refundReplay = await recordTxUseCase.execute({
      userId: 1,
      actorUserId: 1,
      type: 'refund',
      direction: 'INBOUND',
      amountBaseUnits: '500',
      assetId: 1,
      description: 'Refund integral',
      idempotencyKey: 'refund-full-key-001',
      refundOfTransactionId: paymentTxId,
    });

    // Não deve lançar InvalidRefundAmountError! Deve retornar replay com sucesso!
    expect(refundReplay.isSuccess).toBe(true);
    expect(refundReplay.getValue().isReplayed).toBe(true);
    expect(refundReplay.getValue().transactionId).toBe(refundRes1.getValue().transactionId);
  });

  it('P1-C: Eventos de Outbox devem registrar eventName tipado (LedgerTransactionPosted.v1)', async () => {
    const rows = await db
      .select({
        eventName: outboxEvents.eventName,
        aggregateType: outboxEvents.aggregateType,
      })
      .from(outboxEvents)
      .where(eq(outboxEvents.aggregateType, 'LedgerTransaction'))
      .limit(5);

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.eventName).toBe('LedgerTransactionPosted.v1');
      expect(row.eventName).not.toBe('Object');
    }
  });

  it('P1-F: FinancialTransactionStateMachine.isTerminal deve reconhecer "refunded" como terminal', () => {
    expect(FinancialTransactionStateMachine.isTerminal('failed')).toBe(true);
    expect(FinancialTransactionStateMachine.isTerminal('cancelled')).toBe(true);
    expect(FinancialTransactionStateMachine.isTerminal('reversed')).toBe(true);
    expect(FinancialTransactionStateMachine.isTerminal('refunded')).toBe(true);
    expect(FinancialTransactionStateMachine.isTerminal('pending')).toBe(false);
    expect(FinancialTransactionStateMachine.isTerminal('processing')).toBe(false);
    expect(FinancialTransactionStateMachine.isTerminal('completed')).toBe(false);
  });

  it('P1-F (Listagem): listTransactions deve suportar paginação determinística e proteger contra vazamento global', async () => {
    // 1. Listagem para usuário comum com paginação por cursor
    const listRes = await financeRepo.listTransactions(1, { limit: 2 });
    expect(listRes.isSuccess).toBe(true);
    const txs = listRes.getValue();
    expect(txs.length).toBeLessThanOrEqual(2);

    // 2. Controller sem usuário autenticado e sem admin deve falhar 401
    const unauthListCtx: any = {
      get: () => undefined,
      req: {
        query: () => undefined,
        header: () => undefined,
      },
      json: (data: any, status: number) => ({ status, data }),
    };

    const resUnauth = await controller.listTransactions(unauthListCtx);
    expect(resUnauth.status).toBe(401);
  });
});
