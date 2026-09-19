import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { runAllMigrations } from '../test_helpers/runMigrations';

describe('Gate 3: Migration Governance & Data Integrity Suite', () => {
  it('applies migrations 0000..0009 on clean database without errors and enforces physical invariants', () => {
    const sqlite = new Database(':memory:');

    runAllMigrations(sqlite);

    // Verify partial unique indexes exist
    const indexes = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
      .all()
      .map((row: any) => row.name);

    expect(indexes).toContain('uq_operating_active_singleton');
    expect(indexes).toContain('uq_fees_active_singleton');
    expect(indexes).toContain('uq_financial_tx_active_reversal');
    expect(indexes).toContain('uq_user_available_singleton');
    expect(indexes).toContain('uq_fiat_external_transactions_fingerprint');

    // Verify financial_accounts has account_class
    const finAccountCols = sqlite
      .prepare("PRAGMA table_info('financial_accounts')")
      .all()
      .map((col: any) => col.name);
    expect(finAccountCols).toContain('account_class');

    // Verify financial_accounts enforces type-class matrix physically
    expect(() => {
      sqlite.exec(`
        INSERT INTO financial_accounts (id, user_id, account_type, account_class, status, name, version, created_at, updated_at)
        VALUES (9999, 1, 'user_available', 'asset', 'active', 'Invalid Account', 1, unixepoch(), unixepoch());
      `);
    }).toThrow(/CHECK constraint failed/);

    // Verify financial_transactions rejects legacy inbound/outbound
    expect(() => {
      sqlite.exec(`
        INSERT INTO financial_transactions (id, type, description, version, created_at, updated_at)
        VALUES (9999, 'inbound', 'Invalid Type', 1, unixepoch(), unixepoch());
      `);
    }).toThrow(/CHECK constraint failed/);

    // Verify financial_transactions has reversal and refund tracking
    const finTxCols = sqlite
      .prepare("PRAGMA table_info('financial_transactions')")
      .all()
      .map((col: any) => col.name);
    expect(finTxCols).toContain('reversal_of_transaction_id');
    expect(finTxCols).toContain('refund_of_transaction_id');

    // Verify fiat_external_transactions columns for ingestion-first
    const fiatExtCols = sqlite
      .prepare("PRAGMA table_info('fiat_external_transactions')")
      .all()
      .map((col: any) => col.name);
    expect(fiatExtCols).toContain('raw_amount');
    expect(fiatExtCols).toContain('amount_base_units');
    expect(fiatExtCols).toContain('direction');
    expect(fiatExtCols).toContain('fiat_account_id');
    expect(fiatExtCols).toContain('source_file_hash');
    expect(fiatExtCols).toContain('row_fingerprint');
    expect(fiatExtCols).toContain('reconciliation_status');

    // Verify account_balances does NOT contain created_at (P0-03 governance invariant)
    const accBalCols = sqlite
      .prepare("PRAGMA table_info('account_balances')")
      .all()
      .map((col: any) => col.name);
    expect(accBalCols).not.toContain('created_at');
    expect(accBalCols).toContain('updated_at');

    // Verify auth_challenges has context and transaction_id
    const authChallengeCols = sqlite
      .prepare("PRAGMA table_info('auth_challenges')")
      .all()
      .map((col: any) => col.name);
    expect(authChallengeCols).toContain('context');
    expect(authChallengeCols).toContain('transaction_id');

    sqlite.close();
  });

  it('preserves exact BigInt numerical equality during data migration', () => {
    const sqlite = new Database(':memory:');

    // Create legacy table with integer column
    sqlite.exec(`
      CREATE TABLE test_ledger (
        id INTEGER PRIMARY KEY,
        amount_legacy INTEGER NOT NULL
      );
    `);

    const originalValues = [
      0n,
      1n,
      9007199254740991n, // MAX_SAFE_INTEGER
      10000000000000000n,
    ];

    const insertStmt = sqlite.prepare('INSERT INTO test_ledger (id, amount_legacy) VALUES (?, ?)');
    originalValues.forEach((val, idx) => {
      insertStmt.run(idx + 1, Number(val));
    });

    // Migration transformation step to TEXT
    sqlite.exec(`
      ALTER TABLE test_ledger ADD COLUMN amount_text TEXT;
      UPDATE test_ledger SET amount_text = CAST(amount_legacy AS TEXT);
    `);

    const rows = sqlite.prepare('SELECT id, amount_legacy, amount_text FROM test_ledger').all();
    for (let i = 0; i < originalValues.length; i++) {
      const expectedBigInt = originalValues[i];
      const convertedBigInt = BigInt(rows[i].amount_text);
      expect(convertedBigInt).toBe(expectedBigInt); // FIN-023
    }

    sqlite.close();
  });
});
