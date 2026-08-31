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

      // Injeta falha deliberada no persistOutboxEvent
      repo.persistOutboxEvent = async () => {
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

      const tx = new LedgerTransaction({
        idempotencyKey: 'fault-idempotency-key-1',
        description: 'Deposit with Fault Injection',
        entries: ledgerEntries,
        transactionType: 'deposit',
        userId: 99,
      });

      const orchestrator = new FinancialTransactionOrchestrator(repo);
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
  });
});
