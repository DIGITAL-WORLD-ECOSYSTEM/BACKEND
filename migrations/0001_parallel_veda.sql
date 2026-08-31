CREATE TABLE `auth_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`status` text DEFAULT 'created' NOT NULL,
	`initial_aal` integer DEFAULT 1 NOT NULL,
	`current_aal` integer DEFAULT 1 NOT NULL,
	`target_aal` integer DEFAULT 2 NOT NULL,
	`method` text NOT NULL,
	`challenge_hash` text,
	`context` text NOT NULL,
	`ip` text,
	`user_agent` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`expires_at` integer NOT NULL,
	`completed_at` integer,
	`consumed_at` integer,
	`failure_count` integer DEFAULT 0 NOT NULL,
	`auth_epoch_at_start` integer NOT NULL,
	`last_authenticated_at` integer,
	`assurance_method` text,
	`risk_level` text DEFAULT 'low' NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "auth_transactions_status_check" CHECK("auth_transactions"."status" IN ('created', 'awaiting_factor', 'verified', 'completed', 'expired', 'cancelled', 'failed', 'replayed', 'locked')),
	CONSTRAINT "auth_transactions_context_check" CHECK("auth_transactions"."context" IN ('login', 'mfa_setup', 'mfa_change', 'credential_link', 'credential_unlink', 'sensitive_operation', 'password_change', 'recovery')),
	CONSTRAINT "auth_transactions_expiration_check" CHECK("auth_transactions"."created_at" < "auth_transactions"."expires_at")
);
--> statement-breakpoint
CREATE INDEX `idx_auth_transactions_user` ON `auth_transactions` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_auth_transactions_expires` ON `auth_transactions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `refresh_token_families` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`revoked_at` integer,
	`revocation_reason` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "refresh_families_revoked_state_check" CHECK("refresh_token_families"."revoked_at" IS NOT NULL OR "refresh_token_families"."revocation_reason" IS NULL)
);
--> statement-breakpoint
CREATE INDEX `idx_refresh_families_user` ON `refresh_token_families` (`user_id`);--> statement-breakpoint
ALTER TABLE `users` ADD `failed_login_attempts` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `last_failed_login_at` integer;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_auth_challenges` (
	`id` text PRIMARY KEY NOT NULL,
	`transaction_id` text,
	`user_id` integer,
	`challenge_hash` text NOT NULL,
	`challenge_type` text NOT NULL,
	`context` text NOT NULL,
	`used_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`transaction_id`) REFERENCES `auth_transactions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "auth_challenges_type_check" CHECK("__new_auth_challenges"."challenge_type" IN ('ssh', 'totp', 'webauthn', 'siwe')),
	CONSTRAINT "auth_challenges_context_check" CHECK("__new_auth_challenges"."context" IN ('login', 'mfa_setup', 'mfa_change', 'credential_link', 'credential_unlink', 'sensitive_operation', 'password_change', 'recovery')),
	CONSTRAINT "auth_challenges_expiration_check" CHECK("__new_auth_challenges"."created_at" < "__new_auth_challenges"."expires_at"),
	CONSTRAINT "auth_challenges_used_state_check" CHECK("__new_auth_challenges"."used_at" IS NULL OR "__new_auth_challenges"."used_at" >= "__new_auth_challenges"."created_at")
);
--> statement-breakpoint
INSERT INTO `__new_auth_challenges`("id", "transaction_id", "user_id", "challenge_hash", "challenge_type", "context", "used_at", "created_at", "expires_at") SELECT "id", NULL AS "transaction_id", "user_id", "challenge_hash", "challenge_type", "context", "used_at", "created_at", "expires_at" FROM `auth_challenges`;--> statement-breakpoint
DROP TABLE `auth_challenges`;--> statement-breakpoint
ALTER TABLE `__new_auth_challenges` RENAME TO `auth_challenges`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_auth_challenges_transaction` ON `auth_challenges` (`transaction_id`);--> statement-breakpoint
CREATE INDEX `idx_auth_challenges_expires` ON `auth_challenges` (`expires_at`);--> statement-breakpoint
ALTER TABLE `user_sessions` ADD `family_id` text REFERENCES refresh_token_families(id);--> statement-breakpoint
CREATE INDEX `idx_sessions_family` ON `user_sessions` (`family_id`);