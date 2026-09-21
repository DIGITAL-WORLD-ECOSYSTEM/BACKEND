import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database as SqliteDatabase } from 'better-sqlite3';
import { runAllMigrations } from '../test_helpers/runMigrations';
import * as fs from 'fs';
import * as path from 'path';

describe('Gate 0 / Schema Drift Certification: SQLite Físico vs Drizzle tables.ts', () => {
  let sqlite: SqliteDatabase;
  const tempDbPath = path.resolve(__dirname, '../../test_schema_drift.db');

  beforeEach(() => {
    if (fs.existsSync(tempDbPath)) {
      try { fs.unlinkSync(tempDbPath); } catch (e) {}
    }
    sqlite = new (require('better-sqlite3'))(tempDbPath);
    sqlite.pragma('foreign_keys = ON');
    runAllMigrations(sqlite);
  });

  afterEach(() => {
    try { sqlite.close(); } catch (e) {}
    if (fs.existsSync(tempDbPath)) {
      try { fs.unlinkSync(tempDbPath); } catch (e) {}
    }
  });

  it('1. valida que exchange_rates possui rate_numerator e rate_denominator e aboliu a coluna legada rate', () => {
    const columns = sqlite.pragma('table_info(exchange_rates)') as Array<{ name: string; type: string }>;
    const colNames = columns.map(c => c.name);

    expect(colNames).toContain('id');
    expect(colNames).toContain('base_asset_id');
    expect(colNames).toContain('quote_asset_id');
    expect(colNames).toContain('rate_numerator');
    expect(colNames).toContain('rate_denominator');
    expect(colNames).toContain('source');
    expect(colNames).toContain('quoted_at');

    // Coluna legada que usava CAST(... AS REAL) não pode mais existir no banco físico
    expect(colNames).not.toContain('rate');
  });

  it('2. valida que asset_conversions possui rate_numerator e rate_denominator e aboliu rate legada', () => {
    const columns = sqlite.pragma('table_info(asset_conversions)') as Array<{ name: string; type: string }>;
    const colNames = columns.map(c => c.name);

    expect(colNames).toContain('id');
    expect(colNames).toContain('financial_transaction_id');
    expect(colNames).toContain('from_asset_id');
    expect(colNames).toContain('to_asset_id');
    expect(colNames).toContain('from_amount_base_units');
    expect(colNames).toContain('to_amount_base_units');
    expect(colNames).toContain('rate_numerator');
    expect(colNames).toContain('rate_denominator');
    expect(colNames).toContain('fee_amount_base_units');
    expect(colNames).toContain('status');
    expect(colNames).toContain('completed_at');

    expect(colNames).not.toContain('rate');
  });

  it('3. valida enforcement físico de ck_financial_tx_completed_state em financial_transactions', () => {
    // Insere usuário dummy para FK
    sqlite.prepare(`
      INSERT INTO users (id, email, email_normalized)
      VALUES (1, 'audit@test.com', 'audit@test.com')
    `).run();

    // Cenário A: status 'completed' SEM completed_at deve falhar fisicamente
    expect(() => {
      sqlite.prepare(`
        INSERT INTO financial_transactions (user_id, type, category, status, description, version, created_at, updated_at, completed_at)
        VALUES (1, 'deposit', 'operational', 'completed', 'Test', 1, 1000, 1000, NULL)
      `).run();
    }).toThrow(/CHECK constraint failed/);

    // Cenário B: status não-completed SEM completed_at deve ter sucesso
    const pendingRes = sqlite.prepare(`
      INSERT INTO financial_transactions (user_id, type, category, status, description, version, created_at, updated_at, completed_at)
      VALUES (1, 'deposit', 'operational', 'pending', 'Test Pending', 1, 1000, 1000, NULL)
    `).run();
    expect(pendingRes.changes).toBe(1);

    // Cenário E: status 'completed' COM completed_at válido deve ter sucesso
    const insertRes = sqlite.prepare(`
      INSERT INTO financial_transactions (user_id, type, category, status, description, version, created_at, updated_at, completed_at)
      VALUES (1, 'deposit', 'operational', 'completed', 'Valid Completed', 1, 1000, 1000, 1000)
    `).run();
    expect(insertRes.changes).toBe(1);

    // Cenário F: status 'refunded' COM completed_at preservado deve ter sucesso
    const refundRes = sqlite.prepare(`
      INSERT INTO financial_transactions (user_id, type, category, status, description, version, created_at, updated_at, completed_at)
      VALUES (1, 'refund', 'operational', 'refunded', 'Valid Refunded', 1, 1000, 1000, 1000)
    `).run();
    expect(refundRes.changes).toBe(1);
  });

  it('4. valida que índices de exchange_rates e asset_conversions estão ativos no banco físico', () => {
    const rateIndexes = sqlite.prepare(`
      SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='exchange_rates'
    `).all() as Array<{ name: string }>;
    const rateIndexNames = rateIndexes.map(i => i.name);

    expect(rateIndexNames).toContain('idx_exchange_rates_pair');
    expect(rateIndexNames).toContain('idx_exchange_rates_quoted');
    expect(rateIndexNames).toContain('idx_exchange_rates_pair_quoted');

    const convIndexes = sqlite.prepare(`
      SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='asset_conversions'
    `).all() as Array<{ name: string }>;
    const convIndexNames = convIndexes.map(i => i.name);

    expect(convIndexNames).toContain('uq_asset_conversions_transaction');
    expect(convIndexNames).toContain('idx_asset_conversions_from_asset');
    expect(convIndexNames).toContain('idx_asset_conversions_to_asset');
  });
});
