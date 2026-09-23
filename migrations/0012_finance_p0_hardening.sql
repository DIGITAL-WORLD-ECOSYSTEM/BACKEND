-- 0012_finance_p0_hardening.sql
-- Finance Core P0 Hardening: Forensic Timestamps, Structural Leg Ordinal, SQL Assertions, System Routes & Ledger Immutability

-- 1. Forensic Timestamps on financial_transactions
ALTER TABLE financial_transactions ADD COLUMN reversed_at integer;--> statement-breakpoint
ALTER TABLE financial_transactions ADD COLUMN refunded_at integer;--> statement-breakpoint

-- 2. Structural Ledger Leg Ordinal (P1-14)
ALTER TABLE financial_ledger_entries ADD COLUMN entry_ordinal integer NOT NULL DEFAULT 0;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_ledger_entry_ordinal ON financial_ledger_entries (transaction_id, entry_ordinal);--> statement-breakpoint

-- 3. SQL Mutation-Count Assertion Guard Table (Gate 11 / PLAN-02)
CREATE TABLE IF NOT EXISTS _sql_assertions (
  id integer PRIMARY KEY CHECK (id = 1),
  guard integer NOT NULL CHECK (guard = 1)
);--> statement-breakpoint

-- 4. System Account Routes Table (Gate 13 / P1-10)
CREATE TABLE IF NOT EXISTS system_account_routes (
  id integer PRIMARY KEY AUTOINCREMENT,
  account_type text NOT NULL,
  provider_id integer REFERENCES fiat_providers(id) ON DELETE RESTRICT,
  account_id integer NOT NULL REFERENCES financial_accounts(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at integer NOT NULL DEFAULT (unixepoch())
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS uq_system_route_provider ON system_account_routes (account_type, provider_id) WHERE status = 'active' AND provider_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_system_route_global ON system_account_routes (account_type) WHERE status = 'active' AND provider_id IS NULL;--> statement-breakpoint

-- 5. Physical SQLite Append-Only Triggers for Ledger Entries (Gate 5)
CREATE TRIGGER IF NOT EXISTS trg_ledger_entries_no_update
BEFORE UPDATE ON financial_ledger_entries
BEGIN
  SELECT RAISE(ABORT, 'LEDGER_IS_APPEND_ONLY: Atualizações em lançamentos contábeis são proibidas.');
END;--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS trg_ledger_entries_no_delete
BEFORE DELETE ON financial_ledger_entries
BEGIN
  SELECT RAISE(ABORT, 'LEDGER_IS_APPEND_ONLY: Exclusões de lançamentos contábeis são proibidas.');
END;
