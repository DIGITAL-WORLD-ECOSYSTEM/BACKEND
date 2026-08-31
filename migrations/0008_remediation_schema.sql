-- 0008_remediation_schema.sql
-- Financial Accounts Singletons, Account Class & Constraints
ALTER TABLE `financial_accounts` ADD COLUMN `account_class` text NOT NULL DEFAULT 'liability';

CREATE UNIQUE INDEX IF NOT EXISTS `uq_operating_active_singleton` ON `financial_accounts` (`account_type`) WHERE `account_type` = 'operating' AND `status` = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS `uq_fees_active_singleton` ON `financial_accounts` (`account_type`) WHERE `account_type` = 'fees' AND `status` = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS `uq_user_available_singleton` ON `financial_accounts` (`user_id`) WHERE `account_type` = 'user_available';

-- Financial Transactions Reversal & Refund Columns & Constraints
ALTER TABLE `financial_transactions` ADD COLUMN `reversal_of_transaction_id` INTEGER;
ALTER TABLE `financial_transactions` ADD COLUMN `refund_of_transaction_id` INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS `uq_financial_tx_single_reversal` ON `financial_transactions` (`reversal_of_transaction_id`) WHERE `reversal_of_transaction_id` IS NOT NULL;

-- Idempotency Keys Enhanced Fields
ALTER TABLE `idempotency_keys` ADD COLUMN `updated_at` integer;

-- Event Inbox Enhanced Fields (FIN-014, FIN-015, FIN-021)
ALTER TABLE `event_inbox` ADD COLUMN `payload_hash` text NOT NULL DEFAULT '';
ALTER TABLE `event_inbox` ADD COLUMN `event_type` text;
ALTER TABLE `event_inbox` ADD COLUMN `status` text NOT NULL DEFAULT 'pending';
ALTER TABLE `event_inbox` ADD COLUMN `lease_owner` text;
ALTER TABLE `event_inbox` ADD COLUMN `lease_generation` integer NOT NULL DEFAULT 0;
ALTER TABLE `event_inbox` ADD COLUMN `lease_expires_at` integer;
ALTER TABLE `event_inbox` ADD COLUMN `attempts` integer NOT NULL DEFAULT 0;
ALTER TABLE `event_inbox` ADD COLUMN `last_error` text;
ALTER TABLE `event_inbox` ADD COLUMN `processing_started_at` integer;
ALTER TABLE `event_inbox` ADD COLUMN `created_at` integer;

CREATE INDEX IF NOT EXISTS `idx_event_inbox_status` ON `event_inbox` (`status`);
CREATE INDEX IF NOT EXISTS `idx_event_inbox_lease` ON `event_inbox` (`lease_expires_at`);

-- Outbox Events Enhanced Fields for Drizzle ORM Schema
ALTER TABLE `outbox_events` ADD COLUMN `status` text NOT NULL DEFAULT 'pending';
ALTER TABLE `outbox_events` ADD COLUMN `lease_owner` text;
ALTER TABLE `outbox_events` ADD COLUMN `lease_generation` integer NOT NULL DEFAULT 0;
ALTER TABLE `outbox_events` ADD COLUMN `lease_expires_at` integer;

CREATE INDEX IF NOT EXISTS `idx_outbox_events_status` ON `outbox_events` (`status`);
CREATE INDEX IF NOT EXISTS `idx_outbox_events_lease` ON `outbox_events` (`lease_expires_at`);
