-- 0013_idempotency_fencing_and_snapshots.sql
-- Finance Core P0 Hardening: Distributed Fencing Tokens, Monotonic Lease Generation & Idempotency Response Snapshots

-- 1. Lease Owner (UUID v4 do worker detentor do lease)
ALTER TABLE idempotency_keys ADD COLUMN lease_owner text;--> statement-breakpoint

-- 2. Lease Generation (Fencing Token monotônico crescente contra stale workers / ABA)
ALTER TABLE idempotency_keys ADD COLUMN lease_generation integer NOT NULL DEFAULT 0;--> statement-breakpoint

-- 3. Idempotency Response Snapshot (Status e Payload HTTP original persistidos)
ALTER TABLE idempotency_keys ADD COLUMN response_status integer;--> statement-breakpoint
ALTER TABLE idempotency_keys ADD COLUMN response_payload text;--> statement-breakpoint

-- 4. Índice de performance para auditoria e controle de leases
CREATE INDEX IF NOT EXISTS idx_idempotency_keys_lease ON idempotency_keys (lease_owner, lease_generation);
