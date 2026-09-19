import { describe, it, expect, beforeAll } from 'vitest';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { FinanceBootstrapService } from '../../src/infrastructure/services/FinanceBootstrapService';
import { DrizzleFinanceRepository } from '../../src/infrastructure/repositories/DrizzleFinanceRepository';
import { DrizzleUnitOfWork } from '../../src/infrastructure/repositories/DrizzleUnitOfWork';
import { unlinkSync, existsSync } from 'fs';

import { runAllMigrationsLibSql } from '../test_helpers/runMigrations';

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

    // Executa as migrations oficiais
    await runAllMigrationsLibSql(sqlite);

    // Inserir usuário inicial
    await sqlite.execute(`INSERT INTO users (id, subject_type, email, email_normalized, status, auth_epoch, created_at, updated_at) VALUES (1, 'human', 'admin@example.com', 'admin@example.com', 'active', 1, unixepoch(), unixepoch());`);
  }, 30000);

  it('deve inicializar com sucesso o banco e provisionar contas de Tesouraria, Operacional e Fee', async () => {
    const repo = new DrizzleFinanceRepository(db);
    const uow = new DrizzleUnitOfWork(db);

    // 1. Antes do bootstrap, getTreasuryAccount deve falhar
    const initialGet = await repo.getTreasuryAccount();
    expect(initialGet.isFailure).toBe(true);
    expect(initialGet.error).toContain('Treasury account not found');

    // 2. Executar bootstrap
    const seedRes = await FinanceBootstrapService.seedSystemAccounts(uow, {
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

    // 4. Executar bootstrap uma segunda vez com os mesmos parâmetros (idempotência)
    const seedRes2 = await FinanceBootstrapService.seedSystemAccounts(uow, {
      currencyCode: 'BRL',
      initialBalanceBaseUnits: 1000000n,
    });
    expect(seedRes2.isSuccess).toBe(true);

    // 5. Verificar que o saldo da tesouraria permanece exatamente 1000000n (não duplicou)
    const balances = await repo.getTreasuryBalance();
    expect(balances.isSuccess).toBe(true);
    const brlBalance = balances.getValue().find((b) => b.assetId === data.assetId);
    expect(brlBalance?.availableBaseUnits).toBe('1000000');
  }, 30000);
});
