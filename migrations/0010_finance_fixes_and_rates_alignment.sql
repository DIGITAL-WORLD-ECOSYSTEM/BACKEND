-- MIGRATION 0010: CANONICAL SCHEMA ALIGNMENT & FX DEFINITIVE CLOSING
-- 1. Recria exchange_rates com rate_numerator e rate_denominator (sem REAL/FLOAT/CAST AS REAL)
-- 2. Recria asset_conversions com rate_numerator e rate_denominator e constraints uint256

-- 1. RECREATE exchange_rates COM rate_numerator E rate_denominator CANÔNICOS
CREATE TABLE `__new_exchange_rates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`base_asset_id` integer NOT NULL,
	`quote_asset_id` integer NOT NULL,
	`rate_numerator` text NOT NULL,
	`rate_denominator` text NOT NULL,
	`source` text NOT NULL,
	`quoted_at` integer NOT NULL,
	`expires_at` integer,
	FOREIGN KEY (`base_asset_id`) REFERENCES `financial_assets`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`quote_asset_id`) REFERENCES `financial_assets`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ck_exchange_rates_different_assets" CHECK("base_asset_id" <> "quote_asset_id"),
	CONSTRAINT "ck_exchange_rates_numerator_canonical" CHECK("rate_numerator" GLOB '[0-9]*' AND "rate_numerator" NOT GLOB '0[0-9]*' AND length("rate_numerator") > 0 AND length("rate_numerator") <= 78),
	CONSTRAINT "ck_exchange_rates_denominator_canonical" CHECK("rate_denominator" GLOB '[0-9]*' AND "rate_denominator" NOT GLOB '0[0-9]*' AND length("rate_denominator") > 0 AND length("rate_denominator") <= 78),
	CONSTRAINT "ck_exchange_rates_source_nonempty" CHECK(length(trim("source")) > 0),
	CONSTRAINT "ck_exchange_rates_expires_after_quoted" CHECK("expires_at" IS NULL OR "expires_at" >= "quoted_at")
);--> statement-breakpoint

DROP TABLE IF EXISTS `exchange_rates`;--> statement-breakpoint
ALTER TABLE `__new_exchange_rates` RENAME TO `exchange_rates`;--> statement-breakpoint

CREATE INDEX `idx_exchange_rates_pair_quoted` ON `exchange_rates` (`base_asset_id`,`quote_asset_id`,`quoted_at`);--> statement-breakpoint
CREATE INDEX `idx_exchange_rates_pair` ON `exchange_rates` (`base_asset_id`,`quote_asset_id`);--> statement-breakpoint
CREATE INDEX `idx_exchange_rates_quoted` ON `exchange_rates` (`quoted_at`);--> statement-breakpoint
CREATE INDEX `idx_exchange_rates_expires` ON `exchange_rates` (`expires_at`);--> statement-breakpoint

-- 2. RECREATE asset_conversions COM rate_numerator E rate_denominator CANÔNICOS
CREATE TABLE `__new_asset_conversions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`financial_transaction_id` integer NOT NULL,
	`from_asset_id` integer NOT NULL,
	`to_asset_id` integer NOT NULL,
	`from_amount_base_units` text NOT NULL,
	`to_amount_base_units` text NOT NULL,
	`rate_numerator` text NOT NULL,
	`rate_denominator` text NOT NULL,
	`rate_source` text,
	`source_exchange_rate_id` integer,
	`quoted_at` integer,
	`fee_asset_id` integer,
	`fee_amount_base_units` text DEFAULT '0' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`financial_transaction_id`) REFERENCES `financial_transactions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`from_asset_id`) REFERENCES `financial_assets`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`to_asset_id`) REFERENCES `financial_assets`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`source_exchange_rate_id`) REFERENCES `exchange_rates`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`fee_asset_id`) REFERENCES `financial_assets`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ck_asset_conversions_status" CHECK("status" IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),
	CONSTRAINT "ck_asset_conversions_from_amount_canonical" CHECK("from_amount_base_units" GLOB '[0-9]*' AND "from_amount_base_units" NOT GLOB '0[0-9]*' AND length("from_amount_base_units") > 0 AND length("from_amount_base_units") <= 78),
	CONSTRAINT "ck_asset_conversions_to_amount_canonical" CHECK("to_amount_base_units" GLOB '[0-9]*' AND "to_amount_base_units" NOT GLOB '0[0-9]*' AND length("to_amount_base_units") > 0 AND length("to_amount_base_units") <= 78),
	CONSTRAINT "ck_asset_conversions_fee_canonical" CHECK(("fee_amount_base_units" GLOB '[0-9]*' AND "fee_amount_base_units" NOT GLOB '0[0-9]*' AND length("fee_amount_base_units") > 0 AND length("fee_amount_base_units") <= 78) OR "fee_amount_base_units" = '0'),
	CONSTRAINT "ck_asset_conversions_different_assets" CHECK("from_asset_id" <> "to_asset_id"),
	CONSTRAINT "ck_asset_conversions_completed_state" CHECK(("status" = 'completed' AND "completed_at" IS NOT NULL) OR ("status" != 'completed' AND "completed_at" IS NULL)),
	CONSTRAINT "ck_asset_conversions_completed_temporal" CHECK("completed_at" IS NULL OR "completed_at" >= "created_at"),
	CONSTRAINT "ck_asset_conversions_version" CHECK("version" > 0)
);--> statement-breakpoint

DROP TABLE IF EXISTS `asset_conversions`;--> statement-breakpoint
ALTER TABLE `__new_asset_conversions` RENAME TO `asset_conversions`;--> statement-breakpoint

CREATE UNIQUE INDEX `uq_asset_conversions_transaction` ON `asset_conversions` (`financial_transaction_id`);--> statement-breakpoint
CREATE INDEX `idx_asset_conversions_from_asset` ON `asset_conversions` (`from_asset_id`);--> statement-breakpoint
CREATE INDEX `idx_asset_conversions_to_asset` ON `asset_conversions` (`to_asset_id`);--> statement-breakpoint
CREATE INDEX `idx_asset_conversions_status` ON `asset_conversions` (`status`);--> statement-breakpoint
CREATE INDEX `idx_asset_conversions_created` ON `asset_conversions` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_asset_conversions_source_exchange_rate` ON `asset_conversions` (`source_exchange_rate_id`);--> statement-breakpoint
CREATE INDEX `idx_asset_conversions_fee_asset` ON `asset_conversions` (`fee_asset_id`);
