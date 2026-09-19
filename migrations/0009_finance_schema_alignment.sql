-- 0009_finance_schema_alignment.sql
-- Canonical Hardening: Physical SQLite Constraints, Reversal Partial Index, and Ingestion-First Model

-- 1. RECREATE financial_accounts WITH ALL PHYSICAL CONSTRAINTS & INDEXES
CREATE TABLE `__new_financial_accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer,
	`account_type` text NOT NULL,
	`account_class` text DEFAULT 'liability' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`name` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ck_financial_accounts_name_nonempty" CHECK(length(trim("name")) > 0),
	CONSTRAINT "ck_financial_accounts_type" CHECK("account_type" IN ('user_available', 'treasury', 'operating', 'reserve', 'fees', 'escrow', 'reward_expense', 'yield_expense', 'clearing', 'opening_balance_equity', 'payment_revenue', 'refund_expense')),
	CONSTRAINT "ck_financial_accounts_class" CHECK("account_class" IN ('asset', 'liability', 'equity', 'revenue', 'expense')),
	CONSTRAINT "ck_financial_accounts_status" CHECK("status" IN ('active', 'inactive', 'suspended')),
	CONSTRAINT "ck_financial_accounts_type_class_matrix" CHECK(
		("account_type" = 'user_available' AND "account_class" = 'liability') OR
		("account_type" = 'treasury' AND "account_class" = 'asset') OR
		("account_type" = 'operating' AND "account_class" = 'asset') OR
		("account_type" = 'reserve' AND "account_class" IN ('asset', 'liability')) OR
		("account_type" = 'fees' AND "account_class" = 'revenue') OR
		("account_type" = 'escrow' AND "account_class" = 'liability') OR
		("account_type" = 'reward_expense' AND "account_class" = 'expense') OR
		("account_type" = 'yield_expense' AND "account_class" = 'expense') OR
		("account_type" = 'clearing' AND "account_class" IN ('asset', 'liability')) OR
		("account_type" = 'opening_balance_equity' AND "account_class" IN ('equity', 'liability')) OR
		("account_type" = 'payment_revenue' AND "account_class" = 'revenue') OR
		("account_type" = 'refund_expense' AND "account_class" = 'expense')
	),
	CONSTRAINT "ck_financial_accounts_owner_rule" CHECK(("account_type" = 'user_available' AND "user_id" IS NOT NULL) OR ("account_type" != 'user_available' AND "user_id" IS NULL)),
	CONSTRAINT "ck_financial_accounts_version" CHECK("version" > 0)
);--> statement-breakpoint

INSERT INTO `__new_financial_accounts`("id", "user_id", "account_type", "account_class", "status", "name", "version", "created_at", "updated_at")
SELECT "id", "user_id", "account_type", COALESCE("account_class", 'liability'), "status", "name", "version", "created_at", "updated_at" FROM `financial_accounts`;--> statement-breakpoint

DROP TABLE `financial_accounts`;--> statement-breakpoint
ALTER TABLE `__new_financial_accounts` RENAME TO `financial_accounts`;--> statement-breakpoint

CREATE INDEX `idx_financial_accounts_user` ON `financial_accounts` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_financial_accounts_type` ON `financial_accounts` (`account_type`);--> statement-breakpoint
CREATE INDEX `idx_financial_accounts_class` ON `financial_accounts` (`account_class`);--> statement-breakpoint
CREATE INDEX `idx_financial_accounts_status` ON `financial_accounts` (`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_financial_accounts_user_type_name` ON `financial_accounts` (`user_id`,`account_type`,`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_operating_active_singleton` ON `financial_accounts` (`account_type`) WHERE `account_type` = 'operating' AND `status` = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX `uq_fees_active_singleton` ON `financial_accounts` (`account_type`) WHERE `account_type` = 'fees' AND `status` = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX `uq_user_available_singleton` ON `financial_accounts` (`user_id`) WHERE `account_type` = 'user_available';--> statement-breakpoint

-- 2. RECREATE financial_transactions WITH STRICT DOMAIN TYPES & PARTIAL REVERSAL INDEX
CREATE TABLE `__new_financial_transactions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer,
	`reversal_of_transaction_id` integer,
	`refund_of_transaction_id` integer,
	`type` text NOT NULL,
	`category` text DEFAULT 'other' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`source_type` text,
	`source_id` text,
	`correlation_id` text,
	`description` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`reversal_of_transaction_id`) REFERENCES `financial_transactions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`refund_of_transaction_id`) REFERENCES `financial_transactions`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ck_financial_tx_type" CHECK("type" IN ('deposit', 'withdrawal', 'transfer', 'payment', 'refund', 'fee', 'reward', 'yield', 'conversion', 'adjustment', 'reversal')),
	CONSTRAINT "ck_financial_tx_category" CHECK("category" IN ('membership', 'rwa_yield', 'grant', 'operational', 'payment', 'trading', 'withdrawal', 'deposit', 'fee', 'other')),
	CONSTRAINT "ck_financial_tx_status" CHECK("status" IN ('pending', 'processing', 'completed', 'failed', 'cancelled', 'reversed', 'refunded')),
	CONSTRAINT "ck_financial_tx_source_type" CHECK("source_type" IS NULL OR "source_type" IN ('contribution', 'grant', 'membership', 'payroll', 'withdrawal', 'payment', 'conversion', 'system', 'other')),
	CONSTRAINT "ck_financial_tx_completed_state" CHECK("status" != 'completed' OR "completed_at" IS NOT NULL),
	CONSTRAINT "ck_financial_tx_dates" CHECK("completed_at" IS NULL OR "completed_at" >= "created_at"),
	CONSTRAINT "ck_financial_tx_version" CHECK("version" > 0)
);--> statement-breakpoint

INSERT INTO `__new_financial_transactions`("id", "user_id", "reversal_of_transaction_id", "refund_of_transaction_id", "type", "category", "status", "source_type", "source_id", "correlation_id", "description", "version", "created_at", "updated_at", "completed_at")
SELECT "id", "user_id", "reversal_of_transaction_id", "refund_of_transaction_id", "type", "category", "status", "source_type", "source_id", "correlation_id", "description", "version", "created_at", "updated_at", "completed_at" FROM `financial_transactions`;--> statement-breakpoint

DROP TABLE `financial_transactions`;--> statement-breakpoint
ALTER TABLE `__new_financial_transactions` RENAME TO `financial_transactions`;--> statement-breakpoint

CREATE INDEX `idx_financial_transactions_user` ON `financial_transactions` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_financial_transactions_type` ON `financial_transactions` (`type`);--> statement-breakpoint
CREATE INDEX `idx_financial_transactions_status` ON `financial_transactions` (`status`);--> statement-breakpoint
CREATE INDEX `idx_financial_transactions_created` ON `financial_transactions` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_financial_transactions_correlation` ON `financial_transactions` (`correlation_id`);--> statement-breakpoint
CREATE INDEX `idx_financial_transactions_refund_of` ON `financial_transactions` (`refund_of_transaction_id`);--> statement-breakpoint
DROP INDEX IF EXISTS `uq_financial_tx_single_reversal`;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_financial_tx_active_reversal` ON `financial_transactions` (`reversal_of_transaction_id`) WHERE `reversal_of_transaction_id` IS NOT NULL AND `status` NOT IN ('failed', 'cancelled');--> statement-breakpoint

-- 3. RECREATE fiat_external_transactions FOR INGESTION-FIRST
CREATE TABLE `__new_fiat_external_transactions` (
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

INSERT INTO `__new_fiat_external_transactions`("id", "provider_id", "external_transaction_id", "raw_amount", "amount_base_units", "direction", "asset_id", "raw_description", "bank_timestamp", "document_number", "running_balance_base_units", "source_file", "source_file_hash", "row_fingerprint", "raw_payload", "status", "reconciliation_status", "financial_transaction_id", "created_at", "updated_at", "settled_at")
SELECT "id", "provider_id", "external_transaction_id", '0', NULL, 'credit', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, "status", 'unmatched', "financial_transaction_id", "created_at", "updated_at", NULL FROM `fiat_external_transactions`;--> statement-breakpoint

DROP TABLE `fiat_external_transactions`;--> statement-breakpoint
ALTER TABLE `__new_fiat_external_transactions` RENAME TO `fiat_external_transactions`;--> statement-breakpoint

CREATE UNIQUE INDEX `uq_fiat_external_transactions_provider_external` ON `fiat_external_transactions` (`provider_id`, `external_transaction_id`);--> statement-breakpoint
CREATE INDEX `idx_fiat_external_transactions_transaction` ON `fiat_external_transactions` (`financial_transaction_id`);--> statement-breakpoint
CREATE INDEX `idx_fiat_external_transactions_provider` ON `fiat_external_transactions` (`provider_id`);--> statement-breakpoint
CREATE INDEX `idx_fiat_external_transactions_fiat_account` ON `fiat_external_transactions` (`fiat_account_id`);--> statement-breakpoint
CREATE INDEX `idx_fiat_external_transactions_status` ON `fiat_external_transactions` (`status`);--> statement-breakpoint
CREATE INDEX `idx_fiat_external_transactions_recon_status` ON `fiat_external_transactions` (`reconciliation_status`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_fiat_external_transactions_fingerprint` ON `fiat_external_transactions` (`row_fingerprint`) WHERE `row_fingerprint` IS NOT NULL;
