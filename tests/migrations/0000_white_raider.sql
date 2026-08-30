CREATE TABLE `membership_cards` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`card_hash` text NOT NULL,
	`tier` text DEFAULT 'citizen' NOT NULL,
	`issue_date` integer DEFAULT (unixepoch()) NOT NULL,
	`expiry_date` integer,
	`qr_code_url` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "membership_cards_tier_check" CHECK("membership_cards"."tier" IN ('citizen', 'partner', 'founder', 'honorary')),
	CONSTRAINT "membership_cards_status_check" CHECK("membership_cards"."status" IN ('active', 'expired', 'revoked')),
	CONSTRAINT "membership_cards_expiry_order_check" CHECK("membership_cards"."expiry_date" IS NULL OR "membership_cards"."expiry_date" > "membership_cards"."issue_date")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `membership_cards_card_hash_unique` ON `membership_cards` (`card_hash`);--> statement-breakpoint
CREATE INDEX `idx_cards_user` ON `membership_cards` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_membership_cards_active_user` ON `membership_cards` (`user_id`) WHERE "membership_cards"."status" = 'active';--> statement-breakpoint
CREATE TABLE `user_addresses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`type` text NOT NULL,
	`country` text DEFAULT 'BR' NOT NULL,
	`state` text NOT NULL,
	`city` text NOT NULL,
	`neighborhood` text,
	`street` text NOT NULL,
	`number` text,
	`complement` text,
	`zip_code` text NOT NULL,
	`is_primary` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "user_addresses_type_check" CHECK("user_addresses"."type" IN ('residential', 'commercial', 'billing', 'shipping'))
);
--> statement-breakpoint
CREATE INDEX `idx_user_addresses_user` ON `user_addresses` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_user_addresses_primary` ON `user_addresses` (`user_id`,`type`) WHERE "user_addresses"."is_primary" = true;--> statement-breakpoint
CREATE TABLE `user_contacts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`type` text NOT NULL,
	`value` text NOT NULL,
	`normalized_value` text NOT NULL,
	`verification_method` text,
	`verified_at` integer,
	`is_primary` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "user_contacts_type_check" CHECK("user_contacts"."type" IN ('phone', 'mobile', 'whatsapp', 'secondary_email')),
	CONSTRAINT "user_contacts_verification_method_check" CHECK("user_contacts"."verification_method" IS NULL OR "user_contacts"."verification_method" IN ('sms', 'whatsapp', 'email', 'admin', 'import')),
	CONSTRAINT "user_contacts_verified_at_check" CHECK("user_contacts"."verified_at" IS NULL OR "user_contacts"."verification_method" IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX `idx_user_contacts_user` ON `user_contacts` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_user_contacts_normalized` ON `user_contacts` (`type`,`normalized_value`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_user_contacts_primary` ON `user_contacts` (`user_id`) WHERE "user_contacts"."is_primary" = true;--> statement-breakpoint
CREATE TABLE `user_education` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`organization_id` integer,
	`institution_name` text,
	`degree` text NOT NULL,
	`field` text,
	`level` text,
	`start_date` text,
	`end_date` text,
	`verified_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "user_education_date_order_check" CHECK("user_education"."end_date" IS NULL OR "user_education"."start_date" IS NULL OR "user_education"."end_date" >= "user_education"."start_date"),
	CONSTRAINT "user_education_organization_check" CHECK("user_education"."organization_id" IS NOT NULL OR "user_education"."institution_name" IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX `idx_education_user` ON `user_education` (`user_id`);--> statement-breakpoint
CREATE TABLE `user_external_identities` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`provider` text NOT NULL,
	`provider_subject_id` text NOT NULL,
	`email_at_binding` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_user_external_identities_provider_subject` ON `user_external_identities` (`provider`,`provider_subject_id`);--> statement-breakpoint
CREATE INDEX `idx_user_external_identities_user_id` ON `user_external_identities` (`user_id`);--> statement-breakpoint
CREATE TABLE `user_notification_settings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`type` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_user_notification_settings_type` ON `user_notification_settings` (`user_id`,`type`);--> statement-breakpoint
CREATE TABLE `user_professional_experience` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`organization_id` integer,
	`company_name` text,
	`role` text NOT NULL,
	`description` text,
	`start_date` text,
	`end_date` text,
	`verified_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "user_professional_experience_date_order_check" CHECK("user_professional_experience"."end_date" IS NULL OR "user_professional_experience"."start_date" IS NULL OR "user_professional_experience"."end_date" >= "user_professional_experience"."start_date"),
	CONSTRAINT "user_professional_experience_organization_check" CHECK("user_professional_experience"."organization_id" IS NOT NULL OR "user_professional_experience"."company_name" IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX `idx_professional_exp_user` ON `user_professional_experience` (`user_id`);--> statement-breakpoint
CREATE TABLE `user_profiles` (
	`user_id` integer PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`username_normalized` text NOT NULL,
	`display_name` text,
	`avatar_url` text,
	`website` text,
	`about` text,
	`profile_visibility` text DEFAULT 'private' NOT NULL,
	`is_discoverable` integer DEFAULT false NOT NULL,
	`deleted_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "username_format_check" CHECK(length("user_profiles"."username") >= 3),
	CONSTRAINT "user_profiles_visibility_check" CHECK("user_profiles"."profile_visibility" IN ('public', 'members', 'private'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_user_profiles_active_username_normalized` ON `user_profiles` (`username_normalized`) WHERE "user_profiles"."deleted_at" IS NULL;--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`public_id` text,
	`subject_type` text DEFAULT 'human' NOT NULL,
	`email` text,
	`email_normalized` text,
	`email_verified_at` integer,
	`email_changed_at` integer,
	`auth_epoch` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'pending_setup' NOT NULL,
	`status_changed_at` integer,
	`locked_at` integer,
	`disabled_at` integer,
	`deleted_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT "users_subject_type_check" CHECK("users"."subject_type" IN ('human', 'service', 'system')),
	CONSTRAINT "users_status_check" CHECK("users"."status" IN ('pending_setup', 'active', 'suspended', 'locked', 'disabled')),
	CONSTRAINT "users_auth_epoch_check" CHECK("users"."auth_epoch" >= 1),
	CONSTRAINT "users_email_normalization_check" CHECK((
        "users"."email" IS NULL AND "users"."email_normalized" IS NULL
      ) OR (
        "users"."email" IS NOT NULL AND "users"."email_normalized" IS NOT NULL
      )),
	CONSTRAINT "users_email_verification_check" CHECK("users"."email_verified_at" IS NULL OR "users"."email" IS NOT NULL),
	CONSTRAINT "users_email_changed_check" CHECK("users"."email_changed_at" IS NULL OR "users"."email" IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_public_id_unique` ON `users` (`public_id`);--> statement-breakpoint
CREATE INDEX `idx_users_status` ON `users` (`status`);--> statement-breakpoint
CREATE INDEX `idx_users_active_actor` ON `users` (`status`,`deleted_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_users_active_email_normalized` ON `users` (`email_normalized`) WHERE "users"."deleted_at" IS NULL;--> statement-breakpoint
CREATE TABLE `auth_challenges` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer,
	`challenge_hash` text NOT NULL,
	`challenge_type` text NOT NULL,
	`used_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "auth_challenges_type_check" CHECK("auth_challenges"."challenge_type" IN ('ssh', 'totp', 'webauthn', 'siwe')),
	CONSTRAINT "auth_challenges_expiration_check" CHECK("auth_challenges"."created_at" < "auth_challenges"."expires_at"),
	CONSTRAINT "auth_challenges_used_state_check" CHECK("auth_challenges"."used_at" IS NULL OR "auth_challenges"."used_at" >= "auth_challenges"."created_at")
);
--> statement-breakpoint
CREATE INDEX `idx_auth_challenges_expires` ON `auth_challenges` (`expires_at`);--> statement-breakpoint
CREATE TABLE `password_credentials` (
	`authenticator_id` text PRIMARY KEY NOT NULL,
	`password_hash` text NOT NULL,
	FOREIGN KEY (`authenticator_id`) REFERENCES `user_authenticators`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `password_resets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "password_resets_used_state_check" CHECK("password_resets"."used_at" IS NULL OR "password_resets"."used_at" >= "password_resets"."created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `password_resets_token_hash_unique` ON `password_resets` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_password_resets_expires` ON `password_resets` (`expires_at`);--> statement-breakpoint
CREATE TABLE `recovery_credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`recovery_set_id` text NOT NULL,
	`code_hash` text NOT NULL,
	`consumed_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`recovery_set_id`) REFERENCES `recovery_sets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_recovery_credentials_set` ON `recovery_credentials` (`recovery_set_id`);--> statement-breakpoint
CREATE TABLE `recovery_sets` (
	`id` text PRIMARY KEY NOT NULL,
	`authenticator_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`expires_at` integer,
	`revoked_at` integer,
	FOREIGN KEY (`authenticator_id`) REFERENCES `user_authenticators`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recovery_sets_authenticator_id_unique` ON `recovery_sets` (`authenticator_id`);--> statement-breakpoint
CREATE TABLE `totp_credentials` (
	`authenticator_id` text PRIMARY KEY NOT NULL,
	`encrypted_totp_secret` text NOT NULL,
	`algorithm` text DEFAULT 'SHA1' NOT NULL,
	`digits` integer DEFAULT 6 NOT NULL,
	`period` integer DEFAULT 30 NOT NULL,
	FOREIGN KEY (`authenticator_id`) REFERENCES `user_authenticators`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "totp_digits_check" CHECK("totp_credentials"."digits" IN (6, 8)),
	CONSTRAINT "totp_period_check" CHECK("totp_credentials"."period" IN (30, 60)),
	CONSTRAINT "totp_algorithm_check" CHECK("totp_credentials"."algorithm" IN ('SHA1', 'SHA256', 'SHA512'))
);
--> statement-breakpoint
CREATE TABLE `user_authenticators` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`type` text NOT NULL,
	`label` text,
	`verified_at` integer,
	`last_used_at` integer,
	`revoked_at` integer,
	`revoked_by` integer,
	`revocation_reason` text,
	`metadata` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`revoked_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "user_authenticators_type_check" CHECK("user_authenticators"."type" IN ('password', 'totp', 'webauthn', 'recovery_code', 'wallet')),
	CONSTRAINT "user_authenticators_revoked_state_check" CHECK("user_authenticators"."revoked_at" IS NOT NULL OR "user_authenticators"."revocation_reason" IS NULL)
);
--> statement-breakpoint
CREATE INDEX `idx_authenticators_user_type_revoked` ON `user_authenticators` (`user_id`,`type`,`revoked_at`);--> statement-breakpoint
CREATE TABLE `user_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`jti` text NOT NULL,
	`ip` text,
	`user_agent` text,
	`refresh_token_hash` text NOT NULL,
	`aal` integer DEFAULT 1 NOT NULL,
	`auth_epoch` integer DEFAULT 1 NOT NULL,
	`last_activity_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	`revocation_reason` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "user_sessions_aal_check" CHECK("user_sessions"."aal" IN (1, 2, 3)),
	CONSTRAINT "user_sessions_expiration_check" CHECK("user_sessions"."created_at" < "user_sessions"."expires_at"),
	CONSTRAINT "user_sessions_revoked_state_check" CHECK("user_sessions"."revoked_at" IS NOT NULL OR "user_sessions"."revocation_reason" IS NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_sessions_jti_unique` ON `user_sessions` (`jti`);--> statement-breakpoint
CREATE INDEX `idx_sessions_user` ON `user_sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_sessions_expires` ON `user_sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `wallet_authenticators` (
	`authenticator_id` text PRIMARY KEY NOT NULL,
	`wallet_id` integer NOT NULL,
	`protocol` text DEFAULT 'siwe' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`authenticator_id`) REFERENCES `user_authenticators`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "wallet_authenticators_protocol_check" CHECK("wallet_authenticators"."protocol" IN ('siwe', 'eip191', 'eip712', 'eip1271'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `wallet_authenticators_wallet_id_unique` ON `wallet_authenticators` (`wallet_id`);--> statement-breakpoint
CREATE TABLE `webauthn_credentials` (
	`authenticator_id` text PRIMARY KEY NOT NULL,
	`credential_id` text NOT NULL,
	`public_key_cose` text NOT NULL,
	`rp_id` text NOT NULL,
	`user_handle` text,
	`sign_count` integer DEFAULT 0 NOT NULL,
	`transports` text,
	`backup_eligible` integer NOT NULL,
	`backup_state` integer NOT NULL,
	`uv_initialized` integer NOT NULL,
	`aaguid` text,
	`attestation_format` text,
	`attestation_object` text,
	FOREIGN KEY (`authenticator_id`) REFERENCES `user_authenticators`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "webauthn_sign_count_check" CHECK("webauthn_credentials"."sign_count" >= 0),
	CONSTRAINT "webauthn_rpid_check" CHECK(length("webauthn_credentials"."rp_id") > 0),
	CONSTRAINT "webauthn_backup_state_check" CHECK("webauthn_credentials"."backup_state" = 0 OR "webauthn_credentials"."backup_eligible" = 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `webauthn_credentials_credential_id_unique` ON `webauthn_credentials` (`credential_id`);--> statement-breakpoint
CREATE TABLE `roles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`display_name` text NOT NULL,
	`description` text,
	`status` text DEFAULT 'active' NOT NULL,
	`is_system` integer DEFAULT false NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_by` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "roles_version_check" CHECK("roles"."version" >= 1),
	CONSTRAINT "roles_status_check" CHECK("roles"."status" IN ('active', 'disabled', 'archived'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `roles_key_unique` ON `roles` (`key`);--> statement-breakpoint
CREATE INDEX `idx_roles_status` ON `roles` (`status`);--> statement-breakpoint
CREATE TABLE `user_roles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`role_id` integer NOT NULL,
	`grant_source` text DEFAULT 'admin' NOT NULL,
	`granted_by` integer,
	`grant_reason` text,
	`granted_at` integer DEFAULT (unixepoch()) NOT NULL,
	`expires_at` integer,
	`revoked_by` integer,
	`revoked_at` integer,
	`revocation_reason` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`granted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`revoked_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "user_roles_expires_after_grant" CHECK("user_roles"."expires_at" IS NULL OR "user_roles"."expires_at" > "user_roles"."granted_at"),
	CONSTRAINT "user_roles_revoked_after_grant" CHECK("user_roles"."revoked_at" IS NULL OR "user_roles"."revoked_at" >= "user_roles"."granted_at"),
	CONSTRAINT "user_roles_revocation_coherence" CHECK("user_roles"."revoked_by" IS NULL OR "user_roles"."revoked_at" IS NOT NULL),
	CONSTRAINT "user_roles_version_check" CHECK("user_roles"."version" >= 1),
	CONSTRAINT "user_roles_grant_source_check" CHECK("user_roles"."grant_source" IN ('admin', 'system', 'migration', 'policy'))
);
--> statement-breakpoint
CREATE INDEX `idx_user_roles_user_role_lifecycle` ON `user_roles` (`user_id`,`role_id`,`revoked_at`,`expires_at`);--> statement-breakpoint
CREATE INDEX `idx_user_roles_role_lifecycle` ON `user_roles` (`role_id`,`revoked_at`,`expires_at`);--> statement-breakpoint
CREATE INDEX `idx_user_roles_granted_by` ON `user_roles` (`granted_by`);--> statement-breakpoint
CREATE INDEX `idx_user_roles_revoked_by` ON `user_roles` (`revoked_by`);--> statement-breakpoint
CREATE TABLE `citizens` (
	`user_id` integer PRIMARY KEY NOT NULL,
	`username` text,
	`legal_first_name` text,
	`legal_last_name` text,
	`nationality_code` text,
	`birth_date` text,
	`marital_status` text,
	`civil_status` text DEFAULT 'pending' NOT NULL,
	`status_changed_at` integer,
	`verified_at` integer,
	`verified_by` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`verified_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "ck_citizens_civil_status" CHECK("citizens"."civil_status" IN ('pending', 'verified', 'suspended', 'revoked')),
	CONSTRAINT "ck_citizens_marital_status" CHECK("citizens"."marital_status" IS NULL OR "citizens"."marital_status" IN ('single', 'married', 'divorced', 'widowed', 'stable_union', 'separated')),
	CONSTRAINT "ck_citizens_verified_state" CHECK(
        "citizens"."civil_status" != 'verified'
        OR (
          "citizens"."verified_at" IS NOT NULL
          AND "citizens"."verified_by" IS NOT NULL
        )
      ),
	CONSTRAINT "ck_citizens_version" CHECK("citizens"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE `identity_documents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`document_type` text NOT NULL,
	`country_code` text DEFAULT 'BR' NOT NULL,
	`number_lookup_hash` text NOT NULL,
	`encrypted_number` text NOT NULL,
	`last4` text,
	`document_hash` text,
	`issuing_authority` text,
	`issued_at` text,
	`expires_at` text,
	`source` text NOT NULL,
	`source_reference` text,
	`verification_status` text DEFAULT 'pending' NOT NULL,
	`verified_at` integer,
	`verified_by` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`verified_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "ck_identity_docs_document_type" CHECK("identity_documents"."document_type" IN ('cpf', 'rg', 'passport', 'cnh')),
	CONSTRAINT "ck_identity_docs_source" CHECK("identity_documents"."source" IN ('government', 'manual_upload', 'kyc_provider', 'admin', 'import')),
	CONSTRAINT "ck_identity_docs_verification_status" CHECK("identity_documents"."verification_status" IN ('pending', 'verified', 'rejected')),
	CONSTRAINT "ck_identity_docs_verified_state" CHECK(
        "identity_documents"."verification_status" != 'verified'
        OR (
          "identity_documents"."verified_at" IS NOT NULL
          AND "identity_documents"."verified_by" IS NOT NULL
        )
      ),
	CONSTRAINT "ck_identity_docs_dates" CHECK(
        "identity_documents"."issued_at" IS NULL
        OR "identity_documents"."expires_at" IS NULL
        OR "identity_documents"."expires_at" > "identity_documents"."issued_at"
      ),
	CONSTRAINT "ck_identity_docs_version" CHECK("identity_documents"."version" > 0)
);
--> statement-breakpoint
CREATE INDEX `idx_identity_docs_user` ON `identity_documents` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_identity_docs_hash` ON `identity_documents` (`number_lookup_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_identity_docs_active_lookup_hash` ON `identity_documents` (`country_code`,`document_type`,`number_lookup_hash`) WHERE "identity_documents"."verification_status" != 'rejected';--> statement-breakpoint
CREATE TABLE `kyc_verifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`verification_version` integer DEFAULT 1 NOT NULL,
	`verification_level` text NOT NULL,
	`status` text NOT NULL,
	`provider` text NOT NULL,
	`risk_score` integer,
	`risk_model` text,
	`risk_model_version` text,
	`rejection_reason` text,
	`metadata` text,
	`reviewed_by` integer,
	`started_at` integer NOT NULL,
	`completed_at` integer,
	`expires_at` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`reviewed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "ck_kyc_verifications_level" CHECK("kyc_verifications"."verification_level" IN ('basic', 'enhanced', 'institutional')),
	CONSTRAINT "ck_kyc_verifications_status" CHECK("kyc_verifications"."status" IN ('submitted', 'under_review', 'approved', 'rejected', 'expired')),
	CONSTRAINT "ck_kyc_verifications_approved_state" CHECK(
        "kyc_verifications"."status" != 'approved'
        OR "kyc_verifications"."completed_at" IS NOT NULL
      ),
	CONSTRAINT "ck_kyc_verifications_rejected_state" CHECK(
        "kyc_verifications"."status" != 'rejected'
        OR (
          "kyc_verifications"."rejection_reason" IS NOT NULL
          AND length(trim("kyc_verifications"."rejection_reason")) > 0
        )
      ),
	CONSTRAINT "ck_kyc_verifications_temporal_order" CHECK(
        ("kyc_verifications"."completed_at" IS NULL OR "kyc_verifications"."completed_at" >= "kyc_verifications"."started_at")
        AND ("kyc_verifications"."expires_at" IS NULL OR "kyc_verifications"."completed_at" IS NULL OR "kyc_verifications"."expires_at" > "kyc_verifications"."completed_at")
      ),
	CONSTRAINT "ck_kyc_verifications_risk_score" CHECK(
        "kyc_verifications"."risk_score" IS NULL
        OR ("kyc_verifications"."risk_score" >= 0 AND "kyc_verifications"."risk_score" <= 1000)
      ),
	CONSTRAINT "ck_kyc_verifications_version" CHECK("kyc_verifications"."version" > 0)
);
--> statement-breakpoint
CREATE INDEX `idx_kyc_user` ON `kyc_verifications` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_kyc_status` ON `kyc_verifications` (`status`);--> statement-breakpoint
CREATE TABLE `did_identities` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`did` text NOT NULL,
	`method` text NOT NULL,
	`controller` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	`revoked_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ck_did_identities_did_format" CHECK("did_identities"."did" LIKE 'did:%'),
	CONSTRAINT "ck_did_identities_status" CHECK("did_identities"."status" IN ('active', 'suspended', 'revoked')),
	CONSTRAINT "ck_did_identities_method" CHECK("did_identities"."method" IN ('key', 'ion', 'polygonid', 'web', 'cheqd', 'pkh')),
	CONSTRAINT "ck_did_identities_revoked_state" CHECK("did_identities"."status" != 'revoked' OR "did_identities"."revoked_at" IS NOT NULL),
	CONSTRAINT "ck_did_identities_version" CHECK("did_identities"."version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `did_identities_did_unique` ON `did_identities` (`did`);--> statement-breakpoint
CREATE INDEX `idx_did_identities_user` ON `did_identities` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_did_identities_did` ON `did_identities` (`did`);--> statement-breakpoint
CREATE INDEX `idx_did_identities_status` ON `did_identities` (`status`);--> statement-breakpoint
CREATE TABLE `did_verification_methods` (
	`id` text PRIMARY KEY NOT NULL,
	`did_id` text NOT NULL,
	`type` text NOT NULL,
	`controller_did` text NOT NULL,
	`public_key_multibase` text NOT NULL,
	`purpose` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`revoked_at` integer,
	FOREIGN KEY (`did_id`) REFERENCES `did_identities`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ck_did_vm_controller_did_format" CHECK("did_verification_methods"."controller_did" LIKE 'did:%'),
	CONSTRAINT "ck_did_vm_status" CHECK("did_verification_methods"."status" IN ('active', 'suspended', 'revoked')),
	CONSTRAINT "ck_did_vm_purpose" CHECK("did_verification_methods"."purpose" IN ('authentication', 'assertionMethod', 'keyAgreement', 'capabilityInvocation', 'capabilityDelegation')),
	CONSTRAINT "ck_did_vm_type" CHECK("did_verification_methods"."type" IN ('Ed25519VerificationKey2020', 'EcdsaSecp256k1RecoveryMethod2020', 'X25519KeyAgreementKey2020', 'JsonWebKey2020')),
	CONSTRAINT "ck_did_vm_revoked_state" CHECK("did_verification_methods"."status" != 'revoked' OR "did_verification_methods"."revoked_at" IS NOT NULL),
	CONSTRAINT "ck_did_vm_version" CHECK("did_verification_methods"."version" > 0)
);
--> statement-breakpoint
CREATE INDEX `idx_did_verification_methods_did` ON `did_verification_methods` (`did_id`);--> statement-breakpoint
CREATE INDEX `idx_did_verification_methods_purpose` ON `did_verification_methods` (`purpose`);--> statement-breakpoint
CREATE INDEX `idx_did_verification_methods_status` ON `did_verification_methods` (`status`);--> statement-breakpoint
CREATE TABLE `secure_vaults` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`purpose` text NOT NULL,
	`ciphertext` text NOT NULL,
	`nonce` text NOT NULL,
	`auth_tag` text NOT NULL,
	`encryption_algorithm` text NOT NULL,
	`key_version` integer DEFAULT 1 NOT NULL,
	`key_reference` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`rotated_at` integer,
	`revoked_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ck_secure_vaults_purpose" CHECK("secure_vaults"."purpose" IN ('wallet_mnemonic', 'recovery_material', 'private_key', 'identity_seed')),
	CONSTRAINT "ck_secure_vaults_algorithm" CHECK("secure_vaults"."encryption_algorithm" IN ('AES-256-GCM', 'XChaCha20-Poly1305')),
	CONSTRAINT "ck_secure_vaults_rotated_after_created" CHECK("secure_vaults"."rotated_at" IS NULL OR "secure_vaults"."rotated_at" >= "secure_vaults"."created_at"),
	CONSTRAINT "ck_secure_vaults_revoked_after_created" CHECK("secure_vaults"."revoked_at" IS NULL OR "secure_vaults"."revoked_at" >= "secure_vaults"."created_at"),
	CONSTRAINT "ck_secure_vaults_version" CHECK("secure_vaults"."version" > 0 AND "secure_vaults"."key_version" > 0)
);
--> statement-breakpoint
CREATE INDEX `idx_secure_vaults_user` ON `secure_vaults` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_secure_vaults_user_purpose_version` ON `secure_vaults` (`user_id`,`purpose`,`key_version`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_secure_vaults_active_purpose` ON `secure_vaults` (`user_id`,`purpose`) WHERE "secure_vaults"."revoked_at" IS NULL;--> statement-breakpoint
CREATE TABLE `verifiable_credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`holder_user_id` integer NOT NULL,
	`issuer_did` text NOT NULL,
	`subject_did` text NOT NULL,
	`credential_type` text NOT NULL,
	`credential_hash` text NOT NULL,
	`encrypted_claims` text NOT NULL,
	`proof_type` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`issuance_date` integer DEFAULT (unixepoch()) NOT NULL,
	`expiration_date` integer,
	`revoked_at` integer,
	FOREIGN KEY (`holder_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ck_vc_issuer_did_format" CHECK("verifiable_credentials"."issuer_did" LIKE 'did:%'),
	CONSTRAINT "ck_vc_subject_did_format" CHECK("verifiable_credentials"."subject_did" LIKE 'did:%'),
	CONSTRAINT "ck_vc_status" CHECK("verifiable_credentials"."status" IN ('active', 'suspended', 'revoked', 'expired')),
	CONSTRAINT "ck_vc_type" CHECK("verifiable_credentials"."credential_type" IN ('CivicIdentityCredential', 'MembershipCredential', 'KycVerificationCredential', 'ReputationCredential')),
	CONSTRAINT "ck_vc_proof_type" CHECK("verifiable_credentials"."proof_type" IN ('Ed25519Signature2020', 'BbsBlsSignature2020', 'JsonWebSignature2020')),
	CONSTRAINT "ck_vc_revoked_state" CHECK("verifiable_credentials"."status" != 'revoked' OR "verifiable_credentials"."revoked_at" IS NOT NULL),
	CONSTRAINT "ck_vc_dates" CHECK("verifiable_credentials"."expiration_date" IS NULL OR "verifiable_credentials"."expiration_date" > "verifiable_credentials"."issuance_date"),
	CONSTRAINT "ck_vc_version" CHECK("verifiable_credentials"."version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `verifiable_credentials_credential_hash_unique` ON `verifiable_credentials` (`credential_hash`);--> statement-breakpoint
CREATE INDEX `idx_vc_holder_user` ON `verifiable_credentials` (`holder_user_id`);--> statement-breakpoint
CREATE INDEX `idx_vc_subject_did` ON `verifiable_credentials` (`subject_did`);--> statement-breakpoint
CREATE INDEX `idx_vc_issuer_did` ON `verifiable_credentials` (`issuer_did`);--> statement-breakpoint
CREATE INDEX `idx_vc_status` ON `verifiable_credentials` (`status`);--> statement-breakpoint
CREATE TABLE `verifiable_presentations` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`verifier_did` text NOT NULL,
	`presentation_type` text NOT NULL,
	`challenge` text NOT NULL,
	`presentation_hash` text NOT NULL,
	`status` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`submitted_at` integer DEFAULT (unixepoch()) NOT NULL,
	`verified_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ck_vp_verifier_did_format" CHECK("verifiable_presentations"."verifier_did" LIKE 'did:%'),
	CONSTRAINT "ck_vp_status" CHECK("verifiable_presentations"."status" IN ('verified', 'rejected', 'expired')),
	CONSTRAINT "ck_vp_verified_state" CHECK("verifiable_presentations"."status" != 'verified' OR "verifiable_presentations"."verified_at" IS NOT NULL),
	CONSTRAINT "ck_vp_verified_after_submitted" CHECK("verifiable_presentations"."verified_at" IS NULL OR "verifiable_presentations"."verified_at" >= "verifiable_presentations"."submitted_at"),
	CONSTRAINT "ck_vp_version" CHECK("verifiable_presentations"."version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `verifiable_presentations_presentation_hash_unique` ON `verifiable_presentations` (`presentation_hash`);--> statement-breakpoint
CREATE INDEX `idx_vp_user` ON `verifiable_presentations` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_vp_verifier` ON `verifiable_presentations` (`verifier_did`);--> statement-breakpoint
CREATE INDEX `idx_vp_status` ON `verifiable_presentations` (`status`);--> statement-breakpoint
CREATE TABLE `smart_contracts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`network_id` integer NOT NULL,
	`address` text NOT NULL,
	`address_normalized` text NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`version` text DEFAULT '1.0.0' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`row_version` integer DEFAULT 1 NOT NULL,
	`metadata` text,
	`deployment_tx_hash` text,
	`explorer_url` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`network_id`) REFERENCES `web3_networks`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ck_smart_contracts_address" CHECK(
        "smart_contracts"."address" LIKE '0x%'
        AND length("smart_contracts"."address") = 42
        AND substr("smart_contracts"."address", 3) NOT GLOB '*[^0-9A-Fa-f]*'
      ),
	CONSTRAINT "ck_smart_contracts_address_normalized" CHECK(
        "smart_contracts"."address_normalized" LIKE '0x%'
        AND length("smart_contracts"."address_normalized") = 42
        AND substr("smart_contracts"."address_normalized", 3) NOT GLOB '*[^0-9A-Fa-f]*'
      ),
	CONSTRAINT "ck_smart_contracts_address_normalized_lowercase" CHECK(
        "smart_contracts"."address_normalized"
        = lower("smart_contracts"."address_normalized")
      ),
	CONSTRAINT "ck_smart_contracts_address_normalized_matches" CHECK(
        "smart_contracts"."address_normalized"
        = lower("smart_contracts"."address")
      ),
	CONSTRAINT "ck_smart_contracts_deployment_tx_hash" CHECK(
        "smart_contracts"."deployment_tx_hash" IS NULL
        OR (
          "smart_contracts"."deployment_tx_hash" LIKE '0x%'
          AND length("smart_contracts"."deployment_tx_hash") = 66
          AND substr("smart_contracts"."deployment_tx_hash", 3)
              NOT GLOB '*[^0-9A-Fa-f]*'
        )
      ),
	CONSTRAINT "ck_smart_contracts_name_not_empty" CHECK(length(trim("smart_contracts"."name")) > 0),
	CONSTRAINT "ck_smart_contracts_row_version" CHECK("smart_contracts"."row_version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_smart_contracts_network_address` ON `smart_contracts` (`network_id`,`address_normalized`);--> statement-breakpoint
CREATE INDEX `idx_smart_contracts_type` ON `smart_contracts` (`type`);--> statement-breakpoint
CREATE INDEX `idx_smart_contracts_network_status` ON `smart_contracts` (`network_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_smart_contracts_deployment_tx` ON `smart_contracts` (`network_id`,`deployment_tx_hash`);--> statement-breakpoint
CREATE TABLE `wallets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`provenance` text NOT NULL,
	`network_id` integer NOT NULL,
	`wallet_type` text NOT NULL,
	`control_mode` text NOT NULL,
	`controller_wallet_id` integer,
	`address` text NOT NULL,
	`address_normalized` text NOT NULL,
	`label` text,
	`key_provider` text,
	`key_reference` text,
	`key_version` integer,
	`status` text DEFAULT 'pending' NOT NULL,
	`verification_status` text DEFAULT 'pending' NOT NULL,
	`verification_method` text,
	`is_primary` integer DEFAULT false NOT NULL,
	`linked_at` integer DEFAULT (unixepoch()) NOT NULL,
	`verified_at` integer,
	`verified_by` integer,
	`suspended_at` integer,
	`revoked_at` integer,
	`unlinked_at` integer,
	`last_ownership_verified_at` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`metadata` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`network_id`) REFERENCES `web3_networks`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`verified_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`controller_wallet_id`) REFERENCES `wallets`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ck_wallets_controller_self" CHECK(
        "wallets"."controller_wallet_id" IS NULL
        OR "wallets"."controller_wallet_id" != "wallets"."id"
      ),
	CONSTRAINT "ck_wallets_primary_internal_active" CHECK(
        "wallets"."is_primary" = false
        OR (
          "wallets"."provenance" = 'internal'
          AND "wallets"."status" = 'active'
        )
      ),
	CONSTRAINT "ck_wallets_internal_key_reference" CHECK(
        "wallets"."provenance" != 'internal'
        OR "wallets"."control_mode" = 'contract_controller'
        OR (
          "wallets"."key_provider" IS NOT NULL
          AND length(trim("wallets"."key_provider")) > 0
          AND "wallets"."key_reference" IS NOT NULL
          AND length(trim("wallets"."key_reference")) > 0
        )
      ),
	CONSTRAINT "ck_wallets_external_key_reference" CHECK(
        "wallets"."provenance" != 'external'
        OR (
          "wallets"."key_provider" IS NULL
          AND "wallets"."key_reference" IS NULL
        )
      ),
	CONSTRAINT "ck_wallets_key_version" CHECK(
        "wallets"."key_version" IS NULL
        OR "wallets"."key_version" > 0
      ),
	CONSTRAINT "ck_wallets_version" CHECK("wallets"."version" > 0),
	CONSTRAINT "ck_wallets_address" CHECK(
        "wallets"."address" LIKE '0x%'
        AND length("wallets"."address") = 42
        AND substr("wallets"."address", 3) NOT GLOB '*[^0-9A-Fa-f]*'
      ),
	CONSTRAINT "ck_wallets_address_normalized" CHECK(
        "wallets"."address_normalized" LIKE '0x%'
        AND length("wallets"."address_normalized") = 42
        AND substr("wallets"."address_normalized", 3)
            NOT GLOB '*[^0-9A-Fa-f]*'
      ),
	CONSTRAINT "ck_wallets_address_normalized_lowercase" CHECK(
        "wallets"."address_normalized"
        = lower("wallets"."address_normalized")
      ),
	CONSTRAINT "ck_wallets_address_normalized_matches" CHECK(
        "wallets"."address_normalized"
        = lower("wallets"."address")
      ),
	CONSTRAINT "ck_wallets_verified_state" CHECK(
        "wallets"."verification_status" != 'verified'
        OR (
          "wallets"."verified_at" IS NOT NULL
          AND "wallets"."verification_method" IS NOT NULL
          AND "wallets"."last_ownership_verified_at" IS NOT NULL
        )
      ),
	CONSTRAINT "ck_wallets_rejected_verification" CHECK(
        "wallets"."verification_status" != 'rejected'
        OR "wallets"."verified_at" IS NULL
      ),
	CONSTRAINT "ck_wallets_revoked_at" CHECK(
        "wallets"."status" != 'revoked'
        OR "wallets"."revoked_at" IS NOT NULL
      ),
	CONSTRAINT "ck_wallets_suspended_at" CHECK(
        "wallets"."status" != 'suspended'
        OR "wallets"."suspended_at" IS NOT NULL
      ),
	CONSTRAINT "ck_wallets_unlinked_state" CHECK(
        "wallets"."status" != 'unlinked'
        OR (
          "wallets"."provenance" = 'external'
          AND "wallets"."is_primary" = false
          AND "wallets"."unlinked_at" IS NOT NULL
        )
      ),
	CONSTRAINT "ck_wallets_internal_unlinked" CHECK(
        "wallets"."provenance" != 'internal'
        OR "wallets"."status" != 'unlinked'
      ),
	CONSTRAINT "ck_wallets_verified_after_linked" CHECK(
        "wallets"."verified_at" IS NULL
        OR "wallets"."verified_at" >= "wallets"."linked_at"
      ),
	CONSTRAINT "ck_wallets_suspended_after_linked" CHECK(
        "wallets"."suspended_at" IS NULL
        OR "wallets"."suspended_at" >= "wallets"."linked_at"
      ),
	CONSTRAINT "ck_wallets_revoked_after_linked" CHECK(
        "wallets"."revoked_at" IS NULL
        OR "wallets"."revoked_at" >= "wallets"."linked_at"
      ),
	CONSTRAINT "ck_wallets_unlinked_after_linked" CHECK(
        "wallets"."unlinked_at" IS NULL
        OR "wallets"."unlinked_at" >= "wallets"."linked_at"
      ),
	CONSTRAINT "ck_wallets_provenance" CHECK(
        "wallets"."provenance" IN ('internal', 'external')
      ),
	CONSTRAINT "ck_wallets_control_mode" CHECK(
        (
          "wallets"."provenance" = 'internal'
          AND "wallets"."wallet_type" = 'eoa'
          AND "wallets"."control_mode" = 'platform_key'
        )
        OR (
          "wallets"."provenance" = 'external'
          AND "wallets"."wallet_type" = 'eoa'
          AND "wallets"."control_mode" = 'external_user'
        )
        OR (
          "wallets"."wallet_type" = 'smart_contract'
          AND "wallets"."control_mode" = 'contract_controller'
        )
      ),
	CONSTRAINT "ck_wallets_smart_contract_controller" CHECK(
        "wallets"."wallet_type" != 'smart_contract'
        OR "wallets"."controller_wallet_id" IS NOT NULL
      )
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_wallets_network_address_normalized` ON `wallets` (`network_id`,`address_normalized`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_wallets_primary_user` ON `wallets` (`user_id`) WHERE "wallets"."is_primary" = true;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_wallets_internal_active_user` ON `wallets` (`user_id`) WHERE 
          "wallets"."provenance" = 'internal'
          AND "wallets"."status" = 'active'
        ;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_wallets_id_network` ON `wallets` (`id`,`network_id`);--> statement-breakpoint
CREATE INDEX `idx_wallets_user_status` ON `wallets` (`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_wallets_user_provenance_status` ON `wallets` (`user_id`,`provenance`,`status`);--> statement-breakpoint
CREATE INDEX `idx_wallets_verification_status` ON `wallets` (`verification_status`);--> statement-breakpoint
CREATE INDEX `idx_wallets_network_status` ON `wallets` (`network_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_wallets_last_ownership_verified` ON `wallets` (`last_ownership_verified_at`);--> statement-breakpoint
CREATE TABLE `web3_networks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`identifier` text NOT NULL,
	`chain_id` integer NOT NULL,
	`namespace` text NOT NULL,
	`network_type` text NOT NULL,
	`environment` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`native_asset_reference` text,
	`rpc_provider` text,
	`rpc_endpoint_reference` text,
	`explorer_base_url` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT "ck_web3_networks_chain_id" CHECK("web3_networks"."chain_id" > 0),
	CONSTRAINT "ck_web3_networks_identifier" CHECK(
        "web3_networks"."identifier"
        = "web3_networks"."namespace" || ':' || "web3_networks"."chain_id"
      ),
	CONSTRAINT "ck_web3_networks_name_not_empty" CHECK(length(trim("web3_networks"."name")) > 0),
	CONSTRAINT "ck_web3_networks_identifier_not_empty" CHECK(length(trim("web3_networks"."identifier")) > 0),
	CONSTRAINT "ck_web3_networks_version" CHECK("web3_networks"."version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_web3_networks_chain` ON `web3_networks` (`namespace`,`chain_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_web3_networks_identifier` ON `web3_networks` (`identifier`);--> statement-breakpoint
CREATE TABLE `web3_transactions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`network_id` integer NOT NULL,
	`wallet_id` integer NOT NULL,
	`tx_hash` text,
	`transaction_type` text NOT NULL,
	`from_address` text NOT NULL,
	`to_address` text,
	`nonce` integer,
	`value_base_units` text DEFAULT '0' NOT NULL,
	`data` text,
	`gas_limit` text,
	`gas_price` text,
	`max_fee_per_gas` text,
	`max_priority_fee_per_gas` text,
	`gas_used` text,
	`effective_gas_price` text,
	`block_number` integer,
	`block_hash` text,
	`status` text DEFAULT 'created' NOT NULL,
	`receipt_status` text,
	`failure_code` text,
	`failure_reason` text,
	`replacement_of_transaction_id` integer,
	`submitted_at` integer,
	`confirmed_at` integer,
	`failed_at` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`network_id`) REFERENCES `web3_networks`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`wallet_id`) REFERENCES `wallets`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`replacement_of_transaction_id`) REFERENCES `web3_transactions`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ck_web3_transactions_nonce" CHECK(
        "web3_transactions"."nonce" IS NULL
        OR "web3_transactions"."nonce" >= 0
      ),
	CONSTRAINT "ck_web3_transactions_block_number" CHECK(
        "web3_transactions"."block_number" IS NULL
        OR "web3_transactions"."block_number" >= 0
      ),
	CONSTRAINT "ck_web3_transactions_hash" CHECK(
        "web3_transactions"."tx_hash" IS NULL
        OR (
          "web3_transactions"."tx_hash" LIKE '0x%'
          AND length("web3_transactions"."tx_hash") = 66
          AND substr("web3_transactions"."tx_hash", 3)
              NOT GLOB '*[^0-9A-Fa-f]*'
        )
      ),
	CONSTRAINT "ck_web3_transactions_from_address" CHECK(
        "web3_transactions"."from_address" LIKE '0x%'
        AND length("web3_transactions"."from_address") = 42
        AND substr("web3_transactions"."from_address", 3)
            NOT GLOB '*[^0-9A-Fa-f]*'
      ),
	CONSTRAINT "ck_web3_transactions_to_address" CHECK(
        "web3_transactions"."to_address" IS NULL
        OR (
          "web3_transactions"."to_address" LIKE '0x%'
          AND length("web3_transactions"."to_address") = 42
          AND substr("web3_transactions"."to_address", 3)
              NOT GLOB '*[^0-9A-Fa-f]*'
        )
      ),
	CONSTRAINT "ck_web3_transactions_data" CHECK(
        "web3_transactions"."data" IS NULL
        OR (
          "web3_transactions"."data" LIKE '0x%'
          AND length("web3_transactions"."data") >= 2
          AND (length("web3_transactions"."data") - 2) % 2 = 0
          AND substr("web3_transactions"."data", 3)
              NOT GLOB '*[^0-9A-Fa-f]*'
        )
      ),
	CONSTRAINT "ck_web3_transactions_value_base_units" CHECK(
        "web3_transactions"."value_base_units" <> ''
        AND ltrim(
          "web3_transactions"."value_base_units",
          '0123456789'
        ) = ''
        AND (
          "web3_transactions"."value_base_units" = '0'
          OR ltrim(
            "web3_transactions"."value_base_units",
            '0'
          ) = "web3_transactions"."value_base_units"
        )
      ),
	CONSTRAINT "ck_web3_transactions_gas_limit" CHECK(
        "web3_transactions"."gas_limit" IS NULL
        OR (
          "web3_transactions"."gas_limit" <> ''
          AND ltrim(
            "web3_transactions"."gas_limit",
            '0123456789'
          ) = ''
          AND (
            "web3_transactions"."gas_limit" = '0'
            OR ltrim(
              "web3_transactions"."gas_limit",
              '0'
            ) = "web3_transactions"."gas_limit"
          )
        )
      ),
	CONSTRAINT "ck_web3_transactions_gas_price" CHECK(
        "web3_transactions"."gas_price" IS NULL
        OR (
          "web3_transactions"."gas_price" <> ''
          AND ltrim(
            "web3_transactions"."gas_price",
            '0123456789'
          ) = ''
          AND (
            "web3_transactions"."gas_price" = '0'
            OR ltrim(
              "web3_transactions"."gas_price",
              '0'
            ) = "web3_transactions"."gas_price"
          )
        )
      ),
	CONSTRAINT "ck_web3_transactions_max_fee_per_gas" CHECK(
        "web3_transactions"."max_fee_per_gas" IS NULL
        OR (
          "web3_transactions"."max_fee_per_gas" <> ''
          AND ltrim(
            "web3_transactions"."max_fee_per_gas",
            '0123456789'
          ) = ''
          AND (
            "web3_transactions"."max_fee_per_gas" = '0'
            OR ltrim(
              "web3_transactions"."max_fee_per_gas",
              '0'
            ) = "web3_transactions"."max_fee_per_gas"
          )
        )
      ),
	CONSTRAINT "ck_web3_transactions_max_priority_fee_per_gas" CHECK(
        "web3_transactions"."max_priority_fee_per_gas" IS NULL
        OR (
          "web3_transactions"."max_priority_fee_per_gas" <> ''
          AND ltrim(
            "web3_transactions"."max_priority_fee_per_gas",
            '0123456789'
          ) = ''
          AND (
            "web3_transactions"."max_priority_fee_per_gas" = '0'
            OR ltrim(
              "web3_transactions"."max_priority_fee_per_gas",
              '0'
            ) = "web3_transactions"."max_priority_fee_per_gas"
          )
        )
      ),
	CONSTRAINT "ck_web3_transactions_gas_used" CHECK(
        "web3_transactions"."gas_used" IS NULL
        OR (
          "web3_transactions"."gas_used" <> ''
          AND ltrim(
            "web3_transactions"."gas_used",
            '0123456789'
          ) = ''
          AND (
            "web3_transactions"."gas_used" = '0'
            OR ltrim(
              "web3_transactions"."gas_used",
              '0'
            ) = "web3_transactions"."gas_used"
          )
        )
      ),
	CONSTRAINT "ck_web3_transactions_effective_gas_price" CHECK(
        "web3_transactions"."effective_gas_price" IS NULL
        OR (
          "web3_transactions"."effective_gas_price" <> ''
          AND ltrim(
            "web3_transactions"."effective_gas_price",
            '0123456789'
          ) = ''
          AND (
            "web3_transactions"."effective_gas_price" = '0'
            OR ltrim(
              "web3_transactions"."effective_gas_price",
              '0'
            ) = "web3_transactions"."effective_gas_price"
          )
        )
      ),
	CONSTRAINT "ck_web3_transactions_priority_requires_max_fee" CHECK(
        "web3_transactions"."max_priority_fee_per_gas" IS NULL
        OR "web3_transactions"."max_fee_per_gas" IS NOT NULL
      ),
	CONSTRAINT "ck_web3_transactions_submitted_hash" CHECK(
        "web3_transactions"."status" NOT IN (
          'submitted',
          'pending',
          'confirmed',
          'dropped',
          'replaced'
        )
        OR "web3_transactions"."tx_hash" IS NOT NULL
      ),
	CONSTRAINT "ck_web3_transactions_signed_nonce" CHECK(
        "web3_transactions"."status" NOT IN (
          'signed',
          'submitted',
          'pending',
          'confirmed',
          'dropped',
          'replaced'
        )
        OR "web3_transactions"."nonce" IS NOT NULL
      ),
	CONSTRAINT "ck_web3_transactions_submitted_at" CHECK(
        "web3_transactions"."status" NOT IN (
          'submitted',
          'pending',
          'confirmed',
          'dropped',
          'replaced'
        )
        OR "web3_transactions"."submitted_at" IS NOT NULL
      ),
	CONSTRAINT "ck_web3_transactions_confirmed_state" CHECK(
        "web3_transactions"."status" != 'confirmed'
        OR (
          "web3_transactions"."confirmed_at" IS NOT NULL
          AND "web3_transactions"."block_number" IS NOT NULL
          AND "web3_transactions"."block_hash" IS NOT NULL
          AND "web3_transactions"."receipt_status" IS NOT NULL
        )
      ),
	CONSTRAINT "ck_web3_transactions_block_hash" CHECK(
        "web3_transactions"."block_hash" IS NULL
        OR (
          "web3_transactions"."block_hash" LIKE '0x%'
          AND length("web3_transactions"."block_hash") = 66
          AND substr("web3_transactions"."block_hash", 3)
              NOT GLOB '*[^0-9A-Fa-f]*'
        )
      ),
	CONSTRAINT "ck_web3_transactions_failed_state" CHECK(
        "web3_transactions"."status" != 'failed'
        OR "web3_transactions"."failed_at" IS NOT NULL
      ),
	CONSTRAINT "ck_web3_transactions_replacement_self" CHECK(
        "web3_transactions"."replacement_of_transaction_id" IS NULL
        OR "web3_transactions"."replacement_of_transaction_id" != "web3_transactions"."id"
      ),
	CONSTRAINT "ck_web3_transactions_replacement_state" CHECK(
        "web3_transactions"."status" != 'replaced'
        OR (
          "web3_transactions"."nonce" IS NOT NULL
          AND "web3_transactions"."replacement_of_transaction_id" IS NOT NULL
        )
      ),
	CONSTRAINT "ck_web3_transactions_version" CHECK("web3_transactions"."version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_web3_transactions_network_hash` ON `web3_transactions` (`network_id`,`tx_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_web3_transactions_active_wallet_nonce` ON `web3_transactions` (`wallet_id`,`nonce`) WHERE 
          "web3_transactions"."nonce" IS NOT NULL
          AND "web3_transactions"."status" IN (
            'created',
            'signing',
            'signed',
            'submitted',
            'pending'
          )
        ;--> statement-breakpoint
CREATE INDEX `idx_web3_transactions_wallet` ON `web3_transactions` (`wallet_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_web3_transactions_wallet_nonce` ON `web3_transactions` (`wallet_id`,`nonce`);--> statement-breakpoint
CREATE INDEX `idx_web3_transactions_network_status` ON `web3_transactions` (`network_id`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_web3_transactions_status` ON `web3_transactions` (`status`);--> statement-breakpoint
CREATE INDEX `idx_web3_transactions_replacement` ON `web3_transactions` (`replacement_of_transaction_id`);--> statement-breakpoint
CREATE INDEX `idx_web3_transactions_block` ON `web3_transactions` (`network_id`,`block_number`);--> statement-breakpoint
CREATE TABLE `account_balances` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` integer NOT NULL,
	`asset_id` integer NOT NULL,
	`available_base_units` text DEFAULT '0' NOT NULL,
	`locked_base_units` text DEFAULT '0' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `financial_accounts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`asset_id`) REFERENCES `financial_assets`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ck_account_balances_available_nonnegative" CHECK("account_balances"."available_base_units" <> '' AND ltrim("account_balances"."available_base_units", '0123456789') = '' AND ("account_balances"."available_base_units" = '0' OR ltrim("account_balances"."available_base_units", '0') = "account_balances"."available_base_units")),
	CONSTRAINT "ck_account_balances_locked_nonnegative" CHECK("account_balances"."locked_base_units" <> '' AND ltrim("account_balances"."locked_base_units", '0123456789') = '' AND ("account_balances"."locked_base_units" = '0' OR ltrim("account_balances"."locked_base_units", '0') = "account_balances"."locked_base_units")),
	CONSTRAINT "ck_account_balances_version" CHECK("account_balances"."version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_account_balances_account_asset` ON `account_balances` (`account_id`,`asset_id`);--> statement-breakpoint
CREATE INDEX `idx_account_balances_account` ON `account_balances` (`account_id`);--> statement-breakpoint
CREATE INDEX `idx_account_balances_asset` ON `account_balances` (`asset_id`);--> statement-breakpoint
CREATE TABLE `asset_conversions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`financial_transaction_id` integer NOT NULL,
	`from_asset_id` integer NOT NULL,
	`to_asset_id` integer NOT NULL,
	`from_amount_base_units` text NOT NULL,
	`to_amount_base_units` text NOT NULL,
	`rate` text NOT NULL,
	`rate_source` text,
	`quoted_at` integer,
	`fee_amount_base_units` text DEFAULT '0' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`financial_transaction_id`) REFERENCES `financial_transactions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`from_asset_id`) REFERENCES `financial_assets`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`to_asset_id`) REFERENCES `financial_assets`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ck_asset_conversions_status" CHECK("asset_conversions"."status" IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),
	CONSTRAINT "ck_asset_conversions_from_amount_positive" CHECK("asset_conversions"."from_amount_base_units" <> '' AND ltrim("asset_conversions"."from_amount_base_units", '0123456789') = '' AND "asset_conversions"."from_amount_base_units" <> '0' AND ltrim("asset_conversions"."from_amount_base_units", '0') = "asset_conversions"."from_amount_base_units"),
	CONSTRAINT "ck_asset_conversions_to_amount_positive" CHECK("asset_conversions"."to_amount_base_units" <> '' AND ltrim("asset_conversions"."to_amount_base_units", '0123456789') = '' AND "asset_conversions"."to_amount_base_units" <> '0' AND ltrim("asset_conversions"."to_amount_base_units", '0') = "asset_conversions"."to_amount_base_units"),
	CONSTRAINT "ck_asset_conversions_fee_nonnegative" CHECK("asset_conversions"."fee_amount_base_units" <> '' AND ltrim("asset_conversions"."fee_amount_base_units", '0123456789') = '' AND ("asset_conversions"."fee_amount_base_units" = '0' OR ltrim("asset_conversions"."fee_amount_base_units", '0') = "asset_conversions"."fee_amount_base_units")),
	CONSTRAINT "ck_asset_conversions_different_assets" CHECK("asset_conversions"."from_asset_id" <> "asset_conversions"."to_asset_id"),
	CONSTRAINT "ck_asset_conversions_rate_positive" CHECK(CAST("asset_conversions"."rate" AS REAL) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_asset_conversions_transaction` ON `asset_conversions` (`financial_transaction_id`);--> statement-breakpoint
CREATE INDEX `idx_asset_conversions_from_asset` ON `asset_conversions` (`from_asset_id`);--> statement-breakpoint
CREATE INDEX `idx_asset_conversions_to_asset` ON `asset_conversions` (`to_asset_id`);--> statement-breakpoint
CREATE TABLE `balance_holds` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` integer NOT NULL,
	`asset_id` integer NOT NULL,
	`amount_base_units` text NOT NULL,
	`reason` text NOT NULL,
	`reference_type` text,
	`reference_id` text,
	`status` text DEFAULT 'active' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`expires_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`released_at` integer,
	FOREIGN KEY (`account_id`) REFERENCES `financial_accounts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`asset_id`) REFERENCES `financial_assets`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ck_balance_holds_status" CHECK("balance_holds"."status" IN ('active', 'released', 'expired', 'consumed')),
	CONSTRAINT "ck_balance_holds_amount_positive" CHECK("balance_holds"."amount_base_units" <> '' AND ltrim("balance_holds"."amount_base_units", '0123456789') = '' AND "balance_holds"."amount_base_units" <> '0' AND ltrim("balance_holds"."amount_base_units", '0') = "balance_holds"."amount_base_units"),
	CONSTRAINT "ck_balance_holds_released_state" CHECK("balance_holds"."status" != 'released' OR "balance_holds"."released_at" IS NOT NULL),
	CONSTRAINT "ck_balance_holds_expired_state" CHECK("balance_holds"."status" != 'expired' OR "balance_holds"."expires_at" IS NOT NULL),
	CONSTRAINT "ck_balance_holds_version" CHECK("balance_holds"."version" > 0)
);
--> statement-breakpoint
CREATE INDEX `idx_balance_holds_account` ON `balance_holds` (`account_id`);--> statement-breakpoint
CREATE INDEX `idx_balance_holds_asset` ON `balance_holds` (`asset_id`);--> statement-breakpoint
CREATE INDEX `idx_balance_holds_status` ON `balance_holds` (`status`);--> statement-breakpoint
CREATE INDEX `idx_balance_holds_reference` ON `balance_holds` (`reference_type`,`reference_id`);--> statement-breakpoint
CREATE TABLE `crypto_transactions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`financial_transaction_id` integer NOT NULL,
	`asset_id` integer NOT NULL,
	`web3_transaction_id` text,
	`direction` text NOT NULL,
	`amount_base_units` text NOT NULL,
	`fee_asset_id` integer,
	`fee_base_units` text DEFAULT '0' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`requested_at` integer NOT NULL,
	`settled_at` integer,
	FOREIGN KEY (`financial_transaction_id`) REFERENCES `financial_transactions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`asset_id`) REFERENCES `financial_assets`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`fee_asset_id`) REFERENCES `financial_assets`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ck_crypto_tx_direction" CHECK("crypto_transactions"."direction" IN ('inbound', 'outbound')),
	CONSTRAINT "ck_crypto_tx_status" CHECK("crypto_transactions"."status" IN ('pending', 'processing', 'confirmed', 'failed', 'reversed')),
	CONSTRAINT "ck_crypto_transactions_amount_positive" CHECK("crypto_transactions"."amount_base_units" <> '' AND ltrim("crypto_transactions"."amount_base_units", '0123456789') = '' AND "crypto_transactions"."amount_base_units" <> '0' AND ltrim("crypto_transactions"."amount_base_units", '0') = "crypto_transactions"."amount_base_units"),
	CONSTRAINT "ck_crypto_transactions_fee_nonnegative" CHECK("crypto_transactions"."fee_base_units" <> '' AND ltrim("crypto_transactions"."fee_base_units", '0123456789') = '' AND ("crypto_transactions"."fee_base_units" = '0' OR ltrim("crypto_transactions"."fee_base_units", '0') = "crypto_transactions"."fee_base_units")),
	CONSTRAINT "ck_crypto_transactions_fee_asset" CHECK("crypto_transactions"."fee_base_units" = '0' OR "crypto_transactions"."fee_asset_id" IS NOT NULL),
	CONSTRAINT "ck_crypto_tx_dates" CHECK("crypto_transactions"."settled_at" IS NULL OR "crypto_transactions"."settled_at" >= "crypto_transactions"."requested_at"),
	CONSTRAINT "ck_crypto_tx_version" CHECK("crypto_transactions"."version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_crypto_transactions_financial_transaction` ON `crypto_transactions` (`financial_transaction_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_crypto_transactions_web3_transaction` ON `crypto_transactions` (`web3_transaction_id`);--> statement-breakpoint
CREATE INDEX `idx_crypto_transactions_asset` ON `crypto_transactions` (`asset_id`);--> statement-breakpoint
CREATE INDEX `idx_crypto_transactions_status` ON `crypto_transactions` (`status`);--> statement-breakpoint
CREATE TABLE `exchange_rates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`base_asset_id` integer NOT NULL,
	`quote_asset_id` integer NOT NULL,
	`rate` text NOT NULL,
	`source` text NOT NULL,
	`quoted_at` integer NOT NULL,
	`expires_at` integer,
	FOREIGN KEY (`base_asset_id`) REFERENCES `financial_assets`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`quote_asset_id`) REFERENCES `financial_assets`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ck_exchange_rates_different_assets" CHECK("exchange_rates"."base_asset_id" <> "exchange_rates"."quote_asset_id"),
	CONSTRAINT "ck_exchange_rates_rate_positive" CHECK(CAST("exchange_rates"."rate" AS REAL) > 0),
	CONSTRAINT "ck_exchange_rates_expires_after_quoted" CHECK("exchange_rates"."expires_at" IS NULL OR "exchange_rates"."expires_at" >= "exchange_rates"."quoted_at")
);
--> statement-breakpoint
CREATE INDEX `idx_exchange_rates_pair` ON `exchange_rates` (`base_asset_id`,`quote_asset_id`);--> statement-breakpoint
CREATE INDEX `idx_exchange_rates_quoted` ON `exchange_rates` (`quoted_at`);--> statement-breakpoint
CREATE TABLE `fiat_accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`asset_id` integer NOT NULL,
	`provider_id` integer,
	`type` text NOT NULL,
	`external_account_id` text,
	`display_name` text,
	`last4` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`blocked_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`asset_id`) REFERENCES `financial_assets`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`provider_id`) REFERENCES `fiat_providers`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ck_fiat_accounts_type" CHECK("fiat_accounts"."type" IN ('bank_account', 'payment_account', 'pix_account')),
	CONSTRAINT "ck_fiat_accounts_status" CHECK("fiat_accounts"."status" IN ('active', 'inactive', 'blocked')),
	CONSTRAINT "ck_fiat_accounts_blocked_state" CHECK("fiat_accounts"."status" != 'blocked' OR "fiat_accounts"."blocked_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX `idx_fiat_accounts_user` ON `fiat_accounts` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_fiat_accounts_provider` ON `fiat_accounts` (`provider_id`);--> statement-breakpoint
CREATE INDEX `idx_fiat_accounts_status` ON `fiat_accounts` (`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_fiat_accounts_provider_external` ON `fiat_accounts` (`provider_id`,`external_account_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_fiat_accounts_user_account` ON `fiat_accounts` (`user_id`,`id`);--> statement-breakpoint
CREATE TABLE `fiat_external_transactions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`financial_transaction_id` integer NOT NULL,
	`provider_id` integer,
	`external_transaction_id` text NOT NULL,
	`type` text NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`financial_transaction_id`) REFERENCES `financial_transactions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`provider_id`) REFERENCES `fiat_providers`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_fiat_external_transactions_provider_external` ON `fiat_external_transactions` (`provider_id`,`external_transaction_id`);--> statement-breakpoint
CREATE INDEX `idx_fiat_external_transactions_transaction` ON `fiat_external_transactions` (`financial_transaction_id`);--> statement-breakpoint
CREATE INDEX `idx_fiat_external_transactions_provider` ON `fiat_external_transactions` (`provider_id`);--> statement-breakpoint
CREATE INDEX `idx_fiat_external_transactions_status` ON `fiat_external_transactions` (`status`);--> statement-breakpoint
CREATE TABLE `fiat_payment_methods` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`fiat_account_id` integer,
	`type` text NOT NULL,
	`label` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`blocked_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`user_id`,`fiat_account_id`) REFERENCES `fiat_accounts`(`user_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ck_fiat_pm_type" CHECK("fiat_payment_methods"."type" IN ('pix', 'bank_transfer', 'boleto', 'card')),
	CONSTRAINT "ck_fiat_pm_status" CHECK("fiat_payment_methods"."status" IN ('active', 'inactive', 'blocked')),
	CONSTRAINT "ck_fiat_pm_blocked_state" CHECK("fiat_payment_methods"."status" != 'blocked' OR "fiat_payment_methods"."blocked_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX `idx_fiat_payment_methods_user` ON `fiat_payment_methods` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_fiat_payment_methods_account` ON `fiat_payment_methods` (`fiat_account_id`);--> statement-breakpoint
CREATE INDEX `idx_fiat_payment_methods_type` ON `fiat_payment_methods` (`type`);--> statement-breakpoint
CREATE INDEX `idx_fiat_payment_methods_status` ON `fiat_payment_methods` (`status`);--> statement-breakpoint
CREATE TABLE `fiat_providers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`code` text NOT NULL,
	`type` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "ck_fiat_providers_type" CHECK("fiat_providers"."type" IN ('bank', 'payment_provider', 'pix_provider', 'gateway')),
	CONSTRAINT "ck_fiat_providers_status" CHECK("fiat_providers"."status" IN ('active', 'inactive', 'suspended'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_fiat_providers_code` ON `fiat_providers` (`code`);--> statement-breakpoint
CREATE INDEX `idx_fiat_providers_type` ON `fiat_providers` (`type`);--> statement-breakpoint
CREATE INDEX `idx_fiat_providers_status` ON `fiat_providers` (`status`);--> statement-breakpoint
CREATE TABLE `fiat_transactions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`financial_transaction_id` integer NOT NULL,
	`provider_id` integer,
	`payment_method_id` integer,
	`asset_id` integer NOT NULL,
	`direction` text NOT NULL,
	`amount_base_units` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`requested_at` integer NOT NULL,
	`processed_at` integer,
	`settled_at` integer,
	FOREIGN KEY (`financial_transaction_id`) REFERENCES `financial_transactions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`provider_id`) REFERENCES `fiat_providers`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`payment_method_id`) REFERENCES `fiat_payment_methods`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`asset_id`) REFERENCES `financial_assets`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ck_fiat_tx_direction" CHECK("fiat_transactions"."direction" IN ('inbound', 'outbound')),
	CONSTRAINT "ck_fiat_tx_status" CHECK("fiat_transactions"."status" IN ('pending', 'processing', 'completed', 'failed', 'cancelled', 'reversed')),
	CONSTRAINT "ck_fiat_transactions_amount_positive" CHECK("fiat_transactions"."amount_base_units" <> '' AND ltrim("fiat_transactions"."amount_base_units", '0123456789') = '' AND "fiat_transactions"."amount_base_units" <> '0' AND ltrim("fiat_transactions"."amount_base_units", '0') = "fiat_transactions"."amount_base_units"),
	CONSTRAINT "ck_fiat_tx_dates" CHECK("fiat_transactions"."settled_at" IS NULL OR "fiat_transactions"."settled_at" >= "fiat_transactions"."requested_at"),
	CONSTRAINT "ck_fiat_tx_version" CHECK("fiat_transactions"."version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_fiat_transactions_financial_transaction` ON `fiat_transactions` (`financial_transaction_id`);--> statement-breakpoint
CREATE INDEX `idx_fiat_transactions_provider` ON `fiat_transactions` (`provider_id`);--> statement-breakpoint
CREATE INDEX `idx_fiat_transactions_payment_method` ON `fiat_transactions` (`payment_method_id`);--> statement-breakpoint
CREATE INDEX `idx_fiat_transactions_asset` ON `fiat_transactions` (`asset_id`);--> statement-breakpoint
CREATE INDEX `idx_fiat_transactions_status` ON `fiat_transactions` (`status`);--> statement-breakpoint
CREATE TABLE `financial_accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer,
	`account_type` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`name` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ck_financial_accounts_type" CHECK("financial_accounts"."account_type" IN ('user_available', 'treasury', 'operating', 'reserve', 'fees', 'escrow')),
	CONSTRAINT "ck_financial_accounts_status" CHECK("financial_accounts"."status" IN ('active', 'inactive', 'suspended')),
	CONSTRAINT "ck_financial_accounts_owner_rule" CHECK(("financial_accounts"."account_type" = 'user_available' AND "financial_accounts"."user_id" IS NOT NULL) OR ("financial_accounts"."account_type" != 'user_available' AND "financial_accounts"."user_id" IS NULL)),
	CONSTRAINT "ck_financial_accounts_version" CHECK("financial_accounts"."version" > 0)
);
--> statement-breakpoint
CREATE INDEX `idx_financial_accounts_user` ON `financial_accounts` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_financial_accounts_type` ON `financial_accounts` (`account_type`);--> statement-breakpoint
CREATE INDEX `idx_financial_accounts_status` ON `financial_accounts` (`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_financial_accounts_user_type_name` ON `financial_accounts` (`user_id`,`account_type`,`name`);--> statement-breakpoint
CREATE TABLE `financial_assets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`symbol` text NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`decimals` integer NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "ck_financial_assets_type" CHECK("financial_assets"."type" IN ('fiat', 'crypto')),
	CONSTRAINT "ck_financial_assets_status" CHECK("financial_assets"."status" IN ('active', 'inactive')),
	CONSTRAINT "ck_financial_assets_decimals" CHECK("financial_assets"."decimals" >= 0 AND "financial_assets"."decimals" <= 18)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_financial_assets_code` ON `financial_assets` (`code`);--> statement-breakpoint
CREATE INDEX `idx_financial_assets_type` ON `financial_assets` (`type`);--> statement-breakpoint
CREATE INDEX `idx_financial_assets_status` ON `financial_assets` (`status`);--> statement-breakpoint
CREATE TABLE `financial_fees` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`transaction_id` integer NOT NULL,
	`asset_id` integer NOT NULL,
	`recipient_account_id` integer,
	`fee_type` text NOT NULL,
	`amount_base_units` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`transaction_id`) REFERENCES `financial_transactions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`asset_id`) REFERENCES `financial_assets`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`recipient_account_id`) REFERENCES `financial_accounts`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ck_financial_fees_type" CHECK("financial_fees"."fee_type" IN ('platform', 'withdrawal', 'payment', 'conversion', 'network', 'other')),
	CONSTRAINT "ck_financial_fees_amount_positive" CHECK("financial_fees"."amount_base_units" <> '' AND ltrim("financial_fees"."amount_base_units", '0123456789') = '' AND "financial_fees"."amount_base_units" <> '0' AND ltrim("financial_fees"."amount_base_units", '0') = "financial_fees"."amount_base_units")
);
--> statement-breakpoint
CREATE INDEX `idx_financial_fees_transaction` ON `financial_fees` (`transaction_id`);--> statement-breakpoint
CREATE INDEX `idx_financial_fees_asset` ON `financial_fees` (`asset_id`);--> statement-breakpoint
CREATE INDEX `idx_financial_fees_recipient_account` ON `financial_fees` (`recipient_account_id`);--> statement-breakpoint
CREATE TABLE `financial_ledger_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`transaction_id` integer NOT NULL,
	`account_id` integer NOT NULL,
	`asset_id` integer NOT NULL,
	`direction` text NOT NULL,
	`amount_base_units` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`transaction_id`) REFERENCES `financial_transactions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`account_id`) REFERENCES `financial_accounts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`asset_id`) REFERENCES `financial_assets`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ck_financial_ledger_direction" CHECK("financial_ledger_entries"."direction" IN ('debit', 'credit'))
);
--> statement-breakpoint
CREATE INDEX `idx_financial_ledger_entries_transaction` ON `financial_ledger_entries` (`transaction_id`);--> statement-breakpoint
CREATE INDEX `idx_financial_ledger_entries_account` ON `financial_ledger_entries` (`account_id`);--> statement-breakpoint
CREATE INDEX `idx_financial_ledger_entries_asset` ON `financial_ledger_entries` (`asset_id`);--> statement-breakpoint
CREATE INDEX `idx_financial_ledger_entries_created` ON `financial_ledger_entries` (`created_at`);--> statement-breakpoint
CREATE TABLE `financial_transactions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer,
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
	CONSTRAINT "ck_financial_tx_type" CHECK("financial_transactions"."type" IN ('deposit', 'withdrawal', 'transfer', 'payment', 'refund', 'fee', 'reward', 'yield', 'conversion', 'adjustment')),
	CONSTRAINT "ck_financial_tx_category" CHECK("financial_transactions"."category" IN ('membership', 'rwa_yield', 'grant', 'operational', 'payment', 'trading', 'withdrawal', 'deposit', 'fee', 'other')),
	CONSTRAINT "ck_financial_tx_status" CHECK("financial_transactions"."status" IN ('pending', 'processing', 'completed', 'failed', 'cancelled', 'reversed', 'refunded')),
	CONSTRAINT "ck_financial_tx_source_type" CHECK("financial_transactions"."source_type" IS NULL OR "financial_transactions"."source_type" IN ('contribution', 'grant', 'membership', 'payroll', 'withdrawal', 'payment', 'conversion', 'system', 'other')),
	CONSTRAINT "ck_financial_tx_completed_state" CHECK("financial_transactions"."status" != 'completed' OR "financial_transactions"."completed_at" IS NOT NULL),
	CONSTRAINT "ck_financial_tx_dates" CHECK("financial_transactions"."completed_at" IS NULL OR "financial_transactions"."completed_at" >= "financial_transactions"."created_at"),
	CONSTRAINT "ck_financial_tx_version" CHECK("financial_transactions"."version" > 0)
);
--> statement-breakpoint
CREATE INDEX `idx_financial_transactions_user` ON `financial_transactions` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_financial_transactions_type` ON `financial_transactions` (`type`);--> statement-breakpoint
CREATE INDEX `idx_financial_transactions_status` ON `financial_transactions` (`status`);--> statement-breakpoint
CREATE INDEX `idx_financial_transactions_created` ON `financial_transactions` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_financial_transactions_correlation` ON `financial_transactions` (`correlation_id`);--> statement-breakpoint
CREATE TABLE `idempotency_keys` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer,
	`scope` text NOT NULL,
	`key` text NOT NULL,
	`request_hash` text NOT NULL,
	`financial_transaction_id` integer,
	`status` text DEFAULT 'processing' NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`financial_transaction_id`) REFERENCES `financial_transactions`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ck_idempotency_keys_status" CHECK("idempotency_keys"."status" IN ('processing', 'completed', 'failed')),
	CONSTRAINT "ck_idempotency_keys_expires" CHECK("idempotency_keys"."expires_at" IS NULL OR "idempotency_keys"."created_at" < "idempotency_keys"."expires_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_idempotency_scope_key` ON `idempotency_keys` (`scope`,`key`);--> statement-breakpoint
CREATE INDEX `idx_idempotency_keys_user` ON `idempotency_keys` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_idempotency_keys_transaction` ON `idempotency_keys` (`financial_transaction_id`);--> statement-breakpoint
CREATE INDEX `idx_idempotency_keys_status` ON `idempotency_keys` (`status`);--> statement-breakpoint
CREATE TABLE `reconciliation_records` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`provider_id` integer,
	`account_id` integer NOT NULL,
	`asset_id` integer NOT NULL,
	`expected_balance_base_units` text NOT NULL,
	`actual_balance_base_units` text NOT NULL,
	`difference_base_units` text NOT NULL,
	`status` text DEFAULT 'matched' NOT NULL,
	`reconciliation_run_id` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`reconciliation_date` integer NOT NULL,
	`resolved_at` integer,
	FOREIGN KEY (`provider_id`) REFERENCES `fiat_providers`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`account_id`) REFERENCES `financial_accounts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`asset_id`) REFERENCES `financial_assets`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ck_reconciliation_status" CHECK("reconciliation_records"."status" IN ('matched', 'mismatch', 'resolved')),
	CONSTRAINT "ck_reconciliation_resolved_state" CHECK("reconciliation_records"."status" != 'resolved' OR "reconciliation_records"."resolved_at" IS NOT NULL),
	CONSTRAINT "ck_reconciliation_records_version" CHECK("reconciliation_records"."version" > 0),
	CONSTRAINT "ck_reconciliation_expected_nonnegative" CHECK("reconciliation_records"."expected_balance_base_units" <> '' AND ltrim("reconciliation_records"."expected_balance_base_units", '0123456789') = '' AND ("reconciliation_records"."expected_balance_base_units" = '0' OR ltrim("reconciliation_records"."expected_balance_base_units", '0') = "reconciliation_records"."expected_balance_base_units")),
	CONSTRAINT "ck_reconciliation_actual_nonnegative" CHECK("reconciliation_records"."actual_balance_base_units" <> '' AND ltrim("reconciliation_records"."actual_balance_base_units", '0123456789') = '' AND ("reconciliation_records"."actual_balance_base_units" = '0' OR ltrim("reconciliation_records"."actual_balance_base_units", '0') = "reconciliation_records"."actual_balance_base_units"))
);
--> statement-breakpoint
CREATE INDEX `idx_reconciliation_records_account` ON `reconciliation_records` (`account_id`);--> statement-breakpoint
CREATE INDEX `idx_reconciliation_records_asset` ON `reconciliation_records` (`asset_id`);--> statement-breakpoint
CREATE INDEX `idx_reconciliation_records_provider` ON `reconciliation_records` (`provider_id`);--> statement-breakpoint
CREATE INDEX `idx_reconciliation_records_status` ON `reconciliation_records` (`status`);--> statement-breakpoint
CREATE TABLE `integration_configs` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`category` text NOT NULL,
	`environment` text DEFAULT 'production' NOT NULL,
	`base_url` text,
	`sandbox_mode` integer DEFAULT false,
	`risk_classification` text DEFAULT 'MEDIUM' NOT NULL,
	`rotation_interval_days` integer,
	`next_rotation_at` integer,
	`status` text DEFAULT 'missing',
	`dependencies` text,
	`created_at` integer DEFAULT (strftime('%s', 'now')),
	`updated_at` integer DEFAULT (strftime('%s', 'now'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_integration_provider_env` ON `integration_configs` (`provider`,`environment`);--> statement-breakpoint
CREATE TABLE `integration_secret_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`secret_id` text NOT NULL,
	`encrypted_value` text NOT NULL,
	`version` integer NOT NULL,
	`created_at` integer DEFAULT (strftime('%s', 'now')),
	`created_by` integer,
	FOREIGN KEY (`secret_id`) REFERENCES `integration_secrets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `integration_secrets` (
	`id` text PRIMARY KEY NOT NULL,
	`config_id` text NOT NULL,
	`key_name` text NOT NULL,
	`encrypted_value` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`scopes_allowed` text,
	`lease_expires_at` integer,
	`owner_role` text DEFAULT 'dev',
	`owner_user_id` integer,
	`updated_by` integer,
	`updated_at` integer DEFAULT (strftime('%s', 'now')),
	FOREIGN KEY (`config_id`) REFERENCES `integration_configs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_integration_secret_config_key` ON `integration_secrets` (`config_id`,`key_name`);--> statement-breakpoint
CREATE TABLE `user_consents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`consent_type` text NOT NULL,
	`policy_version` text NOT NULL,
	`status` text NOT NULL,
	`source` text,
	`ip_address` text,
	`user_agent` text,
	`metadata` text,
	`accepted_at` integer,
	`revoked_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_consents_user` ON `user_consents` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_consents_type_version` ON `user_consents` (`consent_type`,`policy_version`);--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`actor_id` integer,
	`target_user_id` integer,
	`action` text NOT NULL,
	`status` text DEFAULT 'success',
	`ip_address` text,
	`metadata` text,
	`created_at` integer DEFAULT (strftime('%s', 'now')),
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`target_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_audit_action` ON `audit_logs` (`action`);--> statement-breakpoint
CREATE INDEX `idx_audit_actor` ON `audit_logs` (`actor_id`);--> statement-breakpoint
CREATE TABLE `audit_logs_immutable` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` integer,
	`actor_ip` text,
	`actor_user_agent` text,
	`action` text NOT NULL,
	`resource` text,
	`event_hash` text NOT NULL,
	`previous_hash` text,
	`reason` text,
	`status` text DEFAULT 'success',
	`created_at` integer DEFAULT (strftime('%s', 'now')),
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `audit_logs_immutable_event_hash_unique` ON `audit_logs_immutable` (`event_hash`);--> statement-breakpoint
CREATE TABLE `security_events` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer,
	`wallet_id` integer,
	`authenticator_id` text,
	`session_id` text,
	`event` text NOT NULL,
	`result` text NOT NULL,
	`source` text,
	`ip_address` text,
	`user_agent` text,
	`request_id` text,
	`correlation_id` text,
	`metadata` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`wallet_id`) REFERENCES `wallets`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`authenticator_id`) REFERENCES `user_authenticators`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`session_id`) REFERENCES `user_sessions`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "security_events_event_check" CHECK("security_events"."event" IN ('authentication_succeeded', 'authentication_failed', 'credential_created', 'credential_verified', 'credential_revoked', 'password_changed', 'password_reset_requested', 'passkey_registered', 'passkey_used', 'totp_enabled', 'totp_verified', 'wallet_linked', 'wallet_verified', 'wallet_authenticated', 'wallet_suspended', 'wallet_revoked', 'wallet_unlinked', 'recovery_code_consumed', 'account_locked', 'account_unlocked', 'auth_epoch_incremented')),
	CONSTRAINT "security_events_result_check" CHECK("security_events"."result" IN ('success', 'failure', 'denied'))
);
--> statement-breakpoint
CREATE INDEX `idx_security_events_user_created` ON `security_events` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_security_events_wallet_created` ON `security_events` (`wallet_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_security_events_auth` ON `security_events` (`authenticator_id`);--> statement-breakpoint
CREATE TABLE `outbox_events` (
	`id` text PRIMARY KEY NOT NULL,
	`aggregate_id` integer NOT NULL,
	`aggregate_type` text NOT NULL,
	`aggregate_version` integer NOT NULL,
	`event_name` text NOT NULL,
	`payload` text NOT NULL,
	`metadata` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`published` integer DEFAULT false NOT NULL,
	`published_at` integer,
	`error` text,
	`created_at` integer DEFAULT (strftime('%s', 'now')) NOT NULL
);
