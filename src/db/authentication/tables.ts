import {
  sqliteTable,
  text,
  integer,
  index,
  check,
} from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { users } from '../user/tables';
import { AUTH_TYPES } from '../constants';

/**
 * ============================================================================
 * AUTHENTICATION DOMAIN
 * ============================================================================
 *
 * Bounded Context Boundaries:
 * - User/actor identity is owned by user/
 * - Web3 Evm Wallets are owned by web3/
 * - Authentication domain owns authenticators, credentials, sessions, and auth challenges.
 *
 * Security & Persistence Standard:
 * - Credentials and session storage rely on standard Unix Epoch timestamps.
 * - Sensitive secrets (hashes, tokens) are NEVER logged or stored in unencrypted metadata.
 * ============================================================================
 */

// ----------------------------------------------------------------------
// Entity: userAuthenticators
// ----------------------------------------------------------------------
export const userAuthenticators = sqliteTable(
  'user_authenticators',
  {
    id: text('id').primaryKey(), // UUID v4

    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    type: text('type', { enum: AUTH_TYPES }).notNull(),
    label: text('label'),

    verifiedAt: integer('verified_at', { mode: 'timestamp' }),
    lastUsedAt: integer('last_used_at', { mode: 'timestamp' }),

    revokedAt: integer('revoked_at', { mode: 'timestamp' }),
    revokedBy: integer('revoked_by').references(() => users.id, { onDelete: 'set null' }),
    revocationReason: text('revocation_reason'),

    // SECURITY:
    // metadata is non-secret operational metadata only.
    // NEVER store: password hashes, TOTP secrets, private keys,
    // recovery codes, session tokens, or bearer credentials.
    metadata: text('metadata', { mode: 'json' }),

    createdAt: integer('created_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (table) => ({
    userTypeRevokedIdx: index('idx_authenticators_user_type_revoked').on(
      table.userId,
      table.type,
      table.revokedAt
    ),
    typeCheck: check(
      'user_authenticators_type_check',
      sql`${table.type} IN ('password', 'totp', 'webauthn', 'recovery_code', 'wallet')`
    ),
    revokedStateCheck: check(
      'user_authenticators_revoked_state_check',
      sql`${table.revokedAt} IS NOT NULL OR ${table.revocationReason} IS NULL`
    ),
  })
);

// ----------------------------------------------------------------------
// Entity: passwordCredentials
// ----------------------------------------------------------------------
export const passwordCredentials = sqliteTable('password_credentials', {
  authenticatorId: text('authenticator_id')
    .primaryKey()
    .references(() => userAuthenticators.id, { onDelete: 'cascade' }),
  passwordHash: text('password_hash').notNull(), // Argon2id hash com parâmetros embutidos
});

// ----------------------------------------------------------------------
// Entity: webauthnCredentials
// ----------------------------------------------------------------------
export const webauthnCredentials = sqliteTable(
  'webauthn_credentials',
  {
    authenticatorId: text('authenticator_id')
      .primaryKey()
      .references(() => userAuthenticators.id, { onDelete: 'cascade' }),
    credentialId: text('credential_id').notNull().unique(),
    publicKeyCose: text('public_key_cose').notNull(),
    rpId: text('rp_id').notNull(),
    userHandle: text('user_handle'), // nullable pois nem todo webauthn é discoverable/resident
    signCount: integer('sign_count').notNull().default(0),
    transports: text('transports', { mode: 'json' }),
    backupEligible: integer('backup_eligible', { mode: 'boolean' }).notNull(),
    backupState: integer('backup_state', { mode: 'boolean' }).notNull(),
    uvInitialized: integer('uv_initialized', { mode: 'boolean' }).notNull(),
    aaguid: text('aaguid'),
    attestationFormat: text('attestation_format'),
    attestationObject: text('attestation_object'),
  },
  (table) => ({
    signCountCheck: check('webauthn_sign_count_check', sql`${table.signCount} >= 0`),
    rpIdCheck: check('webauthn_rpid_check', sql`length(${table.rpId}) > 0`),
    backupStateCheck: check(
      'webauthn_backup_state_check',
      sql`${table.backupState} = 0 OR ${table.backupEligible} = 1`
    ),
  })
);

// ----------------------------------------------------------------------
// Entity: totpCredentials
// ----------------------------------------------------------------------
export const totpCredentials = sqliteTable(
  'totp_credentials',
  {
    authenticatorId: text('authenticator_id')
      .primaryKey()
      .references(() => userAuthenticators.id, { onDelete: 'cascade' }),
    encryptedTotpSecret: text('encrypted_totp_secret').notNull(),
    algorithm: text('algorithm').notNull().default('SHA1'),
    digits: integer('digits').notNull().default(6),
    period: integer('period').notNull().default(30),
  },
  (table) => ({
    digitsCheck: check('totp_digits_check', sql`${table.digits} IN (6, 8)`),
    periodCheck: check('totp_period_check', sql`${table.period} IN (30, 60)`),
    algorithmCheck: check(
      'totp_algorithm_check',
      sql`${table.algorithm} IN ('SHA1', 'SHA256', 'SHA512')`
    ),
  })
);

// ----------------------------------------------------------------------
// Entity: recoverySets
// ----------------------------------------------------------------------
export const recoverySets = sqliteTable('recovery_sets', {
  id: text('id').primaryKey(),
  authenticatorId: text('authenticator_id')
    .unique()
    .references(() => userAuthenticators.id, { onDelete: 'cascade' })
    .notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .default(sql`(unixepoch())`)
    .notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }),
  revokedAt: integer('revoked_at', { mode: 'timestamp' }),
});

// ----------------------------------------------------------------------
// Entity: recoveryCredentials
// ----------------------------------------------------------------------
export const recoveryCredentials = sqliteTable(
  'recovery_credentials',
  {
    id: text('id').primaryKey(),
    recoverySetId: text('recovery_set_id')
      .references(() => recoverySets.id, { onDelete: 'cascade' })
      .notNull(),
    codeHash: text('code_hash').notNull(), // Argon2id hash
    consumedAt: integer('consumed_at', { mode: 'timestamp' }),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull(),
  },
  (table) => ({
    recoverySetIdx: index('idx_recovery_credentials_set').on(table.recoverySetId),
  })
);

// ----------------------------------------------------------------------
// Entity: passwordResets
// ----------------------------------------------------------------------
export const passwordResets = sqliteTable(
  'password_resets',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
    usedAt: integer('used_at', { mode: 'timestamp' }),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull(),
  },
  (table) => ({
    expiresAtIdx: index('idx_password_resets_expires').on(table.expiresAt),
    usedStateCheck: check(
      'password_resets_used_state_check',
      sql`${table.usedAt} IS NULL OR ${table.usedAt} >= ${table.createdAt}`
    ),
  })
);

// ----------------------------------------------------------------------
// Entity: refreshTokenFamilies
// ----------------------------------------------------------------------
export const refreshTokenFamilies = sqliteTable(
  'refresh_token_families',
  {
    id: text('id').primaryKey(), // UUID da família de tokens
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    revokedAt: integer('revoked_at', { mode: 'timestamp' }),
    revocationReason: text('revocation_reason'),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull(),
  },
  (table) => ({
    userIdIdx: index('idx_refresh_families_user').on(table.userId),
    revokedStateCheck: check(
      'refresh_families_revoked_state_check',
      sql`${table.revokedAt} IS NOT NULL OR ${table.revocationReason} IS NULL`
    ),
  })
);

// ----------------------------------------------------------------------
// Entity: userSessions
// ----------------------------------------------------------------------
export const userSessions = sqliteTable(
  'user_sessions',
  {
    id: text('id').primaryKey(), // UUID da sessão
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    jti: text('jti').notNull().unique(),
    ip: text('ip'),
    userAgent: text('user_agent'),
    familyId: text('family_id') // Adicionado relacionamento com a família
      .references(() => refreshTokenFamilies.id, { onDelete: 'cascade' }),
    refreshTokenHash: text('refresh_token_hash').notNull(),
    aal: integer('aal').notNull().default(1),
    authEpoch: integer('auth_epoch').notNull().default(1),
    lastActivityAt: integer('last_activity_at', { mode: 'timestamp' }),
    lastAuthenticatedAt: integer('last_authenticated_at', { mode: 'timestamp' }),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
    revokedAt: integer('revoked_at', { mode: 'timestamp' }),
    revocationReason: text('revocation_reason'),
  },
  (table) => ({
    userIdIdx: index('idx_sessions_user').on(table.userId),
    familyIdIdx: index('idx_sessions_family').on(table.familyId),
    expiresAtIdx: index('idx_sessions_expires').on(table.expiresAt),
    aalCheck: check('user_sessions_aal_check', sql`${table.aal} IN (1, 2, 3)`),
    expirationCheck: check(
      'user_sessions_expiration_check',
      sql`${table.createdAt} < ${table.expiresAt}`
    ),
    revokedStateCheck: check(
      'user_sessions_revoked_state_check',
      sql`${table.revokedAt} IS NOT NULL OR ${table.revocationReason} IS NULL`
    ),
  })
);

// ----------------------------------------------------------------------
// Entity: authChallenges
// ----------------------------------------------------------------------
export const authChallenges = sqliteTable(
  'auth_challenges',
  {
    id: text('id').primaryKey(), // UUID do desafio
    transactionId: text('transaction_id').references(() => authTransactions.id, { onDelete: 'cascade' }),
    userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }),
    challengeHash: text('challenge_hash').notNull(),
    challengeType: text('challenge_type').notNull(), // 'ssh', 'totp', 'webauthn', 'siwe'
    context: text('context').notNull(), // 'login', 'mfa_setup', 'mfa_change', 'credential_link', 'credential_unlink', 'sensitive_operation', 'password_change', 'recovery'
    usedAt: integer('used_at', { mode: 'timestamp' }),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  },
  (table) => ({
    transactionIdIdx: index('idx_auth_challenges_transaction').on(table.transactionId),
    expiresAtIdx: index('idx_auth_challenges_expires').on(table.expiresAt),
    typeCheck: check(
      'auth_challenges_type_check',
      sql`${table.challengeType} IN ('ssh', 'totp', 'webauthn', 'siwe')`
    ),
    contextCheck: check(
      'auth_challenges_context_check',
      sql`${table.context} IN ('login', 'mfa_setup', 'mfa_change', 'credential_link', 'credential_unlink', 'sensitive_operation', 'password_change', 'recovery')`
    ),
    expirationCheck: check(
      'auth_challenges_expiration_check',
      sql`${table.createdAt} < ${table.expiresAt}`
    ),
    usedStateCheck: check(
      'auth_challenges_used_state_check',
      sql`${table.usedAt} IS NULL OR ${table.usedAt} >= ${table.createdAt}`
    ),
  })
);

// ----------------------------------------------------------------------
// Entity: authTransactions
// ----------------------------------------------------------------------
export const authTransactions = sqliteTable(
  'auth_transactions',
  {
    id: text('id').primaryKey(), // UUID v4
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: text('status', { enum: ['created', 'awaiting_factor', 'verified', 'completed', 'expired', 'cancelled', 'failed', 'replayed', 'locked'] })
      .notNull()
      .default('created'),
    initialAal: integer('initial_aal').notNull().default(1),
    currentAal: integer('current_aal').notNull().default(1),
    targetAal: integer('target_aal').notNull().default(2),
    method: text('method').notNull(), // ex: 'password', 'totp', 'webauthn', 'siwe'
    challengeHash: text('challenge_hash'),
    context: text('context').notNull(), // 'login', 'mfa_setup', 'mfa_change', 'credential_link', 'credential_unlink', 'sensitive_operation', 'password_change', 'recovery'
    ip: text('ip'),
    userAgent: text('user_agent'),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
    completedAt: integer('completed_at', { mode: 'timestamp' }),
    consumedAt: integer('consumed_at', { mode: 'timestamp' }),
    failureCount: integer('failure_count').notNull().default(0),
    authEpochAtStart: integer('auth_epoch_at_start').notNull(),
    lastAuthenticatedAt: integer('last_authenticated_at', { mode: 'timestamp' }),
    assuranceMethod: text('assurance_method'),
    riskLevel: text('risk_level', { enum: ['low', 'medium', 'high', 'critical'] }).notNull().default('low'),
  },
  (table) => ({
    userIdIdx: index('idx_auth_transactions_user').on(table.userId),
    expiresAtIdx: index('idx_auth_transactions_expires').on(table.expiresAt),
    statusCheck: check(
      'auth_transactions_status_check',
      sql`${table.status} IN ('created', 'awaiting_factor', 'verified', 'completed', 'expired', 'cancelled', 'failed', 'replayed', 'locked')`
    ),
    contextCheck: check(
      'auth_transactions_context_check',
      sql`${table.context} IN ('login', 'mfa_setup', 'mfa_change', 'credential_link', 'credential_unlink', 'sensitive_operation', 'password_change', 'recovery')`
    ),
    expirationCheck: check(
      'auth_transactions_expiration_check',
      sql`${table.createdAt} < ${table.expiresAt}`
    ),
  })
);

// ----------------------------------------------------------------------
// Entity: walletAuthenticators
// ----------------------------------------------------------------------
export const walletAuthenticators = sqliteTable(
  'wallet_authenticators',
  {
    authenticatorId: text('authenticator_id')
      .primaryKey()
      .references(() => userAuthenticators.id, { onDelete: 'cascade' }),
    /**
     * Opaque reference to web3.wallets.id.
     * Intentionally NOT a physical FK — authentication MUST NOT depend on
     * web3 (Cross-Domain Dependency Matrix). Integrity is enforced at the
     * application layer via IWeb3Repository at link-time
     * (LinkExternalIdentityUseCase / VerifyExternalIdentityUseCase).
     */
    walletId: integer('wallet_id').unique().notNull(),
    protocol: text('protocol', { enum: ['siwe', 'eip191', 'eip712', 'eip1271'] })
      .notNull()
      .default('siwe'),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (table) => ({
    protocolCheck: check(
      'wallet_authenticators_protocol_check',
      sql`${table.protocol} IN ('siwe', 'eip191', 'eip712', 'eip1271')`
    ),
  })
);
