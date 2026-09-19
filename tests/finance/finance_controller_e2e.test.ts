import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Hono } from 'hono';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { runAllMigrationsLibSql } from '../test_helpers/runMigrations';
import { FinanceBootstrapService } from '../../src/infrastructure/services/FinanceBootstrapService';
import { DrizzleUnitOfWork } from '../../src/infrastructure/repositories/DrizzleUnitOfWork';
import { DrizzleFinanceRepository } from '../../src/infrastructure/repositories/DrizzleFinanceRepository';
import { GetTreasuryBalanceUseCase } from '../../src/application/finance/use-cases/GetTreasuryBalanceUseCase';
import { RecordTreasuryTransactionUseCase } from '../../src/application/finance/use-cases/RecordTreasuryTransactionUseCase';
import { FinanceController } from '../../src/interfaces/http/controllers/finance/FinanceController';
import { unlinkSync, existsSync } from 'fs';

describe('FinanceController E2E — Contratos HTTP, Idempotência (201/200/409), Autorização e Erros Seguros', () => {
  const dbFile = 'test_finance_controller_e2e.db';
  let sqlite: any;
  let db: any;
  let assetId: number;
  let app: Hono;

  beforeAll(async () => {
    if (existsSync(dbFile)) {
      try { unlinkSync(dbFile); } catch (e) {}
    }
    sqlite = createClient({ url: `file:${dbFile}` });
    db = drizzle(sqlite);

    // 1. Executa todas as migrations até a 0010
    await runAllMigrationsLibSql(sqlite);

    // 2. Inserir usuários de teste
    await sqlite.execute(`
      INSERT INTO users (id, subject_type, email, email_normalized, status, auth_epoch, created_at, updated_at)
      VALUES 
        (1, 'human', 'user1@example.com', 'user1@example.com', 'active', 1, unixepoch(), unixepoch()),
        (2, 'human', 'user2@example.com', 'user2@example.com', 'active', 1, unixepoch(), unixepoch());
    `);

    // 3. Inicializar contas sistêmicas da tesouraria
    const bootstrapRes = await FinanceBootstrapService.seedSystemAccounts(db, {
      currencyCode: 'BRL',
      initialBalanceBaseUnits: 10000000n, // R$ 100.000,00
    });
    assetId = bootstrapRes.getValue().assetId;

    // 4. Montar aplicação Hono de teste integrando controller real
    const uow = new DrizzleUnitOfWork({
      ...db,
      transaction: async (cb: any) => {
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
      }
    });
    const financeRepo = new DrizzleFinanceRepository(db);
    const getBalanceUseCase = new GetTreasuryBalanceUseCase(uow);
    const recordTxUseCase = new RecordTreasuryTransactionUseCase(uow);
    const controller = new FinanceController(getBalanceUseCase, recordTxUseCase, financeRepo);

    app = new Hono();

    app.post('/deposits', async (c) => {
      return controller.recordDeposit(c);
    });

    app.post('/withdrawals', async (c) => {
      return controller.recordWithdrawal(c);
    });

    app.post('/payments', async (c) => {
      return controller.recordPayment(c);
    });

    app.post('/refunds', async (c) => {
      return controller.recordRefund(c);
    });

    app.post('/adjustments', async (c) => {
      return controller.recordAdjustment(c);
    });

    app.get('/treasury/balance', async (c) => {
      return controller.getBalance(c);
    });
  }, 40000);

  afterAll(() => {
    try {
      if (existsSync(dbFile)) unlinkSync(dbFile);
    } catch (e) {}
  });

  it('Cenário A: Nova operação legítima deve retornar HTTP 201 Created', async () => {
    const res = await app.request('/deposits', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'idempotency-key': 'http-deposit-001',
      },
      body: JSON.stringify({
        targetUserId: 1,
        direction: 'INBOUND',
        category: 'operational',
        description: 'Depósito Inicial via HTTP',
        amountBaseUnits: '5000',
        assetId,
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.transactionId).toBeDefined();
    expect(body.data.isReplayed).toBe(false);
    expect(res.headers.get('Idempotency-Replayed')).toBe('false');
  });

  it('Cenário B: Replay legítimo (mesma key + mesmo payload) deve retornar HTTP 200 OK com Idempotency-Replayed: true', async () => {
    const res = await app.request('/deposits', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'idempotency-key': 'http-deposit-001',
      },
      body: JSON.stringify({
        targetUserId: 1,
        direction: 'INBOUND',
        category: 'operational',
        description: 'Depósito Inicial via HTTP',
        amountBaseUnits: '5000',
        assetId,
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.isReplayed).toBe(true);
    expect(res.headers.get('Idempotency-Replayed')).toBe('true');
  });

  it('Cenário C: Conflito de idempotência (mesma key + payload divergente) deve retornar HTTP 409 Conflict', async () => {
    const res = await app.request('/deposits', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'idempotency-key': 'http-deposit-001', // Mesma chave
      },
      body: JSON.stringify({
        targetUserId: 1,
        direction: 'INBOUND',
        category: 'operational',
        description: 'Tentativa de adulteração de quantia',
        amountBaseUnits: '999999', // Quantia divergente
        assetId,
      }),
    });

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.message).toMatch(/409 Conflict|idempotência|Idempotency/i);
  });

  it('Cenário D: Erro de validação de payload (ex: quantia inválida) deve retornar HTTP 400 Bad Request', async () => {
    const res = await app.request('/deposits', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'idempotency-key': 'http-invalid-001',
      },
      body: JSON.stringify({
        targetUserId: 1,
        direction: 'INBOUND',
        amountBaseUnits: 'INVALID_AMOUNT', // Não numérico
        assetId,
      }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.message).toContain('amountBaseUnits');
  });

  it('Cenário E: Autorização real — usuário comum não pode sacar de conta de terceiro', async () => {
    const mockApp = new Hono();
    const uow = new DrizzleUnitOfWork({
      ...db,
      transaction: async (cb: any) => {
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
      }
    });
    const financeRepo = new DrizzleFinanceRepository(db);
    const getBalanceUseCase = new GetTreasuryBalanceUseCase(uow);
    const recordTxUseCase = new RecordTreasuryTransactionUseCase(uow);
    const controller = new FinanceController(getBalanceUseCase, recordTxUseCase, financeRepo);

    mockApp.post('/withdrawals', (c) => {
      // Simula sessão de usuário comum (userId = 2, sem permissão admin)
      c.set('userId', 2);
      c.set('permissions', ['finance.withdrawal.create']);
      return controller.recordWithdrawal(c);
    });

    // Usuário 2 tenta sacar fundos da conta do usuário 1
    const res = await mockApp.request('/withdrawals', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'idempotency-key': 'http-unauthorized-target-001',
      },
      body: JSON.stringify({
        targetUserId: 1, // Conta da vítima
        direction: 'OUTBOUND',
        category: 'withdrawal',
        description: 'Tentativa de saque em conta de terceiro',
        amountBaseUnits: '100',
        assetId,
      }),
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.message).toContain('Acesso negado: Você não tem autorização para movimentar contas de terceiros.');
  });

  it('Cenário F: Erro interno inesperado deve retornar 500 com mensagem pública genérica e requestId', async () => {
    const faultyUseCase = {
      execute: async () => {
        throw new Error('FATAL SQLITE ERROR: table internal_secrets corrupted at memory 0xDEADBEEF');
      }
    } as any;

    const safeController = new FinanceController({} as any, faultyUseCase, {} as any);
    const errApp = new Hono();
    errApp.post('/deposits', (c) => safeController.recordDeposit(c));

    const res = await errApp.request('/deposits', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'idempotency-key': 'http-err-001',
      },
      body: JSON.stringify({
        targetUserId: 1,
        direction: 'INBOUND',
        amountBaseUnits: '100',
        assetId,
      }),
    });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.message).toBe('Erro interno ao processar a operação financeira');
    expect(body.requestId).toBeDefined();
    // Garante que a mensagem técnica bruta NÃO vazou para o cliente
    expect(JSON.stringify(body)).not.toContain('0xDEADBEEF');
    expect(JSON.stringify(body)).not.toContain('internal_secrets');
  });
});
