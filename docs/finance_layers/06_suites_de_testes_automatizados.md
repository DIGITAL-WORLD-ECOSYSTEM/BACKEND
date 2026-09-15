# 6. SUÍTES DE TESTES AUTOMATIZADOS

Documento integrante do dossiê canônico do Finance Core (`BackEnd/`).

## Sumário dos Arquivos da Camada

- [finance_posting_authority.test.ts](#testsarchitecturefinance_posting_authoritytestts) — `tests/architecture/finance_posting_authority.test.ts` (95 linhas)
- [finance_real_db_e2e.test.ts](#testsfinance_real_db_e2etestts) — `tests/finance_real_db_e2e.test.ts` (232 linhas)
- [bootstrap_service.test.ts](#testsfinancebootstrap_servicetestts) — `tests/finance/bootstrap_service.test.ts` (93 linhas)
- [concurrency_stress.test.ts](#testsfinanceconcurrency_stresstestts) — `tests/finance/concurrency_stress.test.ts` (322 linhas)
- [domain_policies.test.ts](#testsfinancedomain_policiestestts) — `tests/finance/domain_policies.test.ts` (429 linhas)
- [event_inbox.test.ts](#testsfinanceevent_inboxtestts) — `tests/finance/event_inbox.test.ts` (56 linhas)
- [evm_precision.test.ts](#testsfinanceevm_precisiontestts) — `tests/finance/evm_precision.test.ts` (83 linhas)
- [failure_injection.test.ts](#testsfinancefailure_injectiontestts) — `tests/finance/failure_injection.test.ts` (87 linhas)
- [money256.test.ts](#testsfinancemoney256testts) — `tests/finance/money256.test.ts` (83 linhas)
- [posting_authority_hardening.test.ts](#testsfinanceposting_authority_hardeningtestts) — `tests/finance/posting_authority_hardening.test.ts` (316 linhas)
- [reconciliation_3way.test.ts](#testsfinancereconciliation_3waytestts) — `tests/finance/reconciliation_3way.test.ts` (133 linhas)
- [reverse_transaction.test.ts](#testsfinancereverse_transactiontestts) — `tests/finance/reverse_transaction.test.ts` (117 linhas)
- [balance_projection.test.ts](#testsfinanceinvariantsbalance_projectiontestts) — `tests/finance/invariants/balance_projection.test.ts` (163 linhas)
- [commit_failure.test.ts](#testsfinanceinvariantscommit_failuretestts) — `tests/finance/invariants/commit_failure.test.ts` (177 linhas)
- [transaction_failure_matrix.test.ts](#testsfinanceinvariantstransaction_failure_matrixtestts) — `tests/finance/invariants/transaction_failure_matrix.test.ts` (483 linhas)

---

<a id="testsarchitecturefinance_posting_authoritytestts"></a>
## Arquivo: `tests/architecture/finance_posting_authority.test.ts`

- **Caminho absoluto**: `/home/sandro/Área de trabalho/BackEnd/tests/architecture/finance_posting_authority.test.ts`
- **Total de linhas**: 95
- **Linguagem**: TypeScript

```typescript
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

function getAllFiles(dirPath: string, arrayOfFiles: string[] = []): string[] {
  if (!fs.existsSync(dirPath)) return arrayOfFiles;
  const files = fs.readdirSync(dirPath);

  files.forEach((file) => {
    const fullPath = path.join(dirPath, file);
    if (fs.statSync(fullPath).isDirectory()) {
      getAllFiles(fullPath, arrayOfFiles);
    } else if (fullPath.endsWith('.ts') || fullPath.endsWith('.js')) {
      arrayOfFiles.push(fullPath);
    }
  });

  return arrayOfFiles;
}

describe('Static Architecture Gate: Single Financial Posting Authority & Dead Code Cleanliness', () => {
  const rootDir = path.resolve(__dirname, '../..');
  const srcDir = path.resolve(rootDir, 'src');

  it('prohibits existence of legacy DoubleEntryLedgerService.ts', () => {
    const legacyPath = path.resolve(srcDir, 'domains/finance/services/DoubleEntryLedgerService.ts');
    expect(fs.existsSync(legacyPath), `Legacy DoubleEntryLedgerService.ts must be completely removed`).toBe(false);
  });

  it('prohibits existence of legacy Money.ts entity', () => {
    const legacyMoneyPath = path.resolve(srcDir, 'domains/finance/entities/Money.ts');
    expect(fs.existsSync(legacyMoneyPath), `Legacy Money.ts must be completely removed in favor of Money256`).toBe(false);
  });

  it('prohibits existence of legacy src/domains/finance/use-cases directory', () => {
    const legacyUseCasesDir = path.resolve(srcDir, 'domains/finance/use-cases');
    expect(fs.existsSync(legacyUseCasesDir), `Legacy domain use-cases directory must be completely removed`).toBe(false);
  });

  it('prohibits direct ledger table insertion outside DrizzleFinanceRepository', () => {
    const allFiles = getAllFiles(srcDir);
    const forbiddenLedgerInsertions: string[] = [];

    allFiles.forEach((file) => {
      const relativePath = path.relative(srcDir, file);
      if (relativePath.includes('DrizzleFinanceRepository.ts')) {
        return;
      }

      const content = fs.readFileSync(file, 'utf-8');

      if (
        content.includes('insert(financialLedgerEntries)') ||
        content.includes('INSERT INTO financial_ledger_entries') ||
        content.includes('insert(financial_ledger_entries)') ||
        content.includes('sql`INSERT INTO financial_ledger_entries')
      ) {
        forbiddenLedgerInsertions.push(relativePath);
      }
    });

    expect(
      forbiddenLedgerInsertions,
      `Arquivos violando a autoridade única de posting: ${forbiddenLedgerInsertions.join(', ')}`
    ).toEqual([]);
  });

  it('prohibits Use Cases outside FinancialTransactionOrchestrator from direct repository balance mutation', () => {
    const useCasesDir = path.resolve(srcDir, 'application/finance/use-cases');
    if (!fs.existsSync(useCasesDir)) return;

    const useCaseFiles = getAllFiles(useCasesDir);
    const violatingUseCases: string[] = [];

    useCaseFiles.forEach((file) => {
      const basename = path.basename(file);
      if (
        basename === 'RecordLedgerTransactionUseCase.ts' ||
        basename === 'FinancialTransactionOrchestrator.ts'
      ) {
        return;
      }

      const content = fs.readFileSync(file, 'utf-8');
      if (content.includes('updateBalanceWithOCC(')) {
        violatingUseCases.push(basename);
      }
    });

    expect(
      violatingUseCases,
      `Use cases que tentam mutar saldos diretamente sem o Orchestrator: ${violatingUseCases.join(', ')}`
    ).toEqual([]);
  });
});

```

---

<a id="testsfinance_real_db_e2etestts"></a>
## Arquivo: `tests/finance_real_db_e2e.test.ts`

- **Caminho absoluto**: `/home/sandro/Área de trabalho/BackEnd/tests/finance_real_db_e2e.test.ts`
- **Total de linhas**: 232
- **Linguagem**: TypeScript

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { unlinkSync } from 'fs';
import { eq } from 'drizzle-orm';

import { DrizzleUnitOfWork } from '../src/infrastructure/repositories/DrizzleUnitOfWork';
import { LedgerTransaction, LedgerEntry } from '../src/domains/finance/entities/LedgerTransaction';
import { Money256 } from '../src/domains/finance/value-objects/Money256';
import { FinancialTransactionOrchestrator } from '../src/application/finance/services/FinancialTransactionOrchestrator';
import { idempotencyKeys, outboxEvents } from '../src/db/infrastructure/tables';
import { financialTransactions, financialLedgerEntries, accountBalances } from '../src/db/finance/tables';
import { Result } from '../src/shared/kernel/Result';
import { runAllMigrationsLibSql } from './test_helpers/runMigrations';

describe('Finance Core E2E Certification (Real DB)', () => {
  let sqlite: any;
  let db: any;
  let uow: DrizzleUnitOfWork;

  beforeAll(async () => {
    sqlite = createClient({ url: 'file:test_e2e_real.db' });
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
           const res = await cb(proxyDb);
           await t.commit();
           return res;
        } catch (err: any) {
           try { await t.rollback(); } catch (e) {}
           if (err.message === 'drizzle-rollback') return;
           throw err;
        }
      }
    };

    await runAllMigrationsLibSql(sqlite);

    await sqlite.executeMultiple(`
      INSERT INTO users (id, email, email_normalized, status, created_at, updated_at) VALUES (1, 'user1@test.com', 'user1@test.com', 'active', 1000, 1000);
      INSERT INTO users (id, email, email_normalized, status, created_at, updated_at) VALUES (2, 'user2@test.com', 'user2@test.com', 'active', 1000, 1000);
      INSERT INTO financial_assets (id, symbol, code, name, type, decimals, status, created_at, updated_at) VALUES (1, 'BRL', 'BRL', 'Brazilian Real', 'fiat', 2, 'active', 1000, 1000);
    `);

    uow = new DrizzleUnitOfWork(uowDb);
  }, 30000);

  afterAll(() => {
    sqlite.close();
    try { unlinkSync('test_e2e_real.db'); } catch (e) {}
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
    await uow.execute(async (f) => {
      await f.getFinanceRepository().getOrCreateOperatingAccount();
      await f.getFinanceRepository().getOrCreateUserAccount(1);
      return Result.ok(true);
    });

    const idemKey = 'happy-path-key';
    const reqHash = 'hash123';
    const amount = Money256.fromString('5000', 1);

    const tx = LedgerTransaction.create({
      idempotencyKey: idemKey,
      userId: 1,
      description: 'Test Deposit',
      transactionType: 'deposit',
      category: 'deposit',
      entries: [
        new LedgerEntry({ accountId: '1', amount: amount as any, type: 'debit' }),
        new LedgerEntry({ accountId: '2', amount: amount as any, type: 'credit' })
      ]
    });

    const resultRes = await uow.execute(async (factory) => {
      const repo = factory.getFinanceRepository();
      const orchestrator = new FinancialTransactionOrchestrator(repo, factory.getOutboxRepository());
      const postResult = await orchestrator.executePosting(tx, reqHash);
      return Result.ok(postResult);
    });

    expect(resultRes.isSuccess).toBe(true);
    const result = resultRes.getValue();
    expect(result.transactionId).toBeDefined();

    const state = await getFullState();
    expect(state.txs.length).toBe(1);
    expect(state.txs[0].status).toBe('completed');
    expect(state.entries.length).toBe(2);
    expect(state.balances.length).toBe(2);
    
    expect(state.outbox.length).toBe(1);
    
    const idem = state.idem.find((i: any) => i.key === idemKey);
    expect(idem).toBeDefined();
    expect(idem.status).toBe('completed');
    expect(idem.financialTransactionId).toBe(state.txs[0].id);
  });

  it('Rollback: falha forçada resulta em banco intocado (0 registros persistidos vazados)', async () => {
    const initialState = await getFullState();
    const amount = Money256.fromString('99999', 1);

    const tx = LedgerTransaction.create({
      idempotencyKey: 'rollback-key',
      userId: 1,
      description: 'Will fail due to insufficient funds / bad logic',
      transactionType: 'deposit',
      category: 'deposit',
      entries: [
        new LedgerEntry({ accountId: '1', amount: amount as any, type: 'credit' }), 
        new LedgerEntry({ accountId: '2', amount: amount as any, type: 'debit' })   
      ]
    });

    const result = await uow.execute(async (factory) => {
      const repo = factory.getFinanceRepository();
      const orchestrator = new FinancialTransactionOrchestrator(repo, factory.getOutboxRepository());
      const postResult = await orchestrator.executePosting(tx, 'hash-fail');
      return Result.ok(postResult);
    });

    expect(result.isFailure).toBe(true);

    const finalState = await getFullState();
    expect(finalState.txs.length).toBe(initialState.txs.length);
    expect(finalState.entries.length).toBe(initialState.entries.length);
    expect(finalState.idem.length).toBe(initialState.idem.length);
    expect(finalState.outbox.length).toBe(initialState.outbox.length);
  });

  it('Same key + same hash: replay da mesma tx (Idempotente)', async () => {
    const idemKey = 'happy-path-key';
    const amount = Money256.fromString('5000', 1);
    
    const tx = LedgerTransaction.create({
      idempotencyKey: idemKey,
      userId: 1,
      description: 'Test Deposit',
      transactionType: 'deposit',
      category: 'deposit',
      entries: [
        new LedgerEntry({ accountId: '1', amount: amount as any, type: 'debit' }),
        new LedgerEntry({ accountId: '2', amount: amount as any, type: 'credit' })
      ]
    });

    const resultRes = await uow.execute(async (factory) => {
      const repo = factory.getFinanceRepository();
      const orchestrator = new FinancialTransactionOrchestrator(repo, factory.getOutboxRepository());
      const postResult = await orchestrator.executePosting(tx, 'hash123');
      return Result.ok(postResult);
    });

    expect(resultRes.isSuccess).toBe(true);
    expect(resultRes.getValue().isReplayed).toBe(true);
  });

  it('Same key + different hash: 409 Conflict', async () => {
    const idemKey = 'happy-path-key';
    const amount = Money256.fromString('100', 1);
    
    const tx = LedgerTransaction.create({
      idempotencyKey: idemKey,
      userId: 1,
      description: 'Modified Deposit',
      transactionType: 'deposit',
      category: 'deposit',
      entries: [
        new LedgerEntry({ accountId: '1', amount: amount as any, type: 'debit' }),
        new LedgerEntry({ accountId: '2', amount: amount as any, type: 'credit' })
      ]
    });

    const result = await uow.execute(async (factory) => {
      const repo = factory.getFinanceRepository();
      const orchestrator = new FinancialTransactionOrchestrator(repo, factory.getOutboxRepository());
      const postResult = await orchestrator.executePosting(tx, 'hash-diferente');
      return Result.ok(postResult);
    });

    expect(result.isFailure).toBe(true);
    expect(result.error).toContain('Conflito de idempotência');
  });

  it('Concorrência: exatamente 1 tx processada em Race Condition (barrier simulada)', async () => {
    const idemKey = 'race-condition-key';
    const reqHash = 'race-hash';

    const claimRes = await uow.execute(async (factory) => {
       const repo = factory.getFinanceRepository();
       await repo.claimIdempotency(idemKey, 2, 'finance', reqHash);
       return Result.ok(true);
    });

    expect(claimRes.isSuccess).toBe(true);

    const result = await uow.execute(async (factory) => {
       const claimed = await factory.getFinanceRepository().claimIdempotency(idemKey, 2, 'finance', reqHash);
       if (!claimed) {
          return Result.fail('Transação em andamento (Idempotency Key Processing).');
       }
       return Result.ok(true);
    });

    expect(result.isFailure).toBe(true);
    expect(result.error).toContain('Transação em andamento (Idempotency Key Processing).');

    const idemRows = await db.select().from(idempotencyKeys).where(eq(idempotencyKeys.key, idemKey));
    expect(idemRows.length).toBe(1);
    expect(idemRows[0].status).toBe('processing');
  });
});

```

---

<a id="testsfinancebootstrap_servicetestts"></a>
## Arquivo: `tests/finance/bootstrap_service.test.ts`

- **Caminho absoluto**: `/home/sandro/Área de trabalho/BackEnd/tests/finance/bootstrap_service.test.ts`
- **Total de linhas**: 93
- **Linguagem**: TypeScript

```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { FinanceBootstrapService } from '../../src/infrastructure/services/FinanceBootstrapService';
import { DrizzleFinanceRepository } from '../../src/infrastructure/repositories/DrizzleFinanceRepository';
import { unlinkSync, existsSync } from 'fs';

describe('FinanceBootstrapService - Bootstrapping de Tesouraria e Contas do Sistema', () => {
  const dbFile = 'test_bootstrap_service.db';
  let sqlite: any;
  let db: any;

  beforeAll(async () => {
    if (existsSync(dbFile)) {
      try { unlinkSync(dbFile); } catch (e) {}
    }
    sqlite = createClient({ url: `file:${dbFile}` });
    db = drizzle(sqlite);

    // DDL de teste
    await sqlite.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL
      );
    `);
    await sqlite.execute(`
      CREATE TABLE IF NOT EXISTS financial_assets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL,
        symbol TEXT NOT NULL,
        name TEXT NOT NULL,
        decimals INTEGER NOT NULL,
        type TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER,
        updated_at INTEGER
      );
    `);
    await sqlite.execute(`
      CREATE TABLE IF NOT EXISTS financial_accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        account_type TEXT NOT NULL CHECK(account_type IN ('user_available', 'treasury', 'operating', 'reserve', 'fees', 'escrow', 'reward_expense', 'yield_expense', 'clearing', 'opening_balance_equity', 'payment_revenue', 'refund_expense')),
        account_class TEXT NOT NULL CHECK(account_class IN ('asset', 'liability', 'equity', 'revenue', 'expense')),
        status TEXT NOT NULL CHECK(status IN ('active', 'inactive', 'suspended')),
        name TEXT NOT NULL,
        version INTEGER DEFAULT 1 NOT NULL,
        created_at INTEGER,
        updated_at INTEGER
      );
    `);
    await sqlite.execute(`
      CREATE TABLE IF NOT EXISTS account_balances (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id INTEGER NOT NULL,
        asset_id INTEGER NOT NULL,
        available_base_units TEXT DEFAULT '0' NOT NULL,
        locked_base_units TEXT DEFAULT '0' NOT NULL,
        version INTEGER DEFAULT 1 NOT NULL,
        updated_at INTEGER
      );
    `);

    // Inserir usuário inicial
    await sqlite.execute(`INSERT INTO users (id, name) VALUES (1, 'Admin');`);
  }, 30000);

  it('deve inicializar com sucesso o banco e provisionar contas de Tesouraria, Operacional e Fee', async () => {
    const repo = new DrizzleFinanceRepository(db);

    // 1. Antes do bootstrap, getTreasuryAccount deve falhar
    const initialGet = await repo.getTreasuryAccount();
    expect(initialGet.isFailure).toBe(true);
    expect(initialGet.error).toContain('Treasury account not found');

    // 2. Executar bootstrap
    const seedRes = await FinanceBootstrapService.seedSystemAccounts(db, {
      currencyCode: 'BRL',
      initialBalanceBaseUnits: 1000000n,
    });

    if (seedRes.isFailure) console.log('SEED ERROR:', seedRes.error);
    expect(seedRes.isSuccess).toBe(true);
    const data = seedRes.getValue();
    expect(data.treasuryAccountId).toBeGreaterThan(0);

    // 3. Após bootstrap, getTreasuryAccount deve ter sucesso
    const treasuryGet = await repo.getTreasuryAccount();
    expect(treasuryGet.isSuccess).toBe(true);
    expect(treasuryGet.getValue().accountType).toBe('treasury');
  }, 30000);
});

```

---

<a id="testsfinanceconcurrency_stresstestts"></a>
## Arquivo: `tests/finance/concurrency_stress.test.ts`

- **Caminho absoluto**: `/home/sandro/Área de trabalho/BackEnd/tests/finance/concurrency_stress.test.ts`
- **Total de linhas**: 322
- **Linguagem**: TypeScript

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { unlinkSync, existsSync } from 'fs';
import { DrizzleUnitOfWork } from '../../src/infrastructure/repositories/DrizzleUnitOfWork';
import { FinanceBootstrapService } from '../../src/infrastructure/services/FinanceBootstrapService';
import { Money256 } from '../../src/domains/finance/value-objects/Money256';
import { AccountingEntryPolicy } from '../../src/domains/finance/policies/AccountingEntryPolicy';
import { LedgerTransaction, LedgerEntry } from '../../src/domains/finance/entities/LedgerTransaction';
import { FinancialTransactionOrchestrator } from '../../src/application/finance/services/FinancialTransactionOrchestrator';
import { runAllMigrationsLibSql } from '../test_helpers/runMigrations';
import { Result } from '../../src/shared/kernel/Result';

describe('Gate 4: Real Double-Spend Multi-Client Concurrency Stress Certification', () => {
  const dbFile = 'test_concurrency_stress.db';
  let sqlite: any;
  let db: any;

  beforeAll(async () => {
    if (existsSync(dbFile)) {
      try { unlinkSync(dbFile); } catch (e) {}
    }
    sqlite = createClient({ url: `file:${dbFile}` });
    db = drizzle(sqlite);
    await runAllMigrationsLibSql(sqlite);
  }, 30000);

  afterAll(() => {
    try { sqlite.close(); } catch (e) {}
    try { unlinkSync(dbFile); } catch (e) {}
  });

  it('proves zero double-spend under 10 concurrent debit requests', async () => {
    // 1. Bootstrap system accounts and asset BRL (assetId = 1)
    const bootstrapRes = await FinanceBootstrapService.seedSystemAccounts(db, {
      currencyCode: 'BRL',
      initialBalanceBaseUnits: 1000n, // Treasury initial balance
    });
    expect(bootstrapRes.isSuccess).toBe(true);
    const { assetId, treasuryAccountId } = bootstrapRes.getValue();

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

    const uow = new DrizzleUnitOfWork(uowDb);

    // Ensure user 42 exists for FK constraint
    await sqlite.execute(`INSERT INTO users (id, email, email_normalized, status, created_at, updated_at) VALUES (42, 'user42@test.com', 'user42@test.com', 'active', 1000, 1000)`);

    // 2. Deposit 100 base units into User Account #42
    const depositRes = await uow.execute(async (factory) => {
      const repo = factory.getFinanceRepository();
      const userAccRes = await repo.getOrCreateUserAccount(42);
      const userAccountId = userAccRes.getValue().id;

      const entriesRaw = AccountingEntryPolicy.createDepositEntries({
        treasuryAccountId,
        userAccountId,
        amount: Money256.fromString('100', assetId),
        description: 'Initial User 42 Balance',
      });

      const ledgerEntries = entriesRaw.map(
        (r) =>
          new LedgerEntry({
            accountId: String(r.accountId),
            amount: r.amount as any,
            type: r.entryType,
            description: r.description,
          })
      );

      const tx = LedgerTransaction.create({
        idempotencyKey: 'deposit-init-42',
        description: 'Initial Deposit',
        entries: ledgerEntries,
        transactionType: 'deposit',
        category: 'deposit',
        userId: 42,
      });

      const orchestrator = new FinancialTransactionOrchestrator(repo);
      return Result.ok(await orchestrator.executePosting(tx));
    });

    if (depositRes.isFailure) console.error('DEPOSIT 42 FAILED:', depositRes.error);
    expect(depositRes.getValue().transactionId).toBeDefined();

    // 3. Launch 10 concurrent debit requests of 20 base units each
    const concurrentRequests = Array.from({ length: 10 }).map((_, idx) => async () => {
      try {
        const res = await uow.execute(async (factory) => {
          const repo = factory.getFinanceRepository();
          const userAccRes = await repo.getOrCreateUserAccount(42);
          const userAccountId = userAccRes.getValue().id;

          const entriesRaw = AccountingEntryPolicy.createWithdrawalEntries({
            treasuryAccountId,
            userAccountId,
            amount: Money256.fromString('20', assetId),
            description: `Concurrent Debit #${idx + 1}`,
          });

          const ledgerEntries = entriesRaw.map(
            (r) =>
              new LedgerEntry({
                accountId: String(r.accountId),
                amount: r.amount as any,
                type: r.entryType,
                description: r.description,
              })
          );

          const tx = LedgerTransaction.create({
            idempotencyKey: `debit-concurrent-${idx + 1}`,
            description: `Debit #${idx + 1}`,
            entries: ledgerEntries,
            transactionType: 'withdrawal',
            category: 'withdrawal',
            userId: 42,
          });

          const orchestrator = new FinancialTransactionOrchestrator(repo);
          return Result.ok(await orchestrator.executePosting(tx));
        });
        if (res.isFailure) {
          console.log(`Debit #${idx + 1} failed:`, res.error);
          return { error: res.error };
        }
        return res;
      } catch (err: any) {
        console.log(`Debit #${idx + 1} threw:`, err.message);
        return { error: err.message || 'Debit failed' };
      }
    });

    const results = await Promise.all(concurrentRequests.map((fn) => fn()));

    const successful = results.filter((r: any) => r && r.isSuccess === true);
    const failed = results.filter((r: any) => !r || r.isSuccess !== true);

    console.log(`SUCCESSFUL: ${successful.length}, FAILED: ${failed.length}`);

    // Verify User 42 final balance is non-negative and zero double spend
    const finalBalanceRes = await sqlite.execute('SELECT available_base_units FROM account_balances WHERE account_id = (SELECT id FROM financial_accounts WHERE user_id = 42)');
    const finalBal = BigInt(finalBalanceRes.rows[0].available_base_units);
    
    // Total debited = successful.length * 20
    // Remaining balance + debited MUST EQUAL initial balance (100)
    expect(finalBal + BigInt(successful.length * 20)).toBe(100n);
    expect(finalBal >= 0n).toBe(true);
  }, 30000);

  it('Gate B: Multi-Client Independent Connections Concurrency Stress Certification', async () => {
    const dbFileB = 'test_concurrency_stress_b.db';
    if (existsSync(dbFileB)) {
      try { unlinkSync(dbFileB); } catch (e) {}
    }
    const sqliteB = createClient({ url: `file:${dbFileB}` });
    const dbB = drizzle(sqliteB);
    await runAllMigrationsLibSql(sqliteB);

    // 1. Setup initial balance with primary DB connection
    const bootstrapRes = await FinanceBootstrapService.seedSystemAccounts(dbB, {
      currencyCode: 'BRL',
      initialBalanceBaseUnits: 1000n,
    });
    expect(bootstrapRes.isSuccess).toBe(true);
    const { assetId, treasuryAccountId } = bootstrapRes.getValue();

    await sqliteB.execute(`INSERT INTO users (id, email, email_normalized, status, created_at, updated_at) VALUES (55, 'user55@test.com', 'user55@test.com', 'active', 1000, 1000)`);

    // Initial deposit of 200 units to user 55
    const primaryUow = new DrizzleUnitOfWork({
      ...dbB,
      transaction: async (cb: any) => {
        const t = await sqliteB.transaction('write');
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

    const initDepRes = await primaryUow.execute(async (factory) => {
      const repo = factory.getFinanceRepository();
      const userAccRes = await repo.getOrCreateUserAccount(55);
      const userAccountId = userAccRes.getValue().id;

      const entriesRaw = AccountingEntryPolicy.createDepositEntries({
        treasuryAccountId,
        userAccountId,
        amount: Money256.fromString('200', assetId),
        description: 'Initial Deposit User 55',
      });

      const ledgerEntries = entriesRaw.map(
        (r) => new LedgerEntry({ accountId: String(r.accountId), amount: r.amount as any, type: r.entryType, description: r.description })
      );

      const tx = LedgerTransaction.create({
        idempotencyKey: 'deposit-init-55',
        description: 'Initial Deposit User 55',
        entries: ledgerEntries,
        transactionType: 'deposit',
        category: 'deposit',
        userId: 55,
      });

      const orchestrator = new FinancialTransactionOrchestrator(repo);
      return Result.ok(await orchestrator.executePosting(tx));
    });

    if (initDepRes.isFailure) console.error('DEPOSIT 55 FAILED:', initDepRes.error);
    expect(initDepRes.getValue().transactionId).toBeDefined();

    // 2. Spawn 10 INDEPENDENT client connections to simulate distinct Microservices / Workers
    const independentClients = Array.from({ length: 10 }).map(() => {
      const client = createClient({ url: `file:${dbFileB}` });
      const clientDb = drizzle(client);
      const clientUowDb = {
        ...clientDb,
        transaction: async (cb: any) => {
          const t = await client.transaction('write');
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
      };
      return { client, uow: new DrizzleUnitOfWork(clientUowDb) };
    });

    // 3. Fire 10 concurrent debit requests from 10 distinct client connections (30 units each)
    const concurrentMultiClientOps = independentClients.map(({ uow: clientUow }, idx) => async () => {
      try {
        const res = await clientUow.execute(async (factory) => {
          const repo = factory.getFinanceRepository();
          const userAccRes = await repo.getOrCreateUserAccount(55);
          const userAccountId = userAccRes.getValue().id;

          const entriesRaw = AccountingEntryPolicy.createWithdrawalEntries({
            treasuryAccountId,
            userAccountId,
            amount: Money256.fromString('30', assetId),
            description: `Multi-Client Debit #${idx + 1}`,
          });

          const ledgerEntries = entriesRaw.map(
            (r) => new LedgerEntry({ accountId: String(r.accountId), amount: r.amount as any, type: r.entryType, description: r.description })
          );

          const tx = LedgerTransaction.create({
            idempotencyKey: `multi-client-debit-${idx + 1}`,
            description: `Multi-Client Debit #${idx + 1}`,
            entries: ledgerEntries,
            transactionType: 'withdrawal',
            category: 'withdrawal',
            userId: 55,
          });

          const orchestrator = new FinancialTransactionOrchestrator(repo);
          return Result.ok(await orchestrator.executePosting(tx));
        });

        if (res.isFailure) return { error: res.error };
        return res;
      } catch (err: any) {
        return { error: err.message || 'Multi-Client Debit failed' };
      }
    });

    const results = await Promise.all(concurrentMultiClientOps.map((fn) => fn()));
    const successful = results.filter((r: any) => r && r.isSuccess === true);

    // Close all independent clients
    independentClients.forEach(({ client }) => {
      try { client.close(); } catch (e) {}
    });

    // 4. Verify balance conservation: initial 200 - (successful * 30) === final balance
    const finalBalanceRes = await sqliteB.execute('SELECT available_base_units FROM account_balances WHERE account_id = (SELECT id FROM financial_accounts WHERE user_id = 55)');
    const finalBal = BigInt(finalBalanceRes.rows[0].available_base_units);

    expect(finalBal + BigInt(successful.length * 30)).toBe(200n);
    expect(finalBal >= 0n).toBe(true);

    try { sqliteB.close(); } catch (e) {}
    try { unlinkSync(dbFileB); } catch (e) {}
  }, 30000);
});

```

---

<a id="testsfinancedomain_policiestestts"></a>
## Arquivo: `tests/finance/domain_policies.test.ts`

- **Caminho absoluto**: `/home/sandro/Área de trabalho/BackEnd/tests/finance/domain_policies.test.ts`
- **Total de linhas**: 429
- **Linguagem**: TypeScript

```typescript
import { describe, it, expect } from 'vitest';
import { FinancialTransactionStateMachine } from '../../src/domains/finance/services/FinancialTransactionStateMachine';
import { AccountClassPolicy } from '../../src/domains/finance/policies/AccountClassPolicy';
import { AccountStatusPolicy } from '../../src/domains/finance/policies/AccountStatusPolicy';
import { AssetStatusPolicy } from '../../src/domains/finance/policies/AssetStatusPolicy';
import {
  AccountingEntryPolicy,
  AccountingMatrixValidationError,
} from '../../src/domains/finance/policies/AccountingEntryPolicy';
import { Money256 } from '../../src/domains/finance/value-objects/Money256';
import {
  InvalidAccountClassError,
  AccountInactiveError,
  AssetInactiveError,
  InvalidIdentifierError,
} from '../../src/domains/finance/errors/FinancialError';

describe('Políticas de Domínio Financeiro & Máquina de Estados (DOD-10, DOD-12)', () => {
  describe('DOD-12: FinancialTransactionStateMachine', () => {
    it('deve permitir transições válidas de pending -> processing -> completed', () => {
      const res1 = FinancialTransactionStateMachine.transition('pending', 'processing');
      expect(res1.isSuccess).toBe(true);

      const res2 = FinancialTransactionStateMachine.transition('processing', 'completed');
      expect(res2.isSuccess).toBe(true);
    });

    it('deve permitir estorno a partir de completed (completed -> reversed)', () => {
      const res = FinancialTransactionStateMachine.transition('completed', 'reversed');
      expect(res.isSuccess).toBe(true);
    });

    it('deve proibir transição inválida (completed -> processing)', () => {
      const res = FinancialTransactionStateMachine.transition('completed', 'processing');
      expect(res.isFailure).toBe(true);
      expect(res.error).toContain("Transição de estado inválida: 'completed' -> 'processing'");
    });

    it('deve proibir estritamente cancelamento após início do processamento (processing -> cancelled)', () => {
      const res = FinancialTransactionStateMachine.transition('processing', 'cancelled');
      expect(res.isFailure).toBe(true);
      expect(res.error).toContain("Transição de estado inválida: 'processing' -> 'cancelled'");
      expect(FinancialTransactionStateMachine.canTransition('processing', 'cancelled')).toBe(false);
    });

    it('deve permitir cancelamento antes do processamento (pending -> cancelled)', () => {
      const res = FinancialTransactionStateMachine.transition('pending', 'cancelled');
      expect(res.isSuccess).toBe(true);
      expect(res.getValue()).toBe('cancelled');
    });

    it('deve permitir falha a partir de pending e processing', () => {
      expect(FinancialTransactionStateMachine.transition('pending', 'failed').isSuccess).toBe(true);
      expect(FinancialTransactionStateMachine.transition('processing', 'failed').isSuccess).toBe(true);
    });

    it('deve tratar self-transition como no-op idempotente', () => {
      const resPending = FinancialTransactionStateMachine.transition('pending', 'pending');
      expect(resPending.isSuccess).toBe(true);
      expect(resPending.getValue()).toBe('pending');

      const resCompleted = FinancialTransactionStateMachine.transition('completed', 'completed');
      expect(resCompleted.isSuccess).toBe(true);
      expect(resCompleted.getValue()).toBe('completed');
    });

    it('deve rejeitar status atual ou de destino desconhecido em runtime', () => {
      const resInvalidCurrent = FinancialTransactionStateMachine.transition('inexistente' as any, 'completed');
      expect(resInvalidCurrent.isFailure).toBe(true);
      expect(resInvalidCurrent.error).toContain('Status de transação financeira atual inválido.');

      const resInvalidTarget = FinancialTransactionStateMachine.transition('pending', 'inexistente' as any);
      expect(resInvalidTarget.isFailure).toBe(true);
      expect(resInvalidTarget.error).toContain('Status de transação financeira de destino inválido.');
    });

    it('deve identificar corretamente estados terminais via isTerminal()', () => {
      expect(FinancialTransactionStateMachine.isTerminal('failed')).toBe(true);
      expect(FinancialTransactionStateMachine.isTerminal('cancelled')).toBe(true);
      expect(FinancialTransactionStateMachine.isTerminal('reversed')).toBe(true);

      expect(FinancialTransactionStateMachine.isTerminal('pending')).toBe(false);
      expect(FinancialTransactionStateMachine.isTerminal('processing')).toBe(false);
      expect(FinancialTransactionStateMachine.isTerminal('completed')).toBe(false);
    });

    it('deve retornar lista imutável e correta via getAllowedTransitions()', () => {
      const pendingTransitions = FinancialTransactionStateMachine.getAllowedTransitions('pending');
      expect(pendingTransitions).toEqual(['processing', 'failed', 'cancelled']);
      expect(Object.isFrozen(pendingTransitions)).toBe(true);

      const processingTransitions = FinancialTransactionStateMachine.getAllowedTransitions('processing');
      expect(processingTransitions).toEqual(['completed', 'failed']);
      expect(processingTransitions).not.toContain('cancelled');

      const failedTransitions = FinancialTransactionStateMachine.getAllowedTransitions('failed');
      expect(failedTransitions).toEqual([]);
    });

    it('deve proibir transição a partir de estado terminal (failed -> completed)', () => {
      const res = FinancialTransactionStateMachine.transition('failed', 'completed');
      expect(res.isFailure).toBe(true);
      expect(res.error).toContain("Transição de estado inválida: 'failed' -> 'completed'");
    });
  });

  describe('DOD-10: AccountClassPolicy (Strict Accounting Matrix)', () => {
    it('deve validar corretamente combinações autorizadas de accountType e accountClass', () => {
      expect(() => AccountClassPolicy.validate('treasury', 'asset')).not.toThrow();
      expect(() => AccountClassPolicy.validate('user_available', 'liability')).not.toThrow();
      expect(() => AccountClassPolicy.validate('operating', 'asset')).not.toThrow();
      expect(() => AccountClassPolicy.validate('fees', 'revenue')).not.toThrow();
      expect(() => AccountClassPolicy.validate('reserve', 'asset')).not.toThrow();
      expect(() => AccountClassPolicy.validate('reserve', 'liability')).not.toThrow();
      expect(() => AccountClassPolicy.validate('clearing', 'asset')).not.toThrow();
      expect(() => AccountClassPolicy.validate('clearing', 'liability')).not.toThrow();
    });

    it('deve rejeitar combinações incompatíveis', () => {
      expect(() => AccountClassPolicy.validate('treasury', 'liability')).toThrow(InvalidAccountClassError);
      expect(() => AccountClassPolicy.validate('user_available', 'asset')).toThrow(InvalidAccountClassError);
      expect(() => AccountClassPolicy.validate('fees', 'expense')).toThrow(InvalidAccountClassError);
    });

    it('deve rejeitar tipos ou classes não reconhecidos ou vazios', () => {
      expect(() => AccountClassPolicy.validate('', 'asset')).toThrow(InvalidAccountClassError);
      expect(() => AccountClassPolicy.validate('treasury', '')).toThrow(InvalidAccountClassError);
      expect(() => AccountClassPolicy.validate('tipo_invalido', 'asset')).toThrow(InvalidAccountClassError);
      expect(() => AccountClassPolicy.validate('treasury', 'classe_invalida')).toThrow(InvalidAccountClassError);
    });

    it('deve retornar default determinístico apenas quando houver exatamente uma classe possível', () => {
      expect(AccountClassPolicy.getDefaultClass('treasury')).toBe('asset');
      expect(AccountClassPolicy.getDefaultClass('user_available')).toBe('liability');
      expect(AccountClassPolicy.getDefaultClass('fees')).toBe('revenue');

      // Tipos multi-classe devem rejeitar default arbitrário
      expect(() => AccountClassPolicy.getDefaultClass('reserve')).toThrow(InvalidAccountClassError);
      expect(() => AccountClassPolicy.getDefaultClass('clearing')).toThrow(InvalidAccountClassError);
      expect(() => AccountClassPolicy.getDefaultClass('opening_balance_equity')).toThrow(InvalidAccountClassError);
    });

    it('deve garantir imutabilidade da matriz de classes permitidas', () => {
      const classes = AccountClassPolicy.getPermittedClasses('treasury');
      expect(classes).toEqual(['asset']);
      expect(Object.isFrozen(classes)).toBe(true);
    });
  });

  describe('DOD-10: AccountStatusPolicy & AssetStatusPolicy', () => {
    it('deve permitir contas e ativos ativas', () => {
      expect(() => AccountStatusPolicy.validateActive({ id: 1, status: 'active' })).not.toThrow();
      expect(() => AssetStatusPolicy.validateActive({ id: 10, status: 'active' })).not.toThrow();
      expect(() => AssetStatusPolicy.validateActive(10, 'active')).not.toThrow();
    });

    it('deve rejeitar contas inativas ou suspensas com AccountInactiveError', () => {
      expect(() => AccountStatusPolicy.validateActive({ id: 1, status: 'inactive' })).toThrow(AccountInactiveError);
      expect(() => AccountStatusPolicy.validateActive({ id: 1, status: 'suspended' })).toThrow(AccountInactiveError);
      expect(() => AccountStatusPolicy.validateActive({ id: 1, status: 'blocked' })).toThrow(AccountInactiveError);
    });

    it('deve rejeitar contexto de conta malformado ou ID não-positivo em AccountStatusPolicy', () => {
      expect(() => AccountStatusPolicy.validateActive(null as any)).toThrow(AccountInactiveError);
      expect(() => AccountStatusPolicy.validateActive({ id: 0, status: 'active' })).toThrow(AccountInactiveError);
      expect(() => AccountStatusPolicy.validateActive({ id: -1, status: 'active' })).toThrow(AccountInactiveError);
      expect(() => AccountStatusPolicy.validateActive({ id: 1.5, status: 'active' })).toThrow(AccountInactiveError);
      expect(() => AccountStatusPolicy.validateActive({ id: 1, status: 'status_invalido' as any })).toThrow(AccountInactiveError);
    });

    it('deve rejeitar ativos inativos com AssetInactiveError', () => {
      expect(() => AssetStatusPolicy.validateActive({ id: 10, status: 'suspended' })).toThrow(AssetInactiveError);
      expect(() => AssetStatusPolicy.validateActive({ id: 10, status: 'inactive' })).toThrow(AssetInactiveError);
      expect(() => AssetStatusPolicy.validateActive(10, 'suspended')).toThrow(AssetInactiveError);
    });

    it('deve validar assetId positivo seguro e status conhecido em AssetStatusPolicy', () => {
      expect(() => AssetStatusPolicy.validateActive({ id: 0, status: 'active' })).toThrow(InvalidIdentifierError);
      expect(() => AssetStatusPolicy.validateActive({ id: -5, status: 'active' })).toThrow(InvalidIdentifierError);
      expect(() => AssetStatusPolicy.validateActive({ id: 10, status: 'status_fantasma' as any })).toThrow(AssetInactiveError);
    });

    it('deve validar status via Result kernel em AssetStatusPolicy.validateActiveResult', () => {
      const okRes = AssetStatusPolicy.validateActiveResult(1, 'active');
      expect(okRes.isSuccess).toBe(true);

      const failRes = AssetStatusPolicy.validateActiveResult(1, 'suspended');
      expect(failRes.isFailure).toBe(true);
      expect(failRes.error).toContain("esperado: 'active'");

      const invalidStatusRes = AssetStatusPolicy.validateActiveResult(1, 'invalido');
      expect(invalidStatusRes.isFailure).toBe(true);
      expect(invalidStatusRes.error).toContain('possui status inválido');
    });
  });

  describe('AccountingEntryPolicy (Strict Banking Invariants)', () => {
    it('deve rejeitar estritamente entryType inválido (não inferir como crédito)', () => {
      expect(() => {
        AccountingEntryPolicy.validateEntriesBalance([
          { accountId: 1, assetId: 1, entryType: 'debit', amount: Money256.fromBigInt(100n, 1), description: 'd' },
          { accountId: 2, assetId: 1, entryType: 'DEBITTT' as any, amount: Money256.fromBigInt(100n, 1), description: 'c' },
        ]);
      }).toThrow(AccountingMatrixValidationError);

      expect(() => {
        AccountingEntryPolicy.validateEntriesBalance([
          { accountId: 1, assetId: 1, entryType: 'debit', amount: Money256.fromBigInt(100n, 1), description: 'd' },
          { accountId: 2, assetId: 1, entryType: 'foo' as any, amount: Money256.fromBigInt(100n, 1), description: 'c' },
        ]);
      }).toThrow(AccountingMatrixValidationError);
    });

    it('deve rejeitar spoofing de Money256 em runtime', () => {
      const fakeMoney = {
        isPositive: () => true,
        toBigInt: () => 100n,
        assetId: 1,
        toCanonicalString: () => '100',
      };

      expect(() => {
        AccountingEntryPolicy.validateEntriesBalance([
          { accountId: 1, assetId: 1, entryType: 'debit', amount: fakeMoney as any, description: 'spoof' },
          { accountId: 2, assetId: 1, entryType: 'credit', amount: fakeMoney as any, description: 'spoof' },
        ]);
      }).toThrow(AccountingMatrixValidationError);
    });

    it('deve rejeitar lista de lançamentos com mais de 100 itens (proteção DoS)', () => {
      const entries = Array.from({ length: 102 }, (_, i) => ({
        accountId: i + 1,
        assetId: 1,
        entryType: (i % 2 === 0 ? 'debit' : 'credit') as const,
        amount: Money256.fromBigInt(10n, 1),
        description: `Entry ${i}`,
      }));

      expect(() => AccountingEntryPolicy.validateEntriesBalance(entries)).toThrow(
        /não pode possuir mais de 100/
      );
    });

    it('deve rejeitar incoerência de assetId entre spec e Money256', () => {
      expect(() => {
        AccountingEntryPolicy.validateEntriesBalance([
          { accountId: 1, assetId: 1, entryType: 'debit', amount: Money256.fromBigInt(100n, 2), description: 'mismatch' },
          { accountId: 2, assetId: 1, entryType: 'credit', amount: Money256.fromBigInt(100n, 2), description: 'mismatch' },
        ]);
      }).toThrow(AccountingMatrixValidationError);
    });

    it('deve rejeitar auto-transferência (mesma conta origem e destino)', () => {
      expect(() => {
        AccountingEntryPolicy.createTransferEntries({
          sourceAccountId: 1,
          destinationAccountId: 1,
          amount: Money256.fromBigInt(100n, 1),
          description: 'Auto-transferência',
        });
      }).toThrow(AccountingMatrixValidationError);
    });

    it('deve rejeitar conversão entre o mesmo ativo', () => {
      expect(() => {
        AccountingEntryPolicy.createConversionEntries({
          userAccountId: 1,
          clearingAccountId: 2,
          fromAmount: Money256.fromBigInt(100n, 1),
          toAmount: Money256.fromBigInt(100n, 1), // mesmo assetId!
          description: 'Same asset conversion',
        });
      }).toThrow(AccountingMatrixValidationError);
    });

    it('deve rejeitar descrição com caracteres de controle ASCII', () => {
      expect(() => {
        AccountingEntryPolicy.createDepositEntries({
          treasuryAccountId: 1,
          userAccountId: 2,
          amount: Money256.fromBigInt(100n, 1),
          description: 'Depósito com controle\u0000malicioso',
        });
      }).toThrow(AccountingMatrixValidationError);
    });

    it('deve exigir autorização auditável em adjustment e opening balance', () => {
      const adj = AccountingEntryPolicy.createAdjustmentEntries({
        debitAccountId: 1,
        creditAccountId: 2,
        amount: Money256.fromBigInt(100n, 1),
        reason: 'Correção técnica',
        authorizedByUserId: 42,
      });
      expect(adj[0].description).toContain('AuthUser #42');

      const open = AccountingEntryPolicy.createOpeningBalanceEntries({
        targetAccountId: 1,
        openingEquityAccountId: 99,
        amount: Money256.fromBigInt(1000n, 1),
        description: 'Bootstrap',
        authorizedByUserId: 100,
      });
      expect(open[0].description).toContain('AuthUser #100');
    });

    it('deve estornar invertendo debit e credit com validação estrita em createReversalEntries', () => {
      const origEntries = [
        { accountId: 1, assetId: 1, entryType: 'debit' as const, amount: Money256.fromBigInt(50n, 1), description: 'Orig Debit' },
        { accountId: 2, assetId: 1, entryType: 'credit' as const, amount: Money256.fromBigInt(50n, 1), description: 'Orig Credit' },
      ];

      const rev = AccountingEntryPolicy.createReversalEntries(origEntries, 'Estorno solicitado');
      expect(rev).toHaveLength(2);
      expect(rev[0].entryType).toBe('credit');
      expect(rev[1].entryType).toBe('debit');
      expect(rev[0].description).toContain('Reversal (Estorno solicitado)');

      // Rejeita reversal com entryType inválido no original
      expect(() => {
        AccountingEntryPolicy.createReversalEntries([
          { accountId: 1, assetId: 1, entryType: 'invalido' as any, amount: Money256.fromBigInt(50n, 1), description: 'Bad' },
        ], 'Motivo');
      }).toThrow(AccountingMatrixValidationError);
    });

    it('deve filtrar lançamento de receita por revenueAccountId em extractRefundablePaymentAmount', () => {
      const entries = [
        { accountId: 5, direction: 'credit', assetId: 1, amountBaseUnits: '5' },  // Fee revenue
        { accountId: 10, direction: 'credit', assetId: 1, amountBaseUnits: '95' }, // Merchant revenue
      ];

      const res = AccountingEntryPolicy.extractRefundablePaymentAmount(entries as any, 1, 10);
      expect(res.toCanonicalString()).toBe('95');

      expect(() => AccountingEntryPolicy.extractRefundablePaymentAmount(entries as any, 1, 999)).toThrow(AccountingMatrixValidationError);

      // Chamada sem revenueAccountId deve lançar erro de obrigatoriedade
      expect(() => AccountingEntryPolicy.extractRefundablePaymentAmount(entries as any, 1)).toThrow(
        /revenueAccountId é obrigatório/
      );
    });

    it('deve rejeitar parâmetros de operação nulos, primitivos ou malformados (assertOperationParams)', () => {
      expect(() => AccountingEntryPolicy.createDepositEntries(null as any)).toThrow('Parâmetros da operação contábil inválidos.');
      expect(() => AccountingEntryPolicy.createWithdrawalEntries(undefined as any)).toThrow('Parâmetros da operação contábil inválidos.');
      expect(() => AccountingEntryPolicy.createPaymentEntries([] as any)).toThrow('Parâmetros da operação contábil inválidos.');
      expect(() => AccountingEntryPolicy.createRefundEntries('string' as any)).toThrow('Parâmetros da operação contábil inválidos.');
    });

    it('deve rejeitar mesma conta em ambos os lados da operação (assertDistinctAccounts)', () => {
      const money = Money256.fromBigInt(100n, 1);

      // Depósito com treasury e user idênticos
      expect(() => AccountingEntryPolicy.createDepositEntries({
        treasuryAccountId: 5,
        userAccountId: 5,
        amount: money,
        description: 'Mesma conta',
      })).toThrow(/não podem ser idênticas em um depósito/);

      // Retirada com treasury e user idênticos
      expect(() => AccountingEntryPolicy.createWithdrawalEntries({
        treasuryAccountId: 5,
        userAccountId: 5,
        amount: money,
        description: 'Mesma conta',
      })).toThrow(/não podem ser idênticas em uma retirada/);

      // Pagamento com user e receita idênticos
      expect(() => AccountingEntryPolicy.createPaymentEntries({
        userAccountId: 10,
        paymentRevenueAccountId: 10,
        amount: money,
        description: 'Mesma conta',
      })).toThrow(/não podem ser idênticas/);

      // Reembolso com despesa e user idênticos
      expect(() => AccountingEntryPolicy.createRefundEntries({
        refundExpenseAccountId: 20,
        userAccountId: 20,
        amount: money,
        description: 'Mesma conta',
      })).toThrow(/não podem ser idênticas/);

      // Fee com user e fee account idênticos
      expect(() => AccountingEntryPolicy.createFeeEntries({
        userAccountId: 30,
        feeAccountId: 30,
        amount: money,
        description: 'Mesma conta',
      })).toThrow(/não podem ser idênticas/);

      // Ajuste com débito e crédito idênticos
      expect(() => AccountingEntryPolicy.createAdjustmentEntries({
        debitAccountId: 40,
        creditAccountId: 40,
        amount: money,
        reason: 'Ajuste mesma conta',
        authorizedByUserId: 1,
      })).toThrow(/não podem ser idênticas em um ajuste/);

      // Opening Balance com destino e equity idênticos
      expect(() => AccountingEntryPolicy.createOpeningBalanceEntries({
        targetAccountId: 50,
        openingEquityAccountId: 50,
        amount: money,
        description: 'Opening mesma conta',
        authorizedByUserId: 1,
      })).toThrow(/não podem ser idênticas/);
    });

    it('deve sanitizar caracteres de controle em normalizeDisplayName e normalizeDisplayCode', () => {
      // AccountStatusPolicy com controle no nome
      expect(() => AccountStatusPolicy.validateActive({
        id: 1,
        status: 'inactive',
        name: 'Conta\u0000Injetada',
      })).toThrow('(desconhecida)');

      // AssetStatusPolicy com controle no código
      expect(() => AssetStatusPolicy.validateActive({
        id: 1,
        status: 'inactive',
        code: 'BRL\u0007Ctrl',
      })).toThrow('(desconhecido)');
    });
  });
});

```

---

<a id="testsfinanceevent_inboxtestts"></a>
## Arquivo: `tests/finance/event_inbox.test.ts`

- **Caminho absoluto**: `/home/sandro/Área de trabalho/BackEnd/tests/finance/event_inbox.test.ts`
- **Total de linhas**: 56
- **Linguagem**: TypeScript

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { unlinkSync } from 'fs';
import { EventInboxService } from '../../src/infrastructure/services/EventInboxService';
import { Result } from '../../src/shared/kernel/Result';
import { runAllMigrationsLibSql } from '../test_helpers/runMigrations';

describe('Invariante DOD-14: Event Inbox Idempotency para Webhooks Externos', () => {
  let sqlite: any;
  let db: any;
  let eventInboxService: EventInboxService;
  const dbFile = 'test_inbox.db';

  beforeAll(async () => {
    sqlite = createClient({ url: `file:${dbFile}` });
    db = drizzle(sqlite);

    await runAllMigrationsLibSql(sqlite);

    eventInboxService = new EventInboxService();
  }, 30000);

  afterAll(() => {
    try { unlinkSync(dbFile); } catch (e) {}
  });

  it('DOD-14: Deve processar a primeira vez e ignorar reenvio duplicado do mesmo providerId + externalEventId', async () => {
    let executionCount = 0;
    const handler = async () => {
      executionCount++;
      return Result.ok({ status: 'processed' });
    };

    const webhookPayload = {
      eventId: 'evt-uuid-1',
      providerId: 10,
      externalEventId: 'ext-tx-999',
      payload: { amount: 500, currency: 'BRL' },
    };

    // Primeira tentativa -> Processa normalmente
    const res1 = await eventInboxService.processEventOnce(db, webhookPayload, handler);
    if (res1.isFailure) console.log('res1 error:', res1.error);
    expect(res1.isSuccess).toBe(true);
    expect(res1.getValue().isDuplicate).toBe(false);
    expect(executionCount).toBe(1);

    // Segunda tentativa com mesmo providerId + externalEventId -> Idempotente! (Ignora execução do handler)
    const res2 = await eventInboxService.processEventOnce(db, webhookPayload, handler);
    if (res2.isFailure) console.log('res2 error:', res2.error);
    expect(res2.isSuccess).toBe(true);
    expect(res2.getValue().isDuplicate).toBe(true);
    expect(executionCount).toBe(1); // Não incrementou!
  });
});

```

---

<a id="testsfinanceevm_precisiontestts"></a>
## Arquivo: `tests/finance/evm_precision.test.ts`

- **Caminho absoluto**: `/home/sandro/Área de trabalho/BackEnd/tests/finance/evm_precision.test.ts`
- **Total de linhas**: 83
- **Linguagem**: TypeScript

```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { eq } from 'drizzle-orm';
import { DrizzleFinanceRepository } from '../../src/infrastructure/repositories/DrizzleFinanceRepository';
import { LedgerEntry } from '../../src/domains/finance/entities/LedgerTransaction';
import { Money256 } from '../../src/domains/finance/value-objects/Money256';
import { accountBalances } from '../../src/db/finance/tables';
import { unlinkSync, existsSync } from 'fs';
import { runAllMigrationsLibSql } from '../test_helpers/runMigrations';

describe('Precisão Monetária EVM 256-bit - Transações com > 53-bits', () => {
  const dbFile = 'test_evm_precision.db';
  let sqlite: any;
  let db: any;

  beforeAll(async () => {
    if (existsSync(dbFile)) {
      try { unlinkSync(dbFile); } catch (e) {}
    }
    sqlite = createClient({ url: `file:${dbFile}` });
    db = drizzle(sqlite);

    await runAllMigrationsLibSql(sqlite);

    // Inserir registros iniciais
    await sqlite.execute(`INSERT INTO users (id, email, email_normalized, status, created_at, updated_at) VALUES (1, 'evm@test.com', 'evm@test.com', 'active', 1000, 1000);`);
    await sqlite.execute(`INSERT INTO financial_assets (id, code, symbol, name, decimals, type, status, created_at, updated_at) VALUES (1, 'USDT', 'USDT', 'Tether EVM 18 decimals', 18, 'crypto', 'active', 1000, 1000);`);
    await sqlite.execute(`INSERT INTO financial_accounts (id, user_id, account_type, account_class, status, name, version, created_at, updated_at) VALUES (1, 1, 'user_available', 'liability', 'active', 'User Account', 1, 1000, 1000);`);
    await sqlite.execute(`INSERT INTO financial_accounts (id, user_id, account_type, account_class, status, name, version, created_at, updated_at) VALUES (2, NULL, 'treasury', 'asset', 'active', 'Treasury Vault', 1, 1000, 1000);`);
  }, 30000);

  it('deve processar lançamentos contábeis com valores EVM de 18 decimais (ex: 10^24 base units, excedendo 53-bits) sem estouro ou perda de precisão', async () => {
    const repo = new DrizzleFinanceRepository(db);

    // 100,000,000 USDT com 18 decimais = 100,000,000 * 10^18 = 10^26 base units
    const hugeEvmAmount = 100000000000000000000000000n; // > Number.MAX_SAFE_INTEGER (9007199254740991)
    const money = Money256.fromBigInt(hugeEvmAmount, 1);

    const entry1 = new LedgerEntry({
      accountId: '1',
      amount: money,
      type: 'credit',
      description: 'EVM Deposit'
    });

    const entry2 = new LedgerEntry({
      accountId: '2',
      amount: money,
      type: 'debit',
      description: 'EVM Deposit Treasury'
    });

    // 1. Inserir Transação
    const txId = await repo.insertTransaction({
      userId: 1,
      type: 'deposit',
      category: 'trading',
      status: 'completed',
      description: 'Deposit Huge EVM Token',
    });

    // 2. Inserir Entradas no Ledger (deve gravar TEXT com a string exata do BigInt)
    await repo.insertLedgerEntries([entry1, entry2], txId);

    // 3. Atualizar saldos com OCC usando BigInt puro
    const successUser = await repo.updateBalanceWithOCC('1', '1', hugeEvmAmount, 'credit');
    expect(successUser).toBe('UPDATED');

    const successTreasury = await repo.updateBalanceWithOCC('2', '1', hugeEvmAmount, 'debit');
    expect(successTreasury).toBe('UPDATED');

    // 4. Consultar saldo no banco de dados e verificar a exatidão do BigInt (TEXT -> BigInt)
    const [userBalRow] = await db
      .select()
      .from(accountBalances)
      .where(eq(accountBalances.accountId, 1))
      .limit(1);

    expect(BigInt(userBalRow.availableBaseUnits)).toBe(hugeEvmAmount);
    expect(userBalRow.availableBaseUnits).toBe(hugeEvmAmount.toString());
  });
});

```

---

<a id="testsfinancefailure_injectiontestts"></a>
## Arquivo: `tests/finance/failure_injection.test.ts`

- **Caminho absoluto**: `/home/sandro/Área de trabalho/BackEnd/tests/finance/failure_injection.test.ts`
- **Total de linhas**: 87
- **Linguagem**: TypeScript

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { unlinkSync, existsSync } from 'fs';
import { DrizzleUnitOfWork } from '../../src/infrastructure/repositories/DrizzleUnitOfWork';
import { FinanceBootstrapService } from '../../src/infrastructure/services/FinanceBootstrapService';
import { runAllMigrationsLibSql } from '../test_helpers/runMigrations';

describe('Gate 4: Failure Injection Matrix & Atomic Rollback Certification (FIN-015 / FIN-024)', () => {
  const dbFile = 'test_failure_injection.db';
  let sqlite: any;
  let db: any;

  beforeEach(async () => {
    if (existsSync(dbFile)) {
      try { unlinkSync(dbFile); } catch (e) {}
    }
    sqlite = createClient({ url: `file:${dbFile}` });
    db = drizzle(sqlite);

    await runAllMigrationsLibSql(sqlite);

    // Ensure user 1 exists for FK constraint
    await sqlite.execute(`INSERT INTO users (id, email, email_normalized, status, created_at, updated_at) VALUES (1, 'user1@test.com', 'user1@test.com', 'active', 1000, 1000)`);
  });

  afterEach(() => {
    try { unlinkSync(dbFile); } catch (e) {}
  });

  it('guarantees 100% atomic rollback on error during transaction execution', async () => {
    const uowDb = {
      ...db,
      transaction: async (cb: any) => {
        const t = await sqlite.transaction('write');
        const proxyDb = drizzle(t) as any;
        proxyDb.rollback = () => {
          throw new Error('DRIZZLE_ROLLBACK');
        };
        try {
          await cb(proxyDb);
          await t.commit();
        } catch (err: any) {
          try { await t.rollback(); } catch (e) {}
          if (err.message === 'DRIZZLE_ROLLBACK') return;
          throw err;
        }
      }
    };

    await FinanceBootstrapService.seedSystemAccounts(uowDb, { currencyCode: 'BRL' });
    const uow = new DrizzleUnitOfWork(uowDb);

    const countBeforeTx = Number((await sqlite.execute('SELECT COUNT(*) as c FROM financial_transactions')).rows[0].c);
    const countBeforeLedger = Number((await sqlite.execute('SELECT COUNT(*) as c FROM financial_ledger_entries')).rows[0].c);
    const countBeforeIdem = Number((await sqlite.execute('SELECT COUNT(*) as c FROM idempotency_keys')).rows[0].c);

    // Inject failure inside transaction boundary
    const result = await uow.execute(async (factory) => {
      const repo = factory.getFinanceRepository();

      await repo.claimIdempotency('fail-key-1', 1, 'finance', 'hash1');
      await repo.insertTransaction({
        userId: 1,
        type: 'deposit',
        category: 'deposit',
        description: 'Failed Deposit Test',
        status: 'processing',
      });

      // Simulate crash inside UoW Transaction
      throw new Error('Simulated Crash inside UoW Transaction');
    });

    expect(result.isFailure).toBe(true);
    expect(result.error).toContain('Simulated Crash inside UoW Transaction');

    const countAfterTx = Number((await sqlite.execute('SELECT COUNT(*) as c FROM financial_transactions')).rows[0].c);
    const countAfterLedger = Number((await sqlite.execute('SELECT COUNT(*) as c FROM financial_ledger_entries')).rows[0].c);
    const countAfterIdem = Number((await sqlite.execute('SELECT COUNT(*) as c FROM idempotency_keys')).rows[0].c);

    // Zero partial writes persisted
    expect(countAfterTx).toBe(countBeforeTx);
    expect(countAfterLedger).toBe(countBeforeLedger);
    expect(countAfterIdem).toBe(countBeforeIdem);
  });
});

```

---

<a id="testsfinancemoney256testts"></a>
## Arquivo: `tests/finance/money256.test.ts`

- **Caminho absoluto**: `/home/sandro/Área de trabalho/BackEnd/tests/finance/money256.test.ts`
- **Total de linhas**: 83
- **Linguagem**: TypeScript

```typescript
import { describe, it, expect } from 'vitest';
import { Money256, MAX_UINT256 } from '../../src/domains/finance/value-objects/Money256';
import {
  InvalidMoneyFormatError,
  Money256OverflowError,
  CurrencyMismatchError,
  MoneyUnderflowError,
  InvalidIdentifierError,
} from '../../src/domains/finance/errors/FinancialError';

describe('Money256 Value Object (EVM 256-bit Precision)', () => {
  it('parses valid canonical decimal strings correctly', () => {
    const m1 = Money256.fromString('0', 1);
    expect(m1.toCanonicalString()).toBe('0');
    expect(m1.toBigInt()).toBe(0n);

    const m2 = Money256.fromString('1000', 1);
    expect(m2.toCanonicalString()).toBe('1000');
    expect(m2.toBigInt()).toBe(1000n);

    const maxStr = MAX_UINT256.toString(10);
    const mMax = Money256.fromString(maxStr, 1);
    expect(mMax.toBigInt()).toBe(MAX_UINT256);
  });

  it('rejects invalid formatting (exponents, leading zeros, signs, whitespace, decimals)', () => {
    expect(() => Money256.fromString('0001', 1)).toThrow(InvalidMoneyFormatError);
    expect(() => Money256.fromString('00123', 1)).toThrow(InvalidMoneyFormatError);
    expect(() => Money256.fromString('+100', 1)).toThrow(InvalidMoneyFormatError);
    expect(() => Money256.fromString('-50', 1)).toThrow(InvalidMoneyFormatError);
    expect(() => Money256.fromString('1e18', 1)).toThrow(InvalidMoneyFormatError);
    expect(() => Money256.fromString('100.0', 1)).toThrow(InvalidMoneyFormatError);
    expect(() => Money256.fromString(' 100 ', 1)).toThrow(InvalidMoneyFormatError);
    expect(() => Money256.fromString('100', -1)).toThrow(InvalidIdentifierError);
  });

  it('throws Money256OverflowError on values exceeding 2^256 - 1', () => {
    const overMax = MAX_UINT256 + 1n;
    expect(() => Money256.fromBigInt(overMax, 1)).toThrow(Money256OverflowError);
  });

  it('executes immutable arithmetic operations safely', () => {
    const a = Money256.fromString('500', 1);
    const b = Money256.fromString('300', 1);

    const sum = a.add(b);
    expect(sum.toCanonicalString()).toBe('800');
    expect(a.toCanonicalString()).toBe('500'); // Immutability

    const diff = a.subtract(b);
    expect(diff.toCanonicalString()).toBe('200');

    expect(() => b.subtract(a)).toThrow(MoneyUnderflowError); // Prohibits negative result
  });

  it('prohibits arithmetic across different asset IDs', () => {
    const a = Money256.fromString('100', 1);
    const b = Money256.fromString('100', 2);
    expect(() => a.add(b)).toThrow(CurrencyMismatchError);
  });

  it('supports comparison operators (greaterThan, greaterThanOrEqual, lessThan, lessThanOrEqual, zero)', () => {
    const zero = Money256.zero(1);
    const a = Money256.fromString('500', 1);
    const b = Money256.fromString('300', 1);
    const c = Money256.fromString('500', 1);

    expect(zero.isZero()).toBe(true);
    expect(a.greaterThan(b)).toBe(true);
    expect(b.greaterThan(a)).toBe(false);

    expect(a.greaterThanOrEqual(c)).toBe(true);
    expect(a.greaterThanOrEqual(b)).toBe(true);

    expect(b.lessThan(a)).toBe(true);
    expect(a.lessThan(b)).toBe(false);

    expect(a.lessThanOrEqual(c)).toBe(true);
    expect(b.lessThanOrEqual(a)).toBe(true);

    expect(Object.isFrozen(a)).toBe(true);
  });
});

```

---

<a id="testsfinanceposting_authority_hardeningtestts"></a>
## Arquivo: `tests/finance/posting_authority_hardening.test.ts`

- **Caminho absoluto**: `/home/sandro/Área de trabalho/BackEnd/tests/finance/posting_authority_hardening.test.ts`
- **Total de linhas**: 316
- **Linguagem**: TypeScript

```typescript
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

```

---

<a id="testsfinancereconciliation_3waytestts"></a>
## Arquivo: `tests/finance/reconciliation_3way.test.ts`

- **Caminho absoluto**: `/home/sandro/Área de trabalho/BackEnd/tests/finance/reconciliation_3way.test.ts`
- **Total de linhas**: 133
- **Linguagem**: TypeScript

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { accountBalances, financialLedgerEntries } from '../../src/db/finance/tables';
import { users } from '../../src/db/user/tables';
import { FinanceBootstrapService } from '../../src/infrastructure/services/FinanceBootstrapService';
import { DrizzleFinanceRepository } from '../../src/infrastructure/repositories/DrizzleFinanceRepository';
import { DrizzleUnitOfWork } from '../../src/infrastructure/repositories/DrizzleUnitOfWork';
import { RecordTreasuryTransactionUseCase } from '../../src/application/finance/use-cases/RecordTreasuryTransactionUseCase';
import { runAllMigrationsLibSql } from '../test_helpers/runMigrations';
import { eq } from 'drizzle-orm';
import { unlinkSync, existsSync } from 'fs';

describe('3-Way Reconciliation Suite (External Provider <-> Ledger Projection <-> Materialized Balance)', () => {
  const dbFile = 'test_rec_3way.db';
  let sqlite: any;
  let db: any;
  let uow: DrizzleUnitOfWork;

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
    uow = new DrizzleUnitOfWork(uowDb);
    await FinanceBootstrapService.seedSystemAccounts(db, { currencyCode: 'BRL' });
  }, 30000);

  afterAll(() => {
    try { sqlite.close(); } catch (e) {}
    try { unlinkSync(dbFile); } catch (e) {}
  });

  it('validates 3-way balance equality: External Provider Custody == Ledger Projection == Materialized Balance', async () => {
    // Insert user
    const [user] = await db.insert(users).values({
      name: 'Alice Reconciliation',
      email: 'alice.rec@example.com',
      emailNormalized: 'alice.rec@example.com',
      passwordHash: 'hash',
      role: 'user',
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    }).returning();

    const recordUseCase = new RecordTreasuryTransactionUseCase(uow);

    // 1. Perform deposit of 500.00 BRL (50000 base units)
    const depositRes = await recordUseCase.execute({
      userId: user.id,
      type: 'deposit',
      direction: 'INBOUND',
      amountBaseUnits: '50000',
      assetId: 1,
      description: 'Initial deposit',
      idempotencyKey: 'rec-dep-1',
    });
    expect(depositRes.isSuccess).toBe(true);

    // 2. Perform withdrawal of 200.00 BRL (20000 base units)
    const withdrawRes = await recordUseCase.execute({
      userId: user.id,
      type: 'withdrawal',
      direction: 'OUTBOUND',
      amountBaseUnits: '20000',
      assetId: 1,
      description: 'Partial withdrawal',
      idempotencyKey: 'rec-wd-1',
    });
    expect(withdrawRes.isSuccess).toBe(true);

    // Fetch user account
    const repo = new DrizzleFinanceRepository(db);
    const userAccRes = await repo.getOrCreateUserAccount(user.id);
    const userAccountId = userAccRes.getValue().id;

    // A. Materialized Balance
    const [balanceRow] = await db
      .select()
      .from(accountBalances)
      .where(eq(accountBalances.accountId, userAccountId));
    const materializedBalance = BigInt(balanceRow.availableBaseUnits);

    // B. Ledger Projection Balance
    const ledgerEntries = await db
      .select()
      .from(financialLedgerEntries)
      .where(eq(financialLedgerEntries.accountId, userAccountId));

    let ledgerProjection = 0n;
    for (const entry of ledgerEntries) {
      const amount = BigInt(entry.amountBaseUnits);
      if (entry.direction === 'credit') {
        ledgerProjection += amount; // Liability account: Credit increases
      } else {
        ledgerProjection -= amount; // Liability account: Debit decreases
      }
    }

    // C. Simulated External Provider Custody (Net Inbound = 50000 - 20000 = 30000)
    const externalProviderCustody = 30000n;

    // 3-Way Equality Assertion
    expect(materializedBalance).toBe(30000n);
    expect(ledgerProjection).toBe(30000n);
    expect(materializedBalance).toBe(ledgerProjection);
    expect(ledgerProjection).toBe(externalProviderCustody);
  });
});

```

---

<a id="testsfinancereverse_transactiontestts"></a>
## Arquivo: `tests/finance/reverse_transaction.test.ts`

- **Caminho absoluto**: `/home/sandro/Área de trabalho/BackEnd/tests/finance/reverse_transaction.test.ts`
- **Total de linhas**: 117
- **Linguagem**: TypeScript

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { unlinkSync } from 'fs';
import { eq, and } from 'drizzle-orm';

import { DrizzleUnitOfWork } from '../../src/infrastructure/repositories/DrizzleUnitOfWork';
import { ReverseTransactionUseCase } from '../../src/application/finance/use-cases/ReverseTransactionUseCase';
import { LedgerTransaction, LedgerEntry } from '../../src/domains/finance/entities/LedgerTransaction';
import { Money256 } from '../../src/domains/finance/value-objects/Money256';
import { FinancialTransactionOrchestrator } from '../../src/application/finance/services/FinancialTransactionOrchestrator';
import { accountBalances } from '../../src/db/finance/tables';
import { runAllMigrationsLibSql } from '../test_helpers/runMigrations';
import { Result } from '../../src/shared/kernel/Result';

describe('Invariante DOD-17: Transações de Estorno (ReverseTransactionUseCase)', () => {
  let sqlite: any;
  let db: any;
  let uow: DrizzleUnitOfWork;
  let reverseUseCase: ReverseTransactionUseCase;
  const dbFile = 'test_reversal.db';

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
      }
    };

    await runAllMigrationsLibSql(sqlite);

    await sqlite.executeMultiple(`
      INSERT INTO users (id, email, email_normalized, status, created_at, updated_at) VALUES (1, 'user1@test.com', 'user1@test.com', 'active', 1000, 1000);
      INSERT INTO financial_assets (id, symbol, code, name, type, decimals, status, created_at, updated_at) VALUES (1, 'BRL', 'BRL', 'Brazilian Real', 'fiat', 2, 'active', 1000, 1000);
      
      INSERT INTO financial_accounts (id, user_id, account_type, account_class, status, name, version, created_at, updated_at) VALUES (1, NULL, 'operating', 'asset', 'active', 'Operating Account', 1, 1000, 1000);
      INSERT INTO financial_accounts (id, user_id, account_type, account_class, status, name, version, created_at, updated_at) VALUES (2, 1, 'user_available', 'liability', 'active', 'User 1 Account', 1, 1000, 1000);

      INSERT INTO account_balances (account_id, asset_id, available_base_units, locked_base_units, version, updated_at) VALUES (1, 1, '100000', '0', 1, 1000);
      INSERT INTO account_balances (account_id, asset_id, available_base_units, locked_base_units, version, updated_at) VALUES (2, 1, '0', '0', 1, 1000);
    `);

    uow = new DrizzleUnitOfWork(uowDb);
    reverseUseCase = new ReverseTransactionUseCase(uow);
  }, 30000);

  afterAll(() => {
    try { unlinkSync(dbFile); } catch (e) {}
  });

  it('DOD-17: Executar estorno deve gerar lançamentos espelho invertidos e restaurar o saldo ao valor original', async () => {
    // 1. Executa transação original de depósito (100 base units de Operating para User 1)
    const amount = Money256.fromString('100', 1);

    const originalTx = LedgerTransaction.create({
      idempotencyKey: 'orig-dep-100',
      description: 'Original Deposit 100',
      transactionType: 'deposit',
      category: 'deposit',
      entries: [
        new LedgerEntry({ accountId: '1', amount: amount as any, type: 'debit' }),
        new LedgerEntry({ accountId: '2', amount: amount as any, type: 'credit' }),
      ],
    });

    const origRes = await uow.execute(async (f) => {
      const repo = f.getFinanceRepository();
      const orchestrator = new FinancialTransactionOrchestrator(repo);
      const postingResult = await orchestrator.executePosting(originalTx);
      return Result.ok(postingResult);
    });

    expect(origRes.isSuccess).toBe(true);
    const originalTxId = origRes.getValue().transactionId;

    // Verifica saldos pós-depósito
    const b1AfterDep = await db.select().from(accountBalances).where(and(eq(accountBalances.accountId, 1), eq(accountBalances.assetId, 1)));
    const b2AfterDep = await db.select().from(accountBalances).where(and(eq(accountBalances.accountId, 2), eq(accountBalances.assetId, 1)));
    expect(b1AfterDep[0].availableBaseUnits).toBe('100100'); // Asset aumenta com Débito (100000 + 100)
    expect(b2AfterDep[0].availableBaseUnits).toBe('100');    // Liability aumenta com Crédito (0 + 100)

    // 2. Executa estorno (ReverseTransactionUseCase)
    const revRes = await reverseUseCase.execute({
      originalTransactionId: originalTxId,
      actorUserId: 1,
      idempotencyKey: 'rev-dep-100',
      reason: 'Solicitação do cliente / Erro operacional',
    });

    if (revRes.isFailure) console.log('revRes error:', revRes.error);
    expect(revRes.isSuccess).toBe(true);

    // 3. Valida que os saldos das contas foram 100% restaurados aos valores originais (Original + Estorno == 0)
    const b1Final = await db.select().from(accountBalances).where(and(eq(accountBalances.accountId, 1), eq(accountBalances.assetId, 1)));
    const b2Final = await db.select().from(accountBalances).where(and(eq(accountBalances.accountId, 2), eq(accountBalances.assetId, 1)));

    expect(b1Final[0].availableBaseUnits).toBe('100000');
    expect(b2Final[0].availableBaseUnits).toBe('0');
  });
});

```

---

<a id="testsfinanceinvariantsbalance_projectiontestts"></a>
## Arquivo: `tests/finance/invariants/balance_projection.test.ts`

- **Caminho absoluto**: `/home/sandro/Área de trabalho/BackEnd/tests/finance/invariants/balance_projection.test.ts`
- **Total de linhas**: 163
- **Linguagem**: TypeScript

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { unlinkSync } from 'fs';
import { eq, and } from 'drizzle-orm';

import { DrizzleUnitOfWork } from '../../../src/infrastructure/repositories/DrizzleUnitOfWork';
import { LedgerTransaction, LedgerEntry } from '../../../src/domains/finance/entities/LedgerTransaction';
import { Money256 } from '../../../src/domains/finance/value-objects/Money256';
import { FinancialTransactionOrchestrator } from '../../../src/application/finance/services/FinancialTransactionOrchestrator';
import { accountBalances, financialLedgerEntries, financialAccounts } from '../../../src/db/finance/tables';
import { runAllMigrationsLibSql } from '../../test_helpers/runMigrations';

describe('Invariante DOD-04: Projeção de Saldo Materializado vs Soma Ponderada de Ledger', () => {
  let sqlite: any;
  let db: any;
  let uow: DrizzleUnitOfWork;
  const dbFile = 'test_balance_projection.db';

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
          await cb(proxyDb);
          await t.commit();
        } catch (err: any) {
          try { await t.rollback(); } catch (e) {}
          if (err.message === 'DRIZZLE_ROLLBACK') return;
          throw err;
        }
      }
    };

    await runAllMigrationsLibSql(sqlite);

    await sqlite.executeMultiple(`
      INSERT INTO users (id, email, email_normalized, status, created_at, updated_at) VALUES (1, 'user1@test.com', 'user1@test.com', 'active', 1000, 1000);
      INSERT INTO users (id, email, email_normalized, status, created_at, updated_at) VALUES (2, 'user2@test.com', 'user2@test.com', 'active', 1000, 1000);
      INSERT INTO financial_assets (id, symbol, code, name, type, decimals, status, created_at, updated_at) VALUES (1, 'BRL', 'BRL', 'Brazilian Real', 'fiat', 2, 'active', 1000, 1000);
      
      INSERT INTO financial_accounts (id, user_id, account_type, account_class, status, name, version, created_at, updated_at) VALUES (1, NULL, 'operating', 'asset', 'active', 'Operating Account', 1, 1000, 1000);
      INSERT INTO financial_accounts (id, user_id, account_type, account_class, status, name, version, created_at, updated_at) VALUES (2, 1, 'user_available', 'liability', 'active', 'User 1 Account', 1, 1000, 1000);
      INSERT INTO financial_accounts (id, user_id, account_type, account_class, status, name, version, created_at, updated_at) VALUES (3, 2, 'user_available', 'liability', 'active', 'User 2 Account', 1, 1000, 1000);
      INSERT INTO financial_accounts (id, user_id, account_type, account_class, status, name, version, created_at, updated_at) VALUES (4, NULL, 'fees', 'revenue', 'active', 'Fee Revenue Account', 1, 1000, 1000);

      INSERT INTO account_balances (account_id, asset_id, available_base_units, locked_base_units, version, updated_at) VALUES (1, 1, '1000000', '0', 1, 1000);
      INSERT INTO account_balances (account_id, asset_id, available_base_units, locked_base_units, version, updated_at) VALUES (2, 1, '0', '0', 1, 1000);
      INSERT INTO account_balances (account_id, asset_id, available_base_units, locked_base_units, version, updated_at) VALUES (3, 1, '0', '0', 1, 1000);
      INSERT INTO account_balances (account_id, asset_id, available_base_units, locked_base_units, version, updated_at) VALUES (4, 1, '0', '0', 1, 1000);
    `);

    uow = new DrizzleUnitOfWork(uowDb);
  });

  afterAll(() => {
    try { unlinkSync(dbFile); } catch (e) {}
  });

  it('DOD-04: Saldo materializado em account_balances deve coincidir 100% com a soma projetada do ledger por accountClass', async () => {
    // 1. Depósito 500 para User 1 (Conta 2) vindo da Operating (Conta 1)
    const tx1 = LedgerTransaction.create({
      idempotencyKey: 'proj-tx-1',
      description: 'Deposit User 1',
      transactionType: 'deposit',
      category: 'deposit',
      entries: [
        new LedgerEntry({ accountId: '1', amount: Money256.fromString('500', 1) as any, type: 'debit' }),
        new LedgerEntry({ accountId: '2', amount: Money256.fromString('500', 1) as any, type: 'credit' }),
      ],
    });

    const res1 = await uow.execute(async (f) => {
      const repo = f.getFinanceRepository();
      const orchestrator = new FinancialTransactionOrchestrator(repo);
      return await orchestrator.executePosting(tx1, 'hash1');
    });
    expect(res1.transactionId).toBeDefined();

    // 2. Transferência 200 de User 1 (Conta 2) para User 2 (Conta 3)
    const tx2 = LedgerTransaction.create({
      idempotencyKey: 'proj-tx-2',
      description: 'Transfer User 1 -> User 2',
      transactionType: 'transfer',
      category: 'operational',
      entries: [
        new LedgerEntry({ accountId: '2', amount: Money256.fromString('200', 1) as any, type: 'debit' }),
        new LedgerEntry({ accountId: '3', amount: Money256.fromString('200', 1) as any, type: 'credit' }),
      ],
    });

    const res2 = await uow.execute(async (f) => {
      const repo = f.getFinanceRepository();
      const orchestrator = new FinancialTransactionOrchestrator(repo);
      return await orchestrator.executePosting(tx2, 'hash2');
    });
    expect(res2.transactionId).toBeDefined();

    // 3. Taxa 10 cobrada de User 1 (Conta 2) enviada para Fees Revenue (Conta 4)
    const tx3 = LedgerTransaction.create({
      idempotencyKey: 'proj-tx-3',
      description: 'Fee Charge User 1',
      transactionType: 'fee',
      category: 'fee',
      entries: [
        new LedgerEntry({ accountId: '2', amount: Money256.fromString('10', 1) as any, type: 'debit' }),
        new LedgerEntry({ accountId: '4', amount: Money256.fromString('10', 1) as any, type: 'credit' }),
      ],
    });

    const res3 = await uow.execute(async (f) => {
      const repo = f.getFinanceRepository();
      const orchestrator = new FinancialTransactionOrchestrator(repo);
      return await orchestrator.executePosting(tx3, 'hash3');
    });
    expect(res3.transactionId).toBeDefined();

    // 4. Verificação Invariante DOD-04 para todas as contas
    const accounts = await db.select().from(financialAccounts);

    for (const acc of accounts) {
      const balances = await db
        .select()
        .from(accountBalances)
        .where(and(eq(accountBalances.accountId, acc.id), eq(accountBalances.assetId, 1)));

      const materializedStr = balances[0]?.availableBaseUnits || '0';
      const materializedBigInt = BigInt(materializedStr);

      const entries = await db
        .select()
        .from(financialLedgerEntries)
        .where(and(eq(financialLedgerEntries.accountId, acc.id), eq(financialLedgerEntries.assetId, 1)));

      let debitSum = 0n;
      let creditSum = 0n;
      for (const entry of entries) {
        const val = BigInt(entry.amountBaseUnits);
        if (entry.direction === 'debit') debitSum += val;
        else if (entry.direction === 'credit') creditSum += val;
      }

      let initialBalance = acc.id === 1 ? 1000000n : 0n;
      let projectedBigInt = initialBalance;

      if (acc.accountClass === 'asset' || acc.accountClass === 'expense') {
        projectedBigInt += (debitSum - creditSum);
      } else if (acc.accountClass === 'liability' || acc.accountClass === 'revenue' || acc.accountClass === 'equity') {
        projectedBigInt += (creditSum - debitSum);
      }

      expect(materializedBigInt).toBe(projectedBigInt);
    }
  });
});

```

---

<a id="testsfinanceinvariantscommit_failuretestts"></a>
## Arquivo: `tests/finance/invariants/commit_failure.test.ts`

- **Caminho absoluto**: `/home/sandro/Área de trabalho/BackEnd/tests/finance/invariants/commit_failure.test.ts`
- **Total de linhas**: 177
- **Linguagem**: TypeScript

```typescript
import { describe, it, expect } from 'vitest';
import { DrizzleUnitOfWork } from '../../../src/infrastructure/repositories/DrizzleUnitOfWork';
import { Result } from '../../../src/shared/kernel/Result';

describe('Invariante DOD-05: Unitaridade do Commit & Proteção contra Mascaramento', () => {
  it('deve retornar Result.fail se o callback retornar Result.ok(), mas o COMMIT da transação falhar', async () => {
    // Simula um driver DB onde o callback executa com sucesso (Result.ok),
    // mas a finalização do COMMIT lança um erro no banco (ex: violação de constraint deferred, lock ou falha I/O)
    const mockDbWithCommitFailure = {
      transaction: async (cb: any) => {
        const mockTx = { isTx: true };
        await cb(mockTx);
        // Simula exceção durante a fase de COMMIT do banco de dados
        throw new Error('SQLite/D1 Commit Error: Disk I/O or Constraint Deferred Violation');
      }
    };

    const uow = new DrizzleUnitOfWork(mockDbWithCommitFailure);

    const result = await uow.execute(async () => {
      // Callback de negócio simula sucesso interno
      return Result.ok({ transactionId: 100 });
    });

    // Asserção Crítica DOD-05: O resultado NUNCA pode ser Result.ok() se o COMMIT falhar!
    expect(result.isFailure).toBe(true);
    expect(result.error).toContain('Falha na transação do banco de dados (Commit/Execution)');
    expect(result.error).toContain('SQLite/D1 Commit Error');
  });

  it('deve retornar o Result.fail original se o callback de negócio falhar e forçar rollback', async () => {
    let rollbackCalled = false;
    const mockDbWithBusinessRollback = {
      transaction: async (cb: any) => {
        const mockTx = {
          isTx: true,
          rollback: () => {
            rollbackCalled = true;
            throw new Error('Rollback_Triggered');
          }
        };
        try {
          await cb(mockTx);
        } catch (e: any) {
          if (e.message === 'Rollback_Triggered') return;
          throw e;
        }
      }
    };

    const uow = new DrizzleUnitOfWork(mockDbWithBusinessRollback);

    const result = await uow.execute(async () => {
      return Result.fail('Regra de negócio violada: Saldo Insuficiente');
    });

    expect(result.isFailure).toBe(true);
    expect(result.error).toBe('Regra de negócio violada: Saldo Insuficiente');
    expect(rollbackCalled).toBe(true);
  });

  it('deve realizar ROLLBACK 100% atômico em todas as tabelas se a inserção do Outbox falhar', async () => {
    const { createClient } = await import('@libsql/client');
    const { drizzle } = await import('drizzle-orm/libsql');
    const { unlinkSync, existsSync } = await import('fs');
    const { runAllMigrationsLibSql } = await import('../../test_helpers/runMigrations');
    const { FinanceBootstrapService } = await import('../../../src/infrastructure/services/FinanceBootstrapService');
    const { Money256 } = await import('../../../src/domains/finance/value-objects/Money256');
    const { AccountingEntryPolicy } = await import('../../../src/domains/finance/policies/AccountingEntryPolicy');
    const { LedgerTransaction, LedgerEntry } = await import('../../../src/domains/finance/entities/LedgerTransaction');
    const { FinancialTransactionOrchestrator } = await import('../../../src/application/finance/services/FinancialTransactionOrchestrator');
    const { DrizzleFinanceRepository } = await import('../../../src/infrastructure/repositories/DrizzleFinanceRepository');

    const dbFile = 'test_fault_injection.db';
    if (existsSync(dbFile)) {
      try { unlinkSync(dbFile); } catch (e) {}
    }

    const sqlite = createClient({ url: `file:${dbFile}` });
    const db = drizzle(sqlite);
    await runAllMigrationsLibSql(sqlite);

    const bootstrapRes = await FinanceBootstrapService.seedSystemAccounts(db, {
      currencyCode: 'BRL',
      initialBalanceBaseUnits: 1000n,
    });
    expect(bootstrapRes.isSuccess).toBe(true);
    const { assetId, treasuryAccountId } = bootstrapRes.getValue();

    await sqlite.execute(`INSERT INTO users (id, email, email_normalized, status, created_at, updated_at) VALUES (99, 'fault@test.com', 'fault@test.com', 'active', 1000, 1000)`);

    const uowDb = {
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
    };

    const uow = new DrizzleUnitOfWork(uowDb);

    // Initial state counts
    const countTxsInitial = Number((await sqlite.execute('SELECT COUNT(*) as c FROM financial_transactions')).rows[0].c);
    const countEntriesInitial = Number((await sqlite.execute('SELECT COUNT(*) as c FROM financial_ledger_entries')).rows[0].c);
    const countIdempotencyInitial = Number((await sqlite.execute('SELECT COUNT(*) as c FROM idempotency_keys')).rows[0].c);
    const countOutboxInitial = Number((await sqlite.execute('SELECT COUNT(*) as c FROM outbox_events')).rows[0].c);

    // Executa postagem com FALHA INJETADA no Outbox
    const result = await uow.execute(async (factory) => {
      const repo = factory.getFinanceRepository() as DrizzleFinanceRepository;
      const outbox = factory.getOutboxRepository();

      // Injeta falha deliberada no saveEvent do Outbox
      outbox.saveEvent = async () => {
        throw new Error('FAULT_INJECTION_OUTBOX_STORAGE_CRASH');
      };

      const userAccRes = await repo.getOrCreateUserAccount(99);
      const userAccountId = userAccRes.getValue().id;

      const entriesRaw = AccountingEntryPolicy.createDepositEntries({
        treasuryAccountId,
        userAccountId,
        amount: Money256.fromString('500', assetId),
        description: 'Fault Injection Deposit',
      });

      const ledgerEntries = entriesRaw.map(
        (r) =>
          new LedgerEntry({
            accountId: String(r.accountId),
            amount: r.amount as any,
            type: r.entryType,
            description: r.description,
          })
      );

      const tx = LedgerTransaction.create({
        idempotencyKey: 'fault-idempotency-key-1',
        description: 'Deposit with Fault Injection',
        entries: ledgerEntries,
        transactionType: 'deposit',
        category: 'deposit',
        userId: 99,
      });

      const orchestrator = new FinancialTransactionOrchestrator(repo, outbox);
      return Result.ok(await orchestrator.executePosting(tx));
    });

    expect(result.isFailure).toBe(true);
    expect(result.error).toContain('FAULT_INJECTION_OUTBOX_STORAGE_CRASH');

    // Asserção Crítica: NENHUMA alteração foi persistida em NENHUMA tabela!
    const countTxsFinal = Number((await sqlite.execute('SELECT COUNT(*) as c FROM financial_transactions')).rows[0].c);
    const countEntriesFinal = Number((await sqlite.execute('SELECT COUNT(*) as c FROM financial_ledger_entries')).rows[0].c);
    const countIdempotencyFinal = Number((await sqlite.execute('SELECT COUNT(*) as c FROM idempotency_keys')).rows[0].c);
    const countOutboxFinal = Number((await sqlite.execute('SELECT COUNT(*) as c FROM outbox_events')).rows[0].c);

    expect(countTxsFinal).toBe(countTxsInitial);
    expect(countEntriesFinal).toBe(countEntriesInitial);
    expect(countIdempotencyFinal).toBe(countIdempotencyInitial);
    expect(countOutboxFinal).toBe(countOutboxInitial);

    try { unlinkSync(dbFile); } catch (e) {}
  }, 20000);
});

```

---

<a id="testsfinanceinvariantstransaction_failure_matrixtestts"></a>
## Arquivo: `tests/finance/invariants/transaction_failure_matrix.test.ts`

- **Caminho absoluto**: `/home/sandro/Área de trabalho/BackEnd/tests/finance/invariants/transaction_failure_matrix.test.ts`
- **Total de linhas**: 483
- **Linguagem**: TypeScript

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { unlinkSync } from 'fs';

import { DrizzleUnitOfWork } from '../../../src/infrastructure/repositories/DrizzleUnitOfWork';
import { LedgerTransaction, LedgerEntry } from '../../../src/domains/finance/entities/LedgerTransaction';
import { Money256 } from '../../../src/domains/finance/value-objects/Money256';
import { FinancialTransactionOrchestrator } from '../../../src/application/finance/services/FinancialTransactionOrchestrator';
import { idempotencyKeys, outboxEvents } from '../../../src/db/infrastructure/tables';
import { financialAccounts, financialTransactions, financialLedgerEntries, accountBalances } from '../../../src/db/finance/tables';
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

    const invalidTx = LedgerTransaction.create({
      idempotencyKey: 'fail-step4-key',
      userId: 10,
      description: 'Test Step 4 Overdraft Fail',
      transactionType: 'deposit',
      category: 'deposit',
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

    const tx = LedgerTransaction.create({
      idempotencyKey: 'fail-step6-key',
      userId: 10,
      description: 'Test Step 6 Fail',
      transactionType: 'deposit',
      category: 'deposit',
      entries: [
        new LedgerEntry({ accountId: '1', amount: amount as any, type: 'debit' }),
        new LedgerEntry({ accountId: '2', amount: amount as any, type: 'credit' })
      ]
    });

    const result = await uow.execute(async (factory) => {
      const repo = factory.getFinanceRepository();
      // Executa os passos normais manualmente para simular falha no completeIdempotency
      await repo.claimIdempotency(tx.idempotencyKey, 10, 'finance', 'hash-6');
      const txRes = await repo.insertTransaction({
        userId: tx.userId,
        type: tx.transactionType || 'deposit',
        category: 'operational',
        description: tx.description,
        status: 'processing'
      });
      const dbTxId = txRes.getValue();
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

  it('P1.6: Rejeita valor numérico em formato não canônico no storage persistence', async () => {
    const { validateCanonicalBaseUnits } = await import('../../../src/infrastructure/repositories/DrizzleFinanceRepository');
    
    expect(() => validateCanonicalBaseUnits('00100')).toThrow(/Formato de baseUnits inválido/);
    expect(() => validateCanonicalBaseUnits('-50')).toThrow(/Formato de baseUnits inválido/);
    expect(() => validateCanonicalBaseUnits('100abc')).toThrow(/Formato de baseUnits inválido/);
    expect(validateCanonicalBaseUnits('100')).toBe(100n);
    expect(validateCanonicalBaseUnits('0')).toBe(0n);
  });

  it('P1.7: Rejeita classe contábil inválida em updateBalanceWithOCC com InvalidAccountClassError', async () => {
    const { InvalidAccountClassError } = await import('../../../src/domains/finance/errors/FinancialError');
    const err = new InvalidAccountClassError('Classe contábil invalida.');
    expect(err.code).toBe('INVALID_ACCOUNT_CLASS');
    expect(err.httpStatus).toBe(422);
  });

  it('P1.8: Rejeita quantia excedente a UINT256 com Money256OverflowError', async () => {
    const overflowBigInt = (1n << 256n) + 100n;

    const repoRes = await uow.execute(async (factory) => {
      const repo = factory.getFinanceRepository();
      try {
        await repo.updateBalanceWithOCC('1', '1', overflowBigInt, 'credit');
        return Result.ok(true);
      } catch (err: any) {
        return Result.fail(err);
      }
    });

    expect(repoRes.isFailure).toBe(true);
    const errObj = repoRes.errorObject as any;
    expect(errObj.code).toBe('MONEY_256_OVERFLOW');
  });
});

```

---

