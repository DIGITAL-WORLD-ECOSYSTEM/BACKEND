-- 0009_finance_schema_alignment.sql
-- Canonical Hardening: Ingestion-First Model & Non-Destructive Accounting Alignment

-- 1. ALIGN financial_accounts DATA & INDEXES (Preserving physical FK integrity)
UPDATE `financial_accounts`
SET `account_class` = 'asset', `updated_at` = unixepoch() * 1000
WHERE `account_type` IN ('treasury', 'operating');--> statement-breakpoint

UPDATE `financial_accounts`
SET `account_class` = 'revenue', `updated_at` = unixepoch() * 1000
WHERE `account_type` = 'fees';--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `idx_financial_accounts_user` ON `financial_accounts` (`user_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_financial_accounts_type` ON `financial_accounts` (`account_type`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_financial_accounts_class` ON `financial_accounts` (`account_class`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_financial_accounts_status` ON `financial_accounts` (`status`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uq_financial_accounts_user_type_name` ON `financial_accounts` (`user_id`,`account_type`,`name`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uq_operating_active_singleton` ON `financial_accounts` (`account_type`) WHERE `account_type` = 'operating' AND `status` = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uq_fees_active_singleton` ON `financial_accounts` (`account_type`) WHERE `account_type` = 'fees' AND `status` = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uq_user_available_singleton` ON `financial_accounts` (`user_id`) WHERE `account_type` = 'user_available';--> statement-breakpoint

-- 2. ALIGN financial_transactions INDEXES (Preserving physical FK integrity)
CREATE INDEX IF NOT EXISTS `idx_financial_transactions_user` ON `financial_transactions` (`user_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_financial_transactions_type` ON `financial_transactions` (`type`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_financial_transactions_status` ON `financial_transactions` (`status`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_financial_transactions_created` ON `financial_transactions` (`created_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_financial_transactions_correlation` ON `financial_transactions` (`correlation_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_financial_transactions_refund_of` ON `financial_transactions` (`refund_of_transaction_id`);--> statement-breakpoint
DROP INDEX IF EXISTS `uq_financial_tx_single_reversal`;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uq_financial_tx_active_reversal` ON `financial_transactions` (`reversal_of_transaction_id`) WHERE `reversal_of_transaction_id` IS NOT NULL AND `status` NOT IN ('failed', 'cancelled');--> statement-breakpoint

-- 3. RECREATE fiat_external_transactions FOR INGESTION-FIRST (Empty staging table, no incoming FKs)
DROP TABLE IF EXISTS `fiat_external_transactions`;--> statement-breakpoint

CREATE TABLE `fiat_external_transactions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`provider_id` integer NOT NULL,
	`fiat_account_id` integer,
	`external_transaction_id` text NOT NULL,
	`raw_amount` text NOT NULL,
	`amount_base_units` text,
	`direction` text NOT NULL,
	`asset_id` integer,
	`raw_description` text,
	`bank_timestamp` integer,
	`document_number` text,
	`running_balance_base_units` text,
	`source_file` text,
	`source_file_hash` text,
	`row_fingerprint` text,
	`raw_payload` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`reconciliation_status` text DEFAULT 'unmatched' NOT NULL,
	`financial_transaction_id` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`settled_at` integer,
	FOREIGN KEY (`provider_id`) REFERENCES `fiat_providers`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`fiat_account_id`) REFERENCES `fiat_accounts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`asset_id`) REFERENCES `financial_assets`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`financial_transaction_id`) REFERENCES `financial_transactions`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ck_fiat_external_transaction_id_nonempty" CHECK(length(trim("external_transaction_id")) > 0),
	CONSTRAINT "ck_fiat_external_tx_direction" CHECK("direction" IN ('credit', 'debit')),
	CONSTRAINT "ck_fiat_external_tx_reconciliation_status" CHECK("reconciliation_status" IN ('unmatched', 'matched', 'ignored', 'discrepancy')),
	CONSTRAINT "ck_fiat_external_tx_status" CHECK("status" IN ('pending', 'processing', 'completed', 'failed', 'cancelled', 'reversed', 'unknown'))
);--> statement-breakpoint

CREATE UNIQUE INDEX `uq_fiat_external_transactions_provider_external` ON `fiat_external_transactions` (`provider_id`, `external_transaction_id`);--> statement-breakpoint
CREATE INDEX `idx_fiat_external_transactions_transaction` ON `fiat_external_transactions` (`financial_transaction_id`);--> statement-breakpoint
CREATE INDEX `idx_fiat_external_transactions_provider` ON `fiat_external_transactions` (`provider_id`);--> statement-breakpoint
CREATE INDEX `idx_fiat_external_transactions_fiat_account` ON `fiat_external_transactions` (`fiat_account_id`);--> statement-breakpoint
CREATE INDEX `idx_fiat_external_transactions_status` ON `fiat_external_transactions` (`status`);--> statement-breakpoint
CREATE INDEX `idx_fiat_external_transactions_recon_status` ON `fiat_external_transactions` (`reconciliation_status`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_fiat_external_transactions_fingerprint` ON `fiat_external_transactions` (`row_fingerprint`) WHERE `row_fingerprint` IS NOT NULL;
