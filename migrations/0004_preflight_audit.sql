-- 0004_preflight_audit.sql
-- Forensic Preflight Diagnostic Script for ASPPIBRA Identity, SSI & Finance Hardening

CREATE TABLE IF NOT EXISTS `oauth_identities` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`provider` text NOT NULL,
	`subject_id` text NOT NULL,
	`provider_id` text,
	`provider_subject` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE TABLE IF NOT EXISTS `event_consumer_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`consumer_id` text NOT NULL,
	`event_id` text NOT NULL,
	`processed_at` integer DEFAULT (unixepoch()) NOT NULL
);

