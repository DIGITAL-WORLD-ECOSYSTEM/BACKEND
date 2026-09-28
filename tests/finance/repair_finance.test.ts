import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { unlinkSync } from 'fs';
import { eq, and } from 'drizzle-orm';

import { DrizzleUnitOfWork } from '../../src/infrastructure/repositories/DrizzleUnitOfWork';
import { RepairFinanceUseCase } from '../../src/application/finance/use-cases/RepairFinanceUseCase';
import { accountBalances, financialAccounts } from '../../src/db/finance/tables';
import { runAllMigrationsLibSql } from '../test_helpers/runMigrations';

describe('RepairFinanceUseCase — Segregação de Funções e Governança Forense (P0-2 / BUG-38-01)', () => {
  let sqlite: any;
  let db: any;
  let uow: DrizzleUnitOfWork;
  let repairUseCase: RepairFinanceUseCase;
  const dbFile = 'test_repair_finance.db';

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
          const res = await cb(proxyDb);
          await t.commit();
          return res;
        } catch (err: any) {
          try { await t.rollback(); } catch (e) {}
          if (err.message === 'DRIZZLE_ROLLBACK') return;
          throw err;
        }
      },
    };

    await runAllMigrationsLibSql(sqlite);

    // Setup base entities
    await sqlite.executeMultiple(`
      INSERT INTO users (id, email, email_normalized, status, created_at, updated_at) VALUES 
        (10, 'target@test.com', 'target@test.com', 'active', 1000, 1000),
        (20, 'operator@test.com', 'operator@test.com', 'active', 1000, 1000),
        (99, 'supervisor@test.com', 'supervisor@test.com', 'active', 1000, 1000);

      INSERT INTO financial_assets (id, symbol, code, name, type, decimals, status, created_at, updated_at) VALUES 
        (1, 'BRL', 'BRL', 'Brazilian Real', 'fiat', 2, 'active', 1000, 1000);

      -- Treasury account
      INSERT INTO financial_accounts (id, user_id, account_type, account_class, status, name, version, created_at, updated_at) VALUES 
        (1, NULL, 'treasury', 'asset', 'active', 'Treasury Operating Account', 1, 1000, 1000);

      -- Target user account
      INSERT INTO financial_accounts (id, user_id, account_type, account_class, status, name, version, created_at, updated_at) VALUES 
        (10, 10, 'user_available', 'liability', 'active', 'Target User Account', 1, 1000, 1000);

      INSERT INTO account_balances (account_id, asset_id, available_base_units, locked_base_units, version, updated_at) VALUES 
        (1, 1, '1000000', '0', 1, 1000),
        (10, 1, '5000', '0', 1, 1000);
    `);

    uow = new DrizzleUnitOfWork(uowDb);
    repairUseCase = new RepairFinanceUseCase(uow);
  }, 30000);

  afterAll(() => {
    try { unlinkSync(dbFile); } catch (e) {}
  });

  it('Happy Path: Executa reparo/ajuste com segregação de funções estrita (actor 20 !== authorizer 99) com sucesso', async () => {
    const res = await repairUseCase.execute({
      actorUserId: 20,
      authorizedByUserId: 99,
      targetUserId: 10,
      direction: 'INBOUND', // Credita a conta do usuário a partir da tesouraria
      amountBaseUnits: '1500',
      assetId: 1,
      reason: 'Saneamento pericial de divergência contábil no extrato bancário',
      idempotencyKey: 'repair-inbound-001',
    });

    expect(res.isSuccess).toBe(true);
    const value = res.getValue();
    expect(value.transactionId).toBeDefined();

    // Valida que o saldo da conta alvo aumentou em 1500 (5000 + 1500 = 6500)
    const [bTarget] = await db.select().from(accountBalances).where(
      and(eq(accountBalances.accountId, 10), eq(accountBalances.assetId, 1))
    );
    expect(bTarget.availableBaseUnits).toBe('6500');
  });

  it('Bloqueia autoaprovação: actorUserId === authorizedByUserId deve ser rejeitado', async () => {
    const res = await repairUseCase.execute({
      actorUserId: 20,
      authorizedByUserId: 20, // Autoaprovação proibida!
      targetUserId: 10,
      direction: 'INBOUND',
      amountBaseUnits: '500',
      assetId: 1,
      reason: 'Tentativa indevida de autoaprovação de reparo emergencial',
      idempotencyKey: 'repair-self-approve-001',
    });

    expect(res.isFailure).toBe(true);
    expect(res.error).toContain('Invariante de segregação de funções violado');
  });

  it('Bloqueia violação FIN-007: autorizador não pode ser o titular da conta alvo (authorizedByUserId === targetUserId)', async () => {
    const res = await repairUseCase.execute({
      actorUserId: 20,
      authorizedByUserId: 10, // Autorizador é o titular beneficiário
      targetUserId: 10,
      direction: 'INBOUND',
      amountBaseUnits: '500',
      assetId: 1,
      reason: 'Tentativa de aprovação pelo próprio titular da conta alvo',
      idempotencyKey: 'repair-target-is-auth-001',
    });

    expect(res.isFailure).toBe(true);
    expect(res.error).toContain('Invariante FIN-007 violado');
  });

  it('Bloqueia violação FIN-007: operador não pode ser o titular da conta alvo (actorUserId === targetUserId)', async () => {
    const res = await repairUseCase.execute({
      actorUserId: 10, // Operador tenta reparar sua própria conta
      authorizedByUserId: 99,
      targetUserId: 10,
      direction: 'INBOUND',
      amountBaseUnits: '500',
      assetId: 1,
      reason: 'Tentativa do operador de reparar sua própria conta bancária',
      idempotencyKey: 'repair-target-is-actor-001',
    });

    expect(res.isFailure).toBe(true);
    expect(res.error).toContain('Invariante FIN-007 violado');
  });

  it('Exige motivo auditável com no mínimo 10 caracteres', async () => {
    const res = await repairUseCase.execute({
      actorUserId: 20,
      authorizedByUserId: 99,
      targetUserId: 10,
      direction: 'INBOUND',
      amountBaseUnits: '500',
      assetId: 1,
      reason: 'ajuste', // Apenas 6 caracteres
      idempotencyKey: 'repair-short-reason-001',
    });

    expect(res.isFailure).toBe(true);
    expect(res.error).toContain('Motivo do reparo deve ter no mínimo 10 caracteres explicativos');
  });

  it('Exige identificação obrigatória de actorUserId e authorizedByUserId', async () => {
    const res = await repairUseCase.execute({
      actorUserId: 0,
      authorizedByUserId: 99,
      targetUserId: 10,
      direction: 'INBOUND',
      amountBaseUnits: '500',
      assetId: 1,
      reason: 'Reparo sem operador identificado formalmente no sistema',
      idempotencyKey: 'repair-no-actor-001',
    });

    expect(res.isFailure).toBe(true);
    expect(res.error).toContain('Identificação de actorUserId e authorizedByUserId é obrigatória');
  });
});
