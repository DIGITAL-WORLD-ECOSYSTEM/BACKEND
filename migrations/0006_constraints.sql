-- 0006_constraints.sql
-- Forensic DDL Hardening: Physical Uniqueness, Singleton Invariants & Partial Indexes

-- 1. OAuth Provider Subject Uniqueness Index
CREATE UNIQUE INDEX IF NOT EXISTS uq_oauth_identities_provider_subject
ON oauth_identities (provider_id, provider_subject);

-- 2. Citizens Unique Canonical Username Index
CREATE UNIQUE INDEX IF NOT EXISTS uq_citizens_username
ON citizens (username) WHERE username IS NOT NULL;

-- 3. DID Single Active Primary per User Partial Unique Index
CREATE UNIQUE INDEX IF NOT EXISTS uq_did_user_active_primary
ON did_identities (user_id) WHERE is_primary = 1 AND status = 'active';

-- 4. Treasury Account Active Singleton Invariant
CREATE UNIQUE INDEX IF NOT EXISTS uq_treasury_active_singleton
ON financial_accounts (account_type) WHERE account_type = 'treasury' AND status = 'active';

-- 5. Idempotency Partial Unique Indexes (Authenticated vs Anonymous)
CREATE UNIQUE INDEX IF NOT EXISTS uq_idempotency_user_scope_key
ON idempotency_keys (user_id, scope, key) WHERE user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_idempotency_anon_scope_key
ON idempotency_keys (scope, key) WHERE user_id IS NULL;

-- 6. Event Consumer Receipt Unique Index
CREATE UNIQUE INDEX IF NOT EXISTS uq_consumer_event
ON event_consumer_receipts (consumer_id, event_id);

-- 7. Outbox Events Indexing
CREATE INDEX IF NOT EXISTS idx_outbox_events_published ON outbox_events (published);
CREATE INDEX IF NOT EXISTS idx_outbox_events_lease ON outbox_events (lease_expires_at);
