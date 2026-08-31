import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { runAllMigrations } from '../test_helpers/runMigrations';

describe('Gate 3: Migration Governance & Data Integrity Suite', () => {
  it('applies migrations 0000..0008 on clean database without errors', () => {
    const sqlite = new Database(':memory:');

    runAllMigrations(sqlite);

    // Verify partial unique indexes exist
    const indexes = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
      .all()
      .map((row: any) => row.name);

    expect(indexes).toContain('uq_operating_active_singleton');
    expect(indexes).toContain('uq_fees_active_singleton');
    expect(indexes).toContain('uq_financial_tx_single_reversal');
    expect(indexes).toContain('uq_user_available_singleton');

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
