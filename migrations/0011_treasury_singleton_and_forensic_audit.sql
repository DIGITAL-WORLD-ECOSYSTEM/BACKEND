-- 0011_treasury_singleton_and_forensic_audit.sql
-- Forensic DDL Hardening: Treasury Active Singleton Invariant & Forensic Audit Lineage

-- 1. Forensic Deduplication of Active Treasury Accounts:
-- Retain the canonical active treasury (minimum ID) and deactivate any duplicates in an auditable way.
UPDATE financial_accounts
SET status = 'inactive',
    name = name || ' [MIGRATED_DUPLICATE_0011]',
    updated_at = unixepoch() * 1000
WHERE account_type = 'treasury'
  AND status = 'active'
  AND id > (SELECT MIN(id) FROM financial_accounts WHERE account_type = 'treasury' AND status = 'active');--> statement-breakpoint

-- 2. Restore active treasury singleton partial unique index (dropped in migration 0009)
CREATE UNIQUE INDEX IF NOT EXISTS uq_treasury_active_singleton
ON financial_accounts (account_type) WHERE account_type = 'treasury' AND status = 'active';--> statement-breakpoint

-- 3. Forensic Lineage & Audit Columns on financial_transactions
ALTER TABLE financial_transactions ADD COLUMN actor_user_id integer REFERENCES users(id);--> statement-breakpoint
ALTER TABLE financial_transactions ADD COLUMN authorized_by_user_id integer REFERENCES users(id);
