import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { eq, sql } from 'drizzle-orm';
import { unlinkSync, existsSync } from 'fs';

import { DrizzleUnitOfWork } from '../../src/infrastructure/repositories/DrizzleUnitOfWork';
import { DrizzleFinanceRepository } from '../../src/infrastructure/repositories/DrizzleFinanceRepository';
import { D1AtomicPostingExecutor } from '../../src/infrastructure/services/D1AtomicPostingExecutor';
import { PostingAuthority } from '../../src/application/finance/services/PostingAuthority';
import { PostingPlanBuilder } from '../../src/domains/finance/services/PostingPlanBuilder';
import { PostingSession } from '../../domains/finance/contracts/PostingSession';
import { RecordTransferUseCase } from '../../src/application/finance/use-cases/RecordTransferUseCase';
import {
  financialAccounts,
  financialTransactions,
  financialLedgerEntries,
  accountBalances,
  financialAssets,
  systemAccountRoutes,
} from '../../src/db/finance/tables';
import { idempotencyKeys, outboxEvents } from '../../src/db/infrastructure/tables';
import { runAllMigrationsLibSql } from '../test_helpers/runMigrations';

describe('Fase 7: Certificação Adversarial do Finance Core (Gates 0 a 13)', () => {
  const dbFile = 'test_adversarial_certification.db';
  let sqlite: any;
  let db: any;
  let uow: DrizzleUnitOfWork;
  let financeRepo: DrizzleFinanceRepository;

  beforeAll(async () => {
    if (existsSync(dbFile)) {
      try { unlinkSync(dbFile); } catch (e) {}
    }

    sqlite = createClient({ url: `file:${dbFile}` });
    db = drizzle(sqlite);

    await runAllMigrationsLibSql(sqlite);

    // Setup base users and assets
    await sqlite.executeMultiple(`
      INSERT INTO users (id, email, email_normalized, status, created_at, updated_at) VALUES 
        (100, 'adversary_alice@test.com', 'adversary_alice@test.com', 'active', 1000, 1000),
        (200, 'adversary_bob@test.com', 'adversary_bob@test.com', 'active', 1000, 1000),
        (300, 'adversary_charlie@test.com', 'adversary_charlie@test.com', 'active', 1000, 1000);

      INSERT INTO financial_assets (id, symbol, code, name, type, decimals, status, created_at, updated_at) VALUES 
        (1, 'BRL', 'BRL', 'Real Brasileiro', 'fiat', 2, 'active', 1000, 1000);

      -- Fiat provider 10 for route tests
      INSERT INTO fiat_providers (id, code, name, type, status, created_at, updated_at) VALUES
        (10, 'PROVIDER_10', 'Mock Fiat Provider 10', 'bank', 'active', 1000, 1000);
    `);

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
          if (err.message === 'drizzle-rollback') return;
          throw err;
        }
      },
    };

    uow = new DrizzleUnitOfWork(uowDb);
    financeRepo = new DrizzleFinanceRepository(db);
  }, 40000);

  afterAll(() => {
    sqlite?.close();
    if (existsSync(dbFile)) {
      try { unlinkSync(dbFile); } catch (e) {}
    }
  });

  it('TEST-ASSERT-01: Prova física de falha se changes() != 1 via _sql_assertions', async () => {
    // 1. Tenta executar statement que afeta 0 linhas seguido da assertion
    const failurePromise = sqlite.executeMultiple(`
      UPDATE account_balances SET available_base_units = '999999' WHERE id = 999999;
      INSERT INTO _sql_assertions (id, guard)
      VALUES (1, (SELECT CASE WHEN changes() = 1 THEN 1 ELSE 0 END))
      ON CONFLICT(id) DO UPDATE SET guard = (SELECT CASE WHEN changes() = 1 THEN 1 ELSE 0 END);
    `);

    await expect(failurePromise).rejects.toThrow(/CHECK constraint failed: guard = 1/);
  });

  it('TEST-BOUNDARY-01: Bloqueio em runtime de qualquer chamada sem PostingSession válida', async () => {
    const executor = new D1AtomicPostingExecutor(db);
    const authority = new PostingAuthority(executor);

    const dummyPlan: any = {
      transactionId: 12345,
      scope: 'finance',
      idempotencyKey: 'test-boundary-key',
    };

    // Chamada com session ausente/nula
    const res = await authority.commit(dummyPlan, null as any);
    expect(res.isFailure).toBe(true);
    expect(res.error).toMatch(/PostingSession obrigatória/i);
  });

  it('TEST-ACCOUNT-01: Tentativa com conta inexistente falha no pré-gate com zero writes', async () => {
    const txCountBefore = (await db.select().from(financialTransactions)).length;
    const ledgerCountBefore = (await db.select().from(financialLedgerEntries)).length;
    const idemCountBefore = (await db.select().from(idempotencyKeys)).length;

    const useCase = new RecordTransferUseCase(uow);
    const result = await useCase.execute({
      sourceUserId: 100,
      destinationUserId: 999999, // Usuário sem conta e inexistente
      amountBaseUnits: '1000',
      assetId: 1,
      description: 'Transferência para conta inexistente',
      idempotencyKey: 'test-nonexistent-user-transfer',
    });

    expect(result.isFailure).toBe(true);

    const txCountAfter = (await db.select().from(financialTransactions)).length;
    const ledgerCountAfter = (await db.select().from(financialLedgerEntries)).length;
    const idemCountAfter = (await db.select().from(idempotencyKeys)).length;

    expect(txCountAfter).toBe(txCountBefore);
    expect(ledgerCountAfter).toBe(ledgerCountBefore);
    expect(idemCountAfter).toBe(idemCountBefore);
  });

  it('TEST-IDEMP-FAIL-01: INSUFFICIENT_BALANCE libera chave para retry futuro com sucesso', async () => {
    // 1. Cria contas e saldos iniciais para 100 e 200 (100 com saldo 0)
    const acc100 = await financeRepo.getOrCreateUserAccount(100);
    const acc200 = await financeRepo.getOrCreateUserAccount(200);
    expect(acc100.isSuccess).toBe(true);
    expect(acc200.isSuccess).toBe(true);

    await sqlite.executeMultiple(`
      INSERT INTO account_balances (account_id, asset_id, available_base_units, locked_base_units, version, updated_at)
      VALUES (${acc100.getValue().id}, 1, '0', '0', 1, 1000);
      INSERT INTO account_balances (account_id, asset_id, available_base_units, locked_base_units, version, updated_at)
      VALUES (${acc200.getValue().id}, 1, '0', '0', 1, 1000);
    `);

    const useCase = new RecordTransferUseCase(uow);
    const idemKey = 'test-idemp-insufficient-retry-key';

    // 2. Primeira tentativa falha por saldo insuficiente (100 tem saldo 0)
    const failRes = await useCase.execute({
      sourceUserId: 100,
      destinationUserId: 200,
      amountBaseUnits: '5000',
      assetId: 1,
      description: 'Transferência sem saldo',
      idempotencyKey: idemKey,
    });
    expect(failRes.isFailure).toBe(true);

    // 3. Abastece a conta do usuário 100 com saldo suficiente
    await sqlite.executeMultiple(`
      UPDATE account_balances
      SET available_base_units = '10000', updated_at = 2000
      WHERE account_id = ${acc100.getValue().id} AND asset_id = 1;
    `);

    // 4. Repete a requisição com a MESMA chave de idempotência e mesmo payload
    const successRes = await useCase.execute({
      sourceUserId: 100,
      destinationUserId: 200,
      amountBaseUnits: '5000',
      assetId: 1,
      description: 'Transferência sem saldo',
      idempotencyKey: idemKey,
    });

    expect(successRes.isSuccess).toBe(true);
    expect(successRes.getValue().transactionId).toBeDefined();
    expect(successRes.getValue().isReplayed).toBe(false);

    // 5. Terceira tentativa com a mesma chave agora retorna replay determinístico
    const replayRes = await useCase.execute({
      sourceUserId: 100,
      destinationUserId: 200,
      amountBaseUnits: '5000',
      assetId: 1,
      description: 'Transferência sem saldo',
      idempotencyKey: idemKey,
    });
    expect(replayRes.isSuccess).toBe(true);
    expect(replayRes.getValue().transactionId).toBe(successRes.getValue().transactionId);
    expect(replayRes.getValue().isReplayed).toBe(true);
  });

  it('TEST-IDEMP-RACE-01: Corrida de 50 requisições simultâneas com mesma chave (exatamente 1 vencedor)', async () => {
    const raceKey = 'race-concurrent-claim-key-01';
    const hash = 'canonical-hash-race-test';

    const promises = Array.from({ length: 50 }, () =>
      financeRepo.claimIdempotency(raceKey, 100, 'finance.race', hash)
    );

    const results = await Promise.all(promises);
    const winners = results.filter((r) => r.claimed === true);
    const losers = results.filter((r) => r.claimed === false);

    expect(winners.length).toBe(1);
    expect(losers.length).toBe(49);
  });

  it('TEST-ROUTE-01: Resolução determinística de rotas por provedor e fallback global provider_id IS NULL', async () => {
    // 1. Cria duas contas sistêmicas de clearing
    const [accProviderSpecific] = await db
      .insert(financialAccounts)
      .values({
        userId: null,
        accountType: 'clearing',
        accountClass: 'asset',
        status: 'active',
        name: 'Clearing Provider 10',
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    const [accGlobal] = await db
      .insert(financialAccounts)
      .values({
        userId: null,
        accountType: 'clearing',
        accountClass: 'asset',
        status: 'active',
        name: 'Clearing Global Fallback',
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    // 2. Insere as rotas em system_account_routes
    await db.insert(systemAccountRoutes).values([
      {
        accountType: 'clearing_custom',
        providerId: 10,
        accountId: accProviderSpecific.id,
        status: 'active',
      },
      {
        accountType: 'clearing_custom',
        providerId: null,
        accountId: accGlobal.id,
        status: 'active',
      },
    ]);

    // 3. Resolução para provider 10 -> deve retornar a conta específica
    const resProvider10 = await financeRepo.resolveSystemAccount('clearing_custom', 10);
    expect(resProvider10.isSuccess).toBe(true);
    expect(resProvider10.getValue().id).toBe(accProviderSpecific.id);
    expect(resProvider10.getValue().name).toBe('Clearing Provider 10');

    // 4. Resolução para provider 99 (não configurado) -> deve retornar fallback global
    const resProvider99 = await financeRepo.resolveSystemAccount('clearing_custom', 99);
    expect(resProvider99.isSuccess).toBe(true);
    expect(resProvider99.getValue().id).toBe(accGlobal.id);
    expect(resProvider99.getValue().name).toBe('Clearing Global Fallback');

    // 5. Resolução sem provider -> deve retornar fallback global
    const resNoProvider = await financeRepo.resolveSystemAccount('clearing_custom');
    expect(resNoProvider.isSuccess).toBe(true);
    expect(resNoProvider.getValue().id).toBe(accGlobal.id);
  });

  it('TEST-COMMIT-FENCE-01: Rejeição física no commit se a conta for suspensa imediatamente antes do batch', async () => {
    // 1. Cria usuário e conta ativa com saldo
    const user300Acc = await financeRepo.getOrCreateUserAccount(300);
    const destAcc = await financeRepo.getOrCreateUserAccount(200);
    expect(user300Acc.isSuccess).toBe(true);
    expect(destAcc.isSuccess).toBe(true);

    const sourceAccountId = user300Acc.getValue().id;
    const destAccountId = destAcc.getValue().id;

    await sqlite.executeMultiple(`
      INSERT INTO account_balances (account_id, asset_id, available_base_units, locked_base_units, version, updated_at)
      VALUES (${sourceAccountId}, 1, '50000', '0', 1, 2000);
    `);

    // 2. Constrói PostingPlan válido enquanto a conta está ativa
    const plan = PostingPlanBuilder.build({
      scope: 'finance',
      idempotencyKey: 'fence-test-suspension-key-01',
      requestHash: 'hash-fence-test',
      transactionType: 'transfer',
      category: 'operational',
      description: 'Transferência pré-suspensão',
      actorUserId: 300,
      authorizedByUserId: null,
      authorizationDecision: {
        allowed: true,
        type: 'SELF',
        actorUserId: 300,
        authorizedByUserId: null,
      },
      entries: [
        {
          accountId: sourceAccountId,
          assetId: 1,
          accountClass: 'liability',
          accountStatus: 'active',
          direction: 'debit',
          amount: 5000n,
          description: 'Débito 300',
          currentAvailableBaseUnits: 50000n,
          currentVersion: 1,
        },
        {
          accountId: destAccountId,
          assetId: 1,
          accountClass: 'liability',
          accountStatus: 'active',
          direction: 'credit',
          amount: 5000n,
          description: 'Crédito 200',
          currentAvailableBaseUnits: 5000n,
          currentVersion: 2,
        },
      ],
    });

    // 3. Simula corrida concorrente: conta 300 é suspensa no banco ANTES do commit do lote
    await sqlite.executeMultiple(`
      UPDATE financial_accounts SET status = 'suspended' WHERE id = ${sourceAccountId};
    `);

    // Pré-registra a chave como processing para simular claim
    await db.insert(idempotencyKeys).values({
      key: 'fence-test-suspension-key-01',
      scope: 'finance',
      requestHash: 'hash-fence-test',
      status: 'processing',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // 4. Executa commit via PostingAuthority / D1AtomicPostingExecutor
    const executor = new D1AtomicPostingExecutor(db);
    const session = financeRepo.getPostingSession();

    const commitResult = await executor.execute(plan, session);

    // O commit DEVE falhar fisicamente pois a conta não está mais ativa!
    expect(commitResult.isFailure).toBe(true);
    expect(commitResult.error).toMatch(/guarda física|guard = 1|assertion/i);

    // 5. Verifica que o saldo NÃO foi alterado
    const [balanceAfter] = await db
      .select()
      .from(accountBalances)
      .where(eq(accountBalances.accountId, sourceAccountId));
    expect(balanceAfter.availableBaseUnits).toBe('50000');
  });

  it('TEST-FENCE-STALE-01: Prova de que Worker A (stale generation=1) é fisicamente bloqueado após Worker B conquistar generation=2', async () => {
    const idemKey = 'adversarial-fence-stale-key-01';
    const reqHash = 'adversarial-fence-hash-01';
    const scope = 'finance';

    // 1. Worker A executa claimIdempotency e ganha leaseOwner='worker-A', generation=1
    const claimA = await financeRepo.claimIdempotency(idemKey, 100, scope, reqHash, {
      leaseOwner: 'worker-A',
      leaseDurationMs: 60000,
    });

    expect(claimA.claimed).toBe(true);
    expect(claimA.leaseOwner).toBe('worker-A');
    expect(claimA.leaseGeneration).toBe(1);

    // 2. Simula expiração segura do lease envelhecendo timestamps no banco (preserva created_at < expires_at)
    await sqlite.execute(
      `UPDATE idempotency_keys SET created_at = unixepoch() - 20, expires_at = unixepoch() - 5 WHERE key = '${idemKey}';`
    );

    // 3. Worker B executa reclaim via CAS e conquista leaseOwner='worker-B', generation=2
    const claimB = await financeRepo.claimIdempotency(idemKey, 100, scope, reqHash, {
      leaseOwner: 'worker-B',
      leaseDurationMs: 60000,
    });

    expect(claimB.claimed).toBe(true);
    expect(claimB.leaseOwner).toBe('worker-B');
    expect(claimB.leaseGeneration).toBe(2);

    // 4. Worker A acorda após longo processamento.
    // Conforme a regra P0-A, Worker A NUNCA lê o banco para adotar a identidade de Worker B.
    // Worker A utiliza estritamente sua própria identidade conquistada (generation=1).
    const [accAlice] = await db.select().from(financialAccounts).where(eq(financialAccounts.userId, 100));
    const [accBob] = await db.select().from(financialAccounts).where(eq(financialAccounts.userId, 200));
    const [balAlice] = await db.select().from(accountBalances).where(eq(accountBalances.accountId, accAlice.id));
    const [balBob] = await db.select().from(accountBalances).where(eq(accountBalances.accountId, accBob.id));

    const planStaleA = PostingPlanBuilder.build({
      scope,
      idempotencyKey: idemKey,
      requestHash: reqHash,
      transactionType: 'transfer',
      category: 'operational',
      description: 'Stale Worker A attempt',
      actorUserId: 100,
      authorizedByUserId: null,
      authorizationDecision: { allowed: true },
      leaseOwner: claimA.leaseOwner, // 'worker-A'
      leaseGeneration: claimA.leaseGeneration, // 1 (STALE!)
      entries: [
        {
          accountId: accAlice.id,
          assetId: 1,
          accountClass: accAlice.accountClass,
          accountStatus: accAlice.status,
          direction: 'debit',
          amount: 100n,
          description: 'Debit Alice',
          currentAvailableBaseUnits: BigInt(balAlice.availableBaseUnits),
          currentVersion: balAlice.version,
        },
        {
          accountId: accBob.id,
          assetId: 1,
          accountClass: accBob.accountClass,
          accountStatus: accBob.status,
          direction: 'credit',
          amount: 100n,
          description: 'Credit Bob',
          currentAvailableBaseUnits: BigInt(balBob.availableBaseUnits),
          currentVersion: balBob.version,
        },
      ],
    });

    // 5. Worker A tenta commitar via PostingAuthority / D1AtomicPostingExecutor
    const authority = financeRepo.getPostingAuthority();
    const sessionA = financeRepo.getPostingSession();

    const commitResultA = await authority.commit(planStaleA, sessionA);

    // O commit de Worker A DEVE falhar fisicamente: o lease_generation no banco é 2, não 1!
    expect(commitResultA.isFailure).toBe(true);
    expect(commitResultA.error).toMatch(/guarda física|guard = 1|assertion/i);

    // 6. Prova de que o registro de idempotência no banco continua intacto com Worker B (generation=2)
    const [idempRecord] = await db
      .select()
      .from(idempotencyKeys)
      .where(eq(idempotencyKeys.key, idemKey));

    expect(idempRecord.leaseOwner).toBe('worker-B');
    expect(idempRecord.leaseGeneration).toBe(2);
    expect(idempRecord.status).toBe('processing');
  });
});
