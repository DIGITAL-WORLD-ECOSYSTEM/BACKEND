import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { unlinkSync, existsSync } from 'fs';
import { eq, and } from 'drizzle-orm';

import { DrizzleUnitOfWork } from '../../src/infrastructure/repositories/DrizzleUnitOfWork';
import { DrizzleFinanceRepository } from '../../src/infrastructure/repositories/DrizzleFinanceRepository';
import { ReverseTransactionUseCase } from '../../src/application/finance/use-cases/ReverseTransactionUseCase';
import { RecordTreasuryTransactionUseCase } from '../../src/application/finance/use-cases/RecordTreasuryTransactionUseCase';
import { FinanceController } from '../../src/interfaces/http/controllers/finance/FinanceController';
import { LedgerTransaction, LedgerEntry } from '../../src/domains/finance/entities/LedgerTransaction';
import { Money256 } from '../../src/domains/finance/value-objects/Money256';
import { AccountingEntryPolicy } from '../../src/domains/finance/policies/AccountingEntryPolicy';
import { AccountClassPolicy } from '../../src/domains/finance/policies/AccountClassPolicy';
import { FinancialTransactionStateMachine } from '../../src/domains/finance/services/FinancialTransactionStateMachine';
import { FinancialTransactionOrchestrator } from '../../src/application/finance/services/FinancialTransactionOrchestrator';
import { financialTransactions, accountBalances } from '../../src/db/finance/tables';
import { runAllMigrationsLibSql } from '../test_helpers/runMigrations';
import { Result } from '../../src/shared/kernel/Result';

describe('Fase 3B: Certificação de Hardening dos Gaps de Auditoria (F1, F2/F3, F4, F5, F6, F8)', () => {
  let sqlite: any;
  let db: any;
  let uow: DrizzleUnitOfWork;
  let repo: DrizzleFinanceRepository;
  let reverseUseCase: ReverseTransactionUseCase;
  let treasuryUseCase: RecordTreasuryTransactionUseCase;
  const dbFile = 'test_audit_gaps_hardening.db';

  beforeAll(async () => {
    if (existsSync(dbFile)) {
      try { unlinkSync(dbFile); } catch (e) {}
    }

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
          const res = await cb(proxyDb);
          await t.commit();
          return res;
        } catch (err: any) {
          try { await t.rollback(); } catch (e) {}
          if (err.message === 'DRIZZLE_ROLLBACK') return;
          throw err;
        }
      }
    };

    await runAllMigrationsLibSql(sqlite);

    // Setup base de usuários e contas
    await sqlite.executeMultiple(`
      INSERT INTO users (id, email, email_normalized, status, created_at, updated_at) VALUES (10, 'user10@test.com', 'user10@test.com', 'active', 1000, 1000);
      INSERT INTO users (id, email, email_normalized, status, created_at, updated_at) VALUES (20, 'admin20@test.com', 'admin20@test.com', 'active', 1000, 1000);

      INSERT INTO financial_assets (id, symbol, code, name, type, decimals, status, created_at, updated_at) VALUES (1, 'BRL', 'BRL', 'Brazilian Real', 'fiat', 2, 'active', 1000, 1000);
      INSERT INTO financial_assets (id, symbol, code, name, type, decimals, status, created_at, updated_at) VALUES (2, 'USD', 'USD', 'US Dollar', 'fiat', 2, 'active', 1000, 1000);

      -- System accounts
      INSERT INTO financial_accounts (id, user_id, account_type, account_class, status, name, version, created_at, updated_at) VALUES (1, NULL, 'treasury', 'asset', 'active', 'Treasury BRL', 1, 1000, 1000);
      INSERT INTO financial_accounts (id, user_id, account_type, account_class, status, name, version, created_at, updated_at) VALUES (2, NULL, 'payment_revenue', 'revenue', 'active', 'Payment Revenue', 1, 1000, 1000);
      INSERT INTO financial_accounts (id, user_id, account_type, account_class, status, name, version, created_at, updated_at) VALUES (3, NULL, 'refund_expense', 'expense', 'active', 'Refund Expense', 1, 1000, 1000);

      -- User 10 accounts
      INSERT INTO financial_accounts (id, user_id, account_type, account_class, status, name, version, created_at, updated_at) VALUES (10, 10, 'user_available', 'liability', 'active', 'User 10 Account', 1, 1000, 1000);

      -- Balances
      INSERT INTO account_balances (account_id, asset_id, available_base_units, locked_base_units, version, updated_at) VALUES (1, 1, '1000000', '0', 1, 1000);
      INSERT INTO account_balances (account_id, asset_id, available_base_units, locked_base_units, version, updated_at) VALUES (1, 2, '1000000', '0', 1, 1000);
      INSERT INTO account_balances (account_id, asset_id, available_base_units, locked_base_units, version, updated_at) VALUES (2, 1, '0', '0', 1, 1000);
      INSERT INTO account_balances (account_id, asset_id, available_base_units, locked_base_units, version, updated_at) VALUES (2, 2, '0', '0', 1, 1000);
      INSERT INTO account_balances (account_id, asset_id, available_base_units, locked_base_units, version, updated_at) VALUES (3, 1, '0', '0', 1, 1000);
      INSERT INTO account_balances (account_id, asset_id, available_base_units, locked_base_units, version, updated_at) VALUES (3, 2, '0', '0', 1, 1000);
      INSERT INTO account_balances (account_id, asset_id, available_base_units, locked_base_units, version, updated_at) VALUES (10, 1, '5000', '0', 1, 1000);
      INSERT INTO account_balances (account_id, asset_id, available_base_units, locked_base_units, version, updated_at) VALUES (10, 2, '5000', '0', 1, 1000);
    `);

    uow = new DrizzleUnitOfWork(uowDb);
    repo = new DrizzleFinanceRepository(db);
    reverseUseCase = new ReverseTransactionUseCase(uow);
    treasuryUseCase = new RecordTreasuryTransactionUseCase(uow);
  }, 30000);

  afterAll(() => {
    try { sqlite.close(); } catch (e) {}
    try { unlinkSync(dbFile); } catch (e) {}
  });

  it('F1 — Estorno deve ser rejeitado se a transação já sofreu reembolso para o ativo afetado', async () => {
    // 1. Cria transação de pagamento no ativo 1 (1000 unidades)
    const payRes = await treasuryUseCase.execute({
      type: 'payment',
      userId: 10,
      actorUserId: 10,
      assetId: 1,
      amountBaseUnits: '1000',
      description: 'Payment 1000 BRL',
      idempotencyKey: 'pay-brl-1000',
    });
    expect(payRes.isSuccess).toBe(true);
    const paymentTxId = payRes.getValue().transactionId!;

    // 2. Cria reembolso parcial de 300 unidades no ativo 1
    const refRes = await treasuryUseCase.execute({
      type: 'refund',
      userId: 10,
      actorUserId: 20,
      assetId: 1,
      amountBaseUnits: '300',
      description: 'Partial Refund 300 BRL',
      idempotencyKey: 'ref-brl-300',
      refundOfTransactionId: paymentTxId,
    });
    expect(refRes.isSuccess).toBe(true);

    // 3. Tenta estornar o pagamento original: DEVE SER REJEITADO (F1)
    const revRes = await reverseUseCase.execute({
      originalTransactionId: paymentTxId,
      actorUserId: 20,
      idempotencyKey: 'rev-brl-1000',
      reason: 'Tentativa de estorno indevido',
    });

    expect(revRes.isFailure).toBe(true);
    expect(revRes.error).toContain('já possui reembolso(s) associado(s) para o ativo #1');
    expect(revRes.error).toContain('300');

    // 4. Cria pagamento de 500 no ativo 2 (USD) SEM reembolso
    const payUsdRes = await treasuryUseCase.execute({
      type: 'payment',
      userId: 10,
      actorUserId: 10,
      assetId: 2,
      amountBaseUnits: '500',
      description: 'Payment 500 USD',
      idempotencyKey: 'pay-usd-500',
    });
    expect(payUsdRes.isSuccess).toBe(true);
    const payUsdTxId = payUsdRes.getValue().transactionId!;

    // 5. Estorno do pagamento USD (sem reembolso) DEVE TER SUCESSO
    const revUsdRes = await reverseUseCase.execute({
      originalTransactionId: payUsdTxId,
      actorUserId: 20,
      idempotencyKey: 'rev-usd-500',
      reason: 'Estorno legítimo sem reembolso prévio',
    });
    expect(revUsdRes.isSuccess).toBe(true);
  });

  it('F4 — Rollback deve garantir zero escrita física quando o callback retornar Result.fail', async () => {
    // Captura estado antes da execução
    const initialKeysCount = Number((await sqlite.execute('SELECT COUNT(*) as c FROM idempotency_keys')).rows[0].c);
    const initialTxsCount = Number((await sqlite.execute('SELECT COUNT(*) as c FROM financial_transactions')).rows[0].c);
    const initialEntriesCount = Number((await sqlite.execute('SELECT COUNT(*) as c FROM financial_ledger_entries')).rows[0].c);
    const initialAccountsCount = Number((await sqlite.execute('SELECT COUNT(*) as c FROM financial_accounts WHERE user_id = 99')).rows[0].c);
    expect(initialAccountsCount).toBe(0);

    // Executa UoW inserindo registros no banco via repo transacional mas retornando Result.fail no final
    const failResult = await uow.execute(async (factory) => {
      const txRepo = factory.getFinanceRepository();
      // Criar conta para o usuário 99 dentro da transação
      await txRepo.getOrCreateUserAccount(99);

      return Result.fail('BUSINESS_LOGIC_VALIDATION_FAILED');
    });

    expect(failResult.isFailure).toBe(true);
    expect(failResult.error).toBe('BUSINESS_LOGIC_VALIDATION_FAILED');

    // Asserção Crítica F4: Verifica fisicamente no SQLite que ZERO linhas foram persistidas
    const finalKeysCount = Number((await sqlite.execute('SELECT COUNT(*) as c FROM idempotency_keys')).rows[0].c);
    const finalTxsCount = Number((await sqlite.execute('SELECT COUNT(*) as c FROM financial_transactions')).rows[0].c);
    const finalEntriesCount = Number((await sqlite.execute('SELECT COUNT(*) as c FROM financial_ledger_entries')).rows[0].c);
    const finalAccountsCount = Number((await sqlite.execute('SELECT COUNT(*) as c FROM financial_accounts WHERE user_id = 99')).rows[0].c);

    expect(finalKeysCount).toBe(initialKeysCount);
    expect(finalTxsCount).toBe(initialTxsCount);
    expect(finalEntriesCount).toBe(initialEntriesCount);
    expect(finalAccountsCount).toBe(0);
  });

  it('F8 — Transição de estado inválida deve ser rejeitada pela State Machine e abortar sem mutar o banco', async () => {
    // 1. Cria uma transação diretamente e seta seu status como 'cancelled'
    const [txRow] = await db.insert(financialTransactions).values({
      type: 'deposit',
      status: 'cancelled',
      description: 'Cancelled TX',
      createdAt: new Date(),
      updatedAt: new Date(),
    }).returning();

    // 2. Tenta estornar uma transação 'cancelled': a State Machine deve proibir (cancelled -> reversed é inválido)
    const revRes = await reverseUseCase.execute({
      originalTransactionId: txRow.id,
      actorUserId: 20,
      idempotencyKey: 'rev-cancelled-attempt',
      reason: 'Tentativa de estorno de transação cancelada',
    });

    expect(revRes.isFailure).toBe(true);
    expect(revRes.error).toContain('Transição de estado inválida para estorno');

    // 3. Prova que o status no banco permaneceu 'cancelled' (zero mutação)
    const [afterTx] = await db.select().from(financialTransactions).where(eq(financialTransactions.id, txRow.id));
    expect(afterTx.status).toBe('cancelled');
  });

  it('F2 & F3 — Ajuste administrativo exige sessão autenticada e proíbe fallback de autorizador vindo do body', async () => {
    const controller = new FinanceController({} as any, treasuryUseCase, repo);

    // 1. Requisição de ajuste SEM sessão autenticada (actorUserId ausente) -> DEVE RETORNAR 401
    const unauthContext: any = {
      req: {
        param: () => 'adjustment',
        header: () => undefined,
        json: async () => ({
          type: 'adjustment',
          assetId: '1',
          amountBaseUnits: '100',
          direction: 'INBOUND',
          description: 'Adjustment without auth',
          idempotencyKey: 'adj-no-auth',
          authorizedByUserId: '20', // Tenta forjar autorizador no body
        }),
      },
      header: () => {},
      get: () => undefined,
      json: (data: any, status: number) => ({ status, data }),
    };

    const unauthResponse = await controller.recordTransactionWithType(unauthContext, 'adjustment');
    expect(unauthResponse.status).toBe(401);
    expect(unauthResponse.data.message).toContain('Operações de ajuste exigem sessão autenticada');

    // 2. Tentativa de auto-ajuste: actorUserId 20 tenta ajustar própria conta (targetUserId: 20) enviando authorizedByUserId: 99 no body
    // Como o controller deriva authorizedByUserId estritamente da sessão (20), o use case detecta FIN-007 (targetUserId === authorizedByUserId) e REJEITA.
    const selfAdjContext: any = {
      req: {
        param: () => 'adjustment',
        header: () => undefined,
        json: async () => ({
          type: 'adjustment',
          targetUserId: '20',
          assetId: '1',
          amountBaseUnits: '100',
          direction: 'INBOUND',
          description: 'Self-adjustment attempt with spoofed authorizer',
          idempotencyKey: 'adj-self-spoof',
          authorizedByUserId: '99', // Se fosse aceito, burlaria FIN-007
        }),
      },
      header: () => {},
      get: (key: string) => {
        if (key === 'userId') return 20;
        if (key === 'user') return { userId: 20, id: 20, permissions: ['finance.treasury.admin'] };
        if (key === 'permissions') return ['finance.treasury.admin'];
        return undefined;
      },
      json: (data: any, status: number) => ({ status, data }),
    };

    const selfAdjResponse = await controller.recordTransactionWithType(selfAdjContext, 'adjustment');
    expect(selfAdjResponse.status).toBe(400);
    expect(selfAdjResponse.data.message).toContain('Invariante FIN-007 violado');

    // 3. Requisição de ajuste legítimo COM sessão autenticada (actorUserId: 20, targetUserId: 10) e body tentando forjar autorizador 99
    const authContext: any = {
      req: {
        param: () => 'adjustment',
        header: () => undefined,
        json: async () => ({
          type: 'adjustment',
          targetUserId: '10',
          assetId: '1',
          amountBaseUnits: '100',
          direction: 'INBOUND',
          description: 'Adjustment with actor',
          idempotencyKey: 'adj-with-actor',
          authorizedByUserId: '99', // Deve ser IGNORADO
        }),
      },
      header: () => {},
      get: (key: string) => {
        if (key === 'userId') return 20;
        if (key === 'user') return { userId: 20, id: 20, permissions: ['finance.treasury.admin'] };
        if (key === 'permissions') return ['finance.treasury.admin'];
        return undefined;
      },
      json: (data: any, status: number) => ({ status, data }),
    };

    const authResponse = await controller.recordTransactionWithType(authContext, 'adjustment');
    expect(authResponse.status).toBe(201);
    expect(authResponse.data.success).toBe(true);

    const adjTxId = authResponse.data.data.transactionId;
    const txRes = await repo.getTransactionById(adjTxId);
    expect(txRes.isSuccess).toBe(true);
    expect(txRes.getValue().status).toBe('completed');
    expect(txRes.getValue().type).toBe('adjustment');
  });

  it('F5 — getSystemAccount deve falhar com comportamento fail-closed para tipo não configurado', async () => {
    const res = await repo.getSystemAccount('unknown_type' as any);
    expect(res.isFailure).toBe(true);
    expect(res.error).toContain('fail-closed');
  });

  it('F6 — AccountClassPolicy deve sanitizar caracteres de controle contra log injection', () => {
    // 1. Tenta passar \n e \r no accountType
    expect(() => {
      AccountClassPolicy.validate('treasury\nINJECTION\r', 'asset');
    }).toThrowError();

    try {
      AccountClassPolicy.validate('treasury\nINJECTION\r', 'asset');
    } catch (err: any) {
      expect(err.message).not.toContain('\n');
      expect(err.message).not.toContain('\r');
      expect(err.message).toContain('treasuryINJECTION');
    }

    // 2. Tenta passar \u0000 no accountClass
    expect(() => {
      AccountClassPolicy.validate('treasury', 'asset\u0000INJECTION');
    }).toThrowError();

    try {
      AccountClassPolicy.validate('treasury', 'asset\u0000INJECTION');
    } catch (err: any) {
      expect(err.message).not.toContain('\u0000');
      expect(err.message).toContain('assetINJECTION');
    }
  });
});
