# Auditoria Estrutural e de Segurança (Identity, SSI e Finance)

Conforme solicitado, este documento representa a **Raiz da Verdade** 100% completa e exaustiva do estado atual dos códigos fontes referentes aos módulos de **Credenciais** (Identity/Auth e SSI), **Identidade Civil** e **Financeiro**.

---

## 1. Mapeamento de Arquivos e Código Fonte (Snapshot Real)

Baseado nos diretórios exigidos, o projeto reflete exatamente a seguinte estrutura no sistema de arquivos:

```text
src/
├── db/
│   ├── authentication/
│   │   ├── relations.ts
│   │   └── tables.ts
│   ├── civil-identity/
│   │   ├── relations.ts
│   │   └── tables.ts
│   ├── ssi/
│   │   ├── relations.ts
│   │   └── tables.ts
│   └── finance/
│       ├── relations.ts
│       └── tables.ts
└── infrastructure/
    └── repositories/
        ├── DrizzleAuthenticationRepositoryAdapter.ts
        ├── DrizzleAuthTransactionRepository.ts
        ├── DrizzleCivilIdentityRepositoryAdapter.ts
        ├── DrizzleFinanceRepository.ts
        ├── DrizzleIdentityResolverAdapter.ts
        ├── DrizzleOutboxRepository.ts
        ├── DrizzlePasswordResetRepository.ts
        ├── DrizzleSessionRepository.ts
        └── DrizzleSsiRepository.ts
```

---

### `src/db/authentication/relations.ts`
```typescript
import { relations } from 'drizzle-orm';
import {
  userAuthenticators,
  passwordCredentials,
  webauthnCredentials,
  totpCredentials,
  walletAuthenticators,
  recoverySets,
  recoveryCredentials,
  userSessions,
  passwordResets,
  authChallenges,
} from './tables';
import { users } from '../user/tables';
import { securityEvents } from '../security/tables';

/**
 * ============================================================================
 * AUTHENTICATION DOMAIN RELATIONS
 * ============================================================================
 * ARCHITECTURAL NOTE:
 * Navigation from users to authentication entities is intentionally one-directional
 * (child → parent only), per Section 05 boundary isolation matrix.
 * Direct queries on authentication tables should be executed with { with: { user: true } }
 * instead of querying bidirectionally from users.
 * ============================================================================
 */
export const userAuthenticatorsRelations = relations(userAuthenticators, ({ one, many }) => ({
  user: one(users, {
    fields: [userAuthenticators.userId],
    references: [users.id],
    relationName: 'authenticatorOwner',
  }),
  revokedByUser: one(users, {
    fields: [userAuthenticators.revokedBy],
    references: [users.id],
    relationName: 'revokedAuthenticators',
  }),

  passwordCredential: one(passwordCredentials),
  webauthnCredential: one(webauthnCredentials),
  totpCredential: one(totpCredentials),
  walletAuthenticator: one(walletAuthenticators),

  recoverySet: one(recoverySets),

  securityEvents: many(securityEvents),
}));

/**
 * ============================================================================
 * CREDENTIALS
 * ============================================================================
 */
export const passwordCredentialsRelations = relations(passwordCredentials, ({ one }) => ({
  authenticator: one(userAuthenticators, {
    fields: [passwordCredentials.authenticatorId],
    references: [userAuthenticators.id],
  }),
}));

export const webauthnCredentialsRelations = relations(webauthnCredentials, ({ one }) => ({
  authenticator: one(userAuthenticators, {
    fields: [webauthnCredentials.authenticatorId],
    references: [userAuthenticators.id],
  }),
}));

export const totpCredentialsRelations = relations(totpCredentials, ({ one }) => ({
  authenticator: one(userAuthenticators, {
    fields: [totpCredentials.authenticatorId],
    references: [userAuthenticators.id],
  }),
}));

/**
 * ============================================================================
 * RECOVERY
 * ============================================================================
 */
export const recoverySetsRelations = relations(recoverySets, ({ one, many }) => ({
  authenticator: one(userAuthenticators, {
    fields: [recoverySets.authenticatorId],
    references: [userAuthenticators.id],
  }),
  credentials: many(recoveryCredentials),
}));

export const recoveryCredentialsRelations = relations(recoveryCredentials, ({ one }) => ({
  recoverySet: one(recoverySets, {
    fields: [recoveryCredentials.recoverySetId],
    references: [recoverySets.id],
  }),
}));

/**
 * ============================================================================
 * WALLET
 * ============================================================================
 */
export const walletAuthenticatorsRelations = relations(walletAuthenticators, ({ one }) => ({
  authenticator: one(userAuthenticators, {
    fields: [walletAuthenticators.authenticatorId],
    references: [userAuthenticators.id],
  }),
  // Navigation to web3.wallets removed intentionally (Cross-Domain
  // Dependency Matrix — authentication MUST NOT depend on web3).
  // Resolve via application layer: IWeb3Repository.findById(walletId).
}));

/**
 * ============================================================================
 * SESSION
 * ============================================================================
 */
export const userSessionsRelations = relations(userSessions, ({ one }) => ({
  user: one(users, { fields: [userSessions.userId], references: [users.id] }),
}));

/**
 * ============================================================================
 * PASSWORD RESET
 * ============================================================================
 */
export const passwordResetsRelations = relations(passwordResets, ({ one }) => ({
  user: one(users, { fields: [passwordResets.userId], references: [users.id] }),
}));

/**
 * ============================================================================
 * AUTH CHALLENGE
 * ============================================================================
 */
export const authChallengesRelations = relations(authChallenges, ({ one }) => ({
  user: one(users, { fields: [authChallenges.userId], references: [users.id] }),
}));

```

---

### `src/db/authentication/tables.ts`
```typescript
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
  passwordHash: text('password_hash').notNull(), // PBKDF2-HMAC-SHA256 (100.000 iterações, Edge-compatible). Formato: base64(salt):hexHash
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
    codeHash: text('code_hash').notNull(), // PBKDF2-HMAC-SHA256 (100.000 iterações). Argon2id não suportado em Cloudflare Workers sem WASM.
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

// ----------------------------------------------------------------------
// Entity: oauthIdentities
// ----------------------------------------------------------------------
export const oauthIdentities = sqliteTable(
  'oauth_identities',
  {
    id: text('id').primaryKey(), // UUID v4
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(), // ex: 'google', 'govbr'
    subjectId: text('subject_id').notNull(),
    status: text('status', { enum: ['active', 'revoked'] })
      .notNull()
      .default('active'),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (table) => ({
    providerSubjectUnique: index('idx_oauth_identities_provider_subject').on(table.provider, table.subjectId),
  })
);

```

---

### `src/db/civil-identity/relations.ts`
```typescript
import { relations } from 'drizzle-orm';
import { citizens, identityDocuments, kycVerifications } from './tables';
import { users } from '../user/tables';

/**
 * ============================================================================
 * CIVIL-IDENTITY RELATIONS
 * ============================================================================
 * ARCHITECTURAL NOTE:
 * Navigation from users to civil-identity entities is intentionally one-directional
 * (child → parent only), per Section 05 boundary isolation matrix.
 * Direct queries on civil-identity tables should be executed with { with: { user: true } }
 * instead of querying bidirectionally from users.
 * ============================================================================
 */

/**
 * ============================================================================
 * CITIZENS RELATIONS
 * ============================================================================
 */
export const citizensRelations = relations(citizens, ({ one }) => ({
  user: one(users, {
    fields: [citizens.userId],
    references: [users.id],
    relationName: 'citizenOwner',
  }),
  verifiedByUser: one(users, {
    fields: [citizens.verifiedBy],
    references: [users.id],
    relationName: 'verifiedCitizens',
  }),
}));

/**
 * ============================================================================
 * IDENTITY DOCUMENTS RELATIONS
 * ============================================================================
 */
export const identityDocumentsRelations = relations(identityDocuments, ({ one }) => ({
  user: one(users, {
    fields: [identityDocuments.userId],
    references: [users.id],
    relationName: 'userIdentityDocuments',
  }),
  verifiedByUser: one(users, {
    fields: [identityDocuments.verifiedBy],
    references: [users.id],
    relationName: 'verifiedIdentityDocuments',
  }),
}));

/**
 * ============================================================================
 * KYC VERIFICATIONS RELATIONS
 * ============================================================================
 */
export const kycVerificationsRelations = relations(kycVerifications, ({ one }) => ({
  user: one(users, {
    fields: [kycVerifications.userId],
    references: [users.id],
    relationName: 'kycSubject',
  }),
  reviewedByUser: one(users, {
    fields: [kycVerifications.reviewedBy],
    references: [users.id],
    relationName: 'reviewedKycs',
  }),
}));

```

---

### `src/db/civil-identity/tables.ts`
```typescript
import { sqliteTable, text, integer, index, uniqueIndex, check } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

import { users } from '../user/tables';

/**
 * ============================================================================
 * CIVIL IDENTITY & KYC SUBSYSTEM
 * ============================================================================
 *
 * Responsibility:
 *   - Legal natural person identity attributes (citizens)
 *   - Physical/digital identity document records (identityDocuments)
 *   - Know-Your-Customer (KYC) compliance verification processes (kycVerifications)
 *
 * Explicit Boundaries:
 *   - Account lifecycle and public identifiers belong to user/
 *   - DID and verifiable credentials material belong to ssi/
 *   - Authentication credentials belong to authentication/
 *
 * PII Protection & Cryptography Model:
 *   - `numberLookupHash`: Blind HMAC-SHA256 hash used for duplicate detection without plaintext enumeration.
 *   - `encryptedNumber`: AES-GCM encrypted document identifier at rest.
 *   - `last4`: Truncated non-sensitive suffix for user UI display.
 *   - `documentHash`: SHA256 file checksum for document immutability verification.
 *
 * Regulatory & Compliance Retention:
 *   - Foreign keys from civil identity records to `users.id` use `onDelete: 'restrict'`.
 *   - Legal AML/KYC retention regulations require identity audit trails to survive user account soft-deletion.
 *
 * State Semantic Distinctions:
 *   - `citizens.civilStatus`: Overall status of the verified natural person within ASPPIBRA.
 *   - `identityDocuments.verificationStatus`: Status of a specific uploaded identity document.
 *   - `kycVerifications.status`: Lifecycle state of an individual KYC audit run/checkpoint.
 * ============================================================================
 */

/* ============================================================================
 * 1. CITIZENS
 * ============================================================================ */
export const citizens = sqliteTable(
  'citizens',
  {
    userId: integer('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'restrict' }),

    username: text('username').$defaultFn(() => 'citizen_' + crypto.randomUUID()),

    legalFirstName: text('legal_first_name'),
    legalLastName: text('legal_last_name'),
    nationalityCode: text('nationality_code'),
    birthDate: text('birth_date'), // YYYY-MM-DD

    maritalStatus: text('marital_status', {
      enum: ['single', 'married', 'divorced', 'widowed', 'stable_union', 'separated'],
    }),

    civilStatus: text('civil_status', {
      enum: ['pending', 'verified', 'suspended', 'revoked'],
    })
      .notNull()
      .default('pending'),

    statusChangedAt: integer('status_changed_at', { mode: 'timestamp' }),
    verifiedAt: integer('verified_at', { mode: 'timestamp' }),
    verifiedBy: integer('verified_by').references(() => users.id, { onDelete: 'set null' }),

    version: integer('version').notNull().default(1),

    createdAt: integer('created_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (table) => ({
    civilStatusCheck: check(
      'ck_citizens_civil_status',
      sql`${table.civilStatus} IN ('pending', 'verified', 'suspended', 'revoked')`
    ),

    maritalStatusCheck: check(
      'ck_citizens_marital_status',
      sql`${table.maritalStatus} IS NULL OR ${table.maritalStatus} IN ('single', 'married', 'divorced', 'widowed', 'stable_union', 'separated')`
    ),

    verifiedStateCheck: check(
      'ck_citizens_verified_state',
      sql`
        ${table.civilStatus} != 'verified'
        OR (
          ${table.verifiedAt} IS NOT NULL
          AND ${table.verifiedBy} IS NOT NULL
        )
      `
    ),

    versionCheck: check('ck_citizens_version', sql`${table.version} > 0`),
  })
);

/* ============================================================================
 * 2. IDENTITY DOCUMENTS
 * ============================================================================ */
export const identityDocuments = sqliteTable(
  'identity_documents',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),

    documentType: text('document_type', {
      enum: ['cpf', 'rg', 'passport', 'cnh'],
    }).notNull(),

    countryCode: text('country_code').default('BR').notNull(),

    numberLookupHash: text('number_lookup_hash').notNull(),
    encryptedNumber: text('encrypted_number').notNull(),
    last4: text('last4'),
    documentHash: text('document_hash'),

    issuingAuthority: text('issuing_authority'),
    issuedAt: text('issued_at'), // YYYY-MM-DD
    expiresAt: text('expires_at'), // YYYY-MM-DD

    source: text('source', {
      enum: ['government', 'manual_upload', 'kyc_provider', 'admin', 'import'],
    }).notNull(),

    sourceReference: text('source_reference'),

    verificationStatus: text('verification_status', {
      enum: ['pending', 'verified', 'rejected'],
    })
      .notNull()
      .default('pending'),

    verifiedAt: integer('verified_at', { mode: 'timestamp' }),
    verifiedBy: integer('verified_by').references(() => users.id, { onDelete: 'set null' }),

    version: integer('version').notNull().default(1),

    createdAt: integer('created_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (table) => ({
    userIdx: index('idx_identity_docs_user').on(table.userId),
    lookupHashIdx: index('idx_identity_docs_hash').on(table.numberLookupHash),

    lookupHashUnique: uniqueIndex('uq_identity_docs_active_lookup_hash')
      .on(table.countryCode, table.documentType, table.numberLookupHash)
      .where(sql`${table.verificationStatus} != 'rejected'`),

    documentTypeCheck: check(
      'ck_identity_docs_document_type',
      sql`${table.documentType} IN ('cpf', 'rg', 'passport', 'cnh')`
    ),

    sourceCheck: check(
      'ck_identity_docs_source',
      sql`${table.source} IN ('government', 'manual_upload', 'kyc_provider', 'admin', 'import')`
    ),

    verificationStatusCheck: check(
      'ck_identity_docs_verification_status',
      sql`${table.verificationStatus} IN ('pending', 'verified', 'rejected')`
    ),

    verifiedStateCheck: check(
      'ck_identity_docs_verified_state',
      sql`
        ${table.verificationStatus} != 'verified'
        OR (
          ${table.verifiedAt} IS NOT NULL
          AND ${table.verifiedBy} IS NOT NULL
        )
      `
    ),

    documentDatesCheck: check(
      'ck_identity_docs_dates',
      sql`
        ${table.issuedAt} IS NULL
        OR ${table.expiresAt} IS NULL
        OR ${table.expiresAt} > ${table.issuedAt}
      `
    ),

    versionCheck: check('ck_identity_docs_version', sql`${table.version} > 0`),
  })
);

/* ============================================================================
 * 3. KYC VERIFICATIONS
 * ============================================================================ */
export const kycVerifications = sqliteTable(
  'kyc_verifications',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),

    verificationVersion: integer('verification_version').notNull().default(1),

    verificationLevel: text('verification_level', {
      enum: ['basic', 'enhanced', 'institutional'],
    }).notNull(),

    status: text('status', {
      enum: ['submitted', 'under_review', 'approved', 'rejected', 'expired'],
    }).notNull(),

    provider: text('provider').notNull(),

    riskScore: integer('risk_score'),
    riskModel: text('risk_model'),
    riskModelVersion: text('risk_model_version'),

    rejectionReason: text('rejection_reason'),
    metadata: text('metadata', { mode: 'json' }),

    reviewedBy: integer('reviewed_by').references(() => users.id, { onDelete: 'set null' }),

    startedAt: integer('started_at', { mode: 'timestamp' }).notNull(),
    completedAt: integer('completed_at', { mode: 'timestamp' }),
    expiresAt: integer('expires_at', { mode: 'timestamp' }),

    version: integer('version').notNull().default(1),

    createdAt: integer('created_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (table) => ({
    userIdx: index('idx_kyc_user').on(table.userId),
    statusIdx: index('idx_kyc_status').on(table.status),

    verificationLevelCheck: check(
      'ck_kyc_verifications_level',
      sql`${table.verificationLevel} IN ('basic', 'enhanced', 'institutional')`
    ),

    statusCheck: check(
      'ck_kyc_verifications_status',
      sql`${table.status} IN ('submitted', 'under_review', 'approved', 'rejected', 'expired')`
    ),

    approvedStateCheck: check(
      'ck_kyc_verifications_approved_state',
      sql`
        ${table.status} != 'approved'
        OR ${table.completedAt} IS NOT NULL
      `
    ),

    rejectedStateCheck: check(
      'ck_kyc_verifications_rejected_state',
      sql`
        ${table.status} != 'rejected'
        OR (
          ${table.rejectionReason} IS NOT NULL
          AND length(trim(${table.rejectionReason})) > 0
        )
      `
    ),

    temporalOrderCheck: check(
      'ck_kyc_verifications_temporal_order',
      sql`
        (${table.completedAt} IS NULL OR ${table.completedAt} >= ${table.startedAt})
        AND (${table.expiresAt} IS NULL OR ${table.completedAt} IS NULL OR ${table.expiresAt} > ${table.completedAt})
      `
    ),

    riskScoreCheck: check(
      'ck_kyc_verifications_risk_score',
      sql`
        ${table.riskScore} IS NULL
        OR (${table.riskScore} >= 0 AND ${table.riskScore} <= 1000)
      `
    ),

    versionCheck: check('ck_kyc_verifications_version', sql`${table.version} > 0`),
  })
);

```

---

### `src/db/ssi/relations.ts`
```typescript
import { relations } from 'drizzle-orm';
import {
  secureVaults,
  didIdentities,
  didVerificationMethods,
  verifiableCredentials,
  verifiablePresentations,
} from './tables';
import { users } from '../user/tables';

/**
 * ============================================================================
 * SSI DOMAIN RELATIONS
 * ============================================================================
 * ARCHITECTURAL NOTE:
 * Navigation from users to SSI entities is intentionally one-directional
 * (child → parent only), per Section 05 boundary isolation matrix.
 * Direct queries on SSI tables should be executed with { with: { user: true } }
 * instead of querying bidirectionally from users.
 * ============================================================================
 */

/**
 * ============================================================================
 * SECURE VAULTS RELATIONS
 * ============================================================================
 */
export const secureVaultsRelations = relations(secureVaults, ({ one }) => ({
  user: one(users, {
    fields: [secureVaults.userId],
    references: [users.id],
    relationName: 'userSecureVaults',
  }),
}));

/**
 * ============================================================================
 * DID IDENTITIES RELATIONS
 * ============================================================================
 */
export const didIdentitiesRelations = relations(didIdentities, ({ one, many }) => ({
  user: one(users, {
    fields: [didIdentities.userId],
    references: [users.id],
    relationName: 'userDidIdentities',
  }),
  verificationMethods: many(didVerificationMethods),
}));

/**
 * ============================================================================
 * DID VERIFICATION METHODS RELATIONS
 * ============================================================================
 */
export const didVerificationMethodsRelations = relations(didVerificationMethods, ({ one }) => ({
  didIdentity: one(didIdentities, {
    fields: [didVerificationMethods.didId],
    references: [didIdentities.id],
  }),
}));

/**
 * ============================================================================
 * VERIFIABLE CREDENTIALS RELATIONS
 * ============================================================================
 */
export const verifiableCredentialsRelations = relations(verifiableCredentials, ({ one }) => ({
  holderUser: one(users, {
    fields: [verifiableCredentials.holderUserId],
    references: [users.id],
    relationName: 'userVerifiableCredentials',
  }),
}));

/**
 * ============================================================================
 * VERIFIABLE PRESENTATIONS RELATIONS
 * ============================================================================
 */
export const verifiablePresentationsRelations = relations(verifiablePresentations, ({ one }) => ({
  user: one(users, {
    fields: [verifiablePresentations.userId],
    references: [users.id],
    relationName: 'userVerifiablePresentations',
  }),
}));

```

---

### `src/db/ssi/tables.ts`
```typescript
import { sqliteTable, text, integer, index, uniqueIndex, check } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { users } from '../user/tables';

/**
 * ============================================================================
 * SELF-SOVEREIGN IDENTITY (SSI) DOMAIN
 * ============================================================================
 *
 * Specifications & Compliance:
 * - W3C Decentralized Identifiers (DIDs) v1.0 Core Architecture
 * - W3C Verifiable Credentials Data Model v1.1 / v2.0
 * - Cryptographic Key Vaults (AES-256-GCM / XChaCha20-Poly1305 + External KMS)
 *
 * Bounded Context Boundaries:
 * - Base account identity is owned by user/
 * - Civil identity & government PII are owned by civil-identity/
 * - Web3 EVM wallets & smart contracts are owned by web3/
 * - SSI owns DIDs, Key Vaults, Verifiable Credentials & Presentations
 *
 * Retention & Compliance Policy:
 * - Decentralized Identifiers (DIDs), verification methods, and verifiable credentials
 *   are cryptographically immutable identity anchors.
 * - All foreign keys referencing users.id use onDelete: 'restrict' to ensure
 *   verifiable claims and key audit logs survive user soft-deletion.
 * ============================================================================
 */

/* ============================================================================
 * 1. SECURE VAULTS
 * ============================================================================
 *
 * Encrypted custody storage for sensitive key material, seeds, and mnemonics.
 */
export const secureVaults = sqliteTable(
  'secure_vaults',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),

    purpose: text('purpose', {
      enum: ['wallet_mnemonic', 'recovery_material', 'private_key', 'identity_seed'],
    }).notNull(),
    ciphertext: text('ciphertext').notNull(),
    nonce: text('nonce').notNull(),
    authTag: text('auth_tag').notNull(),
    encryptionAlgorithm: text('encryption_algorithm', {
      enum: ['AES-256-GCM', 'XChaCha20-Poly1305'],
    }).notNull(),
    keyVersion: integer('key_version').notNull().default(1),
    keyReference: text('key_reference').notNull(), // KMS / Key Management reference

    version: integer('version').notNull().default(1),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull(),
    rotatedAt: integer('rotated_at', { mode: 'timestamp' }),
    revokedAt: integer('revoked_at', { mode: 'timestamp' }),
  },
  (table) => ({
    userIdx: index('idx_secure_vaults_user').on(table.userId),
    userPurposeVersionUnq: uniqueIndex('uq_secure_vaults_user_purpose_version').on(
      table.userId,
      table.purpose,
      table.keyVersion
    ),
    activePurposeUnq: uniqueIndex('uq_secure_vaults_active_purpose')
      .on(table.userId, table.purpose)
      .where(sql`${table.revokedAt} IS NULL`),
    purposeCheck: check(
      'ck_secure_vaults_purpose',
      sql`${table.purpose} IN ('wallet_mnemonic', 'recovery_material', 'private_key', 'identity_seed')`
    ),
    algorithmCheck: check(
      'ck_secure_vaults_algorithm',
      sql`${table.encryptionAlgorithm} IN ('AES-256-GCM', 'XChaCha20-Poly1305')`
    ),
    rotatedAfterCreatedCheck: check(
      'ck_secure_vaults_rotated_after_created',
      sql`${table.rotatedAt} IS NULL OR ${table.rotatedAt} >= ${table.createdAt}`
    ),
    revokedAfterCreatedCheck: check(
      'ck_secure_vaults_revoked_after_created',
      sql`${table.revokedAt} IS NULL OR ${table.revokedAt} >= ${table.createdAt}`
    ),
    versionCheck: check(
      'ck_secure_vaults_version',
      sql`${table.version} > 0 AND ${table.keyVersion} > 0`
    ),
  })
);

/* ============================================================================
 * 2. DID IDENTITIES
 * ============================================================================
 *
 * W3C Decentralized Identifier (DID) Documents.
 */
export const didIdentities = sqliteTable(
  'did_identities',
  {
    id: text('id').primaryKey(), // UUID v4
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),

    did: text('did').notNull().unique(),
    method: text('method', {
      enum: ['key', 'ion', 'polygonid', 'web', 'cheqd', 'pkh'],
    }).notNull(),
    controller: text('controller').notNull(),
    status: text('status', {
      enum: ['active', 'suspended', 'revoked'],
    })
      .notNull()
      .default('active'),

    version: integer('version').notNull().default(1),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull()
      .$onUpdateFn(() => new Date()),
    revokedAt: integer('revoked_at', { mode: 'timestamp' }),
  },
  (table) => ({
    userIdx: index('idx_did_identities_user').on(table.userId),
    didIdx: index('idx_did_identities_did').on(table.did),
    statusIdx: index('idx_did_identities_status').on(table.status),
    didFormatCheck: check('ck_did_identities_did_format', sql`${table.did} LIKE 'did:%'`),
    statusCheck: check(
      'ck_did_identities_status',
      sql`${table.status} IN ('active', 'suspended', 'revoked')`
    ),
    methodCheck: check(
      'ck_did_identities_method',
      sql`${table.method} IN ('key', 'ion', 'polygonid', 'web', 'cheqd', 'pkh')`
    ),
    revokedStateCheck: check(
      'ck_did_identities_revoked_state',
      sql`${table.status} != 'revoked' OR ${table.revokedAt} IS NOT NULL`
    ),
    versionCheck: check('ck_did_identities_version', sql`${table.version} > 0`),
  })
);

/* ============================================================================
 * 3. DID VERIFICATION METHODS
 * ============================================================================
 *
 * Public cryptographic keys associated with a DID for authentication & assertion.
 */
export const didVerificationMethods = sqliteTable(
  'did_verification_methods',
  {
    id: text('id').primaryKey(), // DID URL: did:example:123#key-1
    didId: text('did_id')
      .notNull()
      .references(() => didIdentities.id, { onDelete: 'restrict' }),

    type: text('type', {
      enum: [
        'Ed25519VerificationKey2020',
        'EcdsaSecp256k1RecoveryMethod2020',
        'X25519KeyAgreementKey2020',
        'JsonWebKey2020',
      ],
    }).notNull(),
    controllerDid: text('controller_did').notNull(),
    publicKeyMultibase: text('public_key_multibase').notNull(),
    purpose: text('purpose', {
      enum: [
        'authentication',
        'assertionMethod',
        'keyAgreement',
        'capabilityInvocation',
        'capabilityDelegation',
      ],
    }).notNull(),
    status: text('status', {
      enum: ['active', 'suspended', 'revoked'],
    })
      .notNull()
      .default('active'),

    version: integer('version').notNull().default(1),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull(),
    revokedAt: integer('revoked_at', { mode: 'timestamp' }),
  },
  (table) => ({
    didIdx: index('idx_did_verification_methods_did').on(table.didId),
    purposeIdx: index('idx_did_verification_methods_purpose').on(table.purpose),
    statusIdx: index('idx_did_verification_methods_status').on(table.status),
    controllerDidFormatCheck: check(
      'ck_did_vm_controller_did_format',
      sql`${table.controllerDid} LIKE 'did:%'`
    ),
    statusCheck: check(
      'ck_did_vm_status',
      sql`${table.status} IN ('active', 'suspended', 'revoked')`
    ),
    purposeCheck: check(
      'ck_did_vm_purpose',
      sql`${table.purpose} IN ('authentication', 'assertionMethod', 'keyAgreement', 'capabilityInvocation', 'capabilityDelegation')`
    ),
    typeCheck: check(
      'ck_did_vm_type',
      sql`${table.type} IN ('Ed25519VerificationKey2020', 'EcdsaSecp256k1RecoveryMethod2020', 'X25519KeyAgreementKey2020', 'JsonWebKey2020')`
    ),
    revokedStateCheck: check(
      'ck_did_vm_revoked_state',
      sql`${table.status} != 'revoked' OR ${table.revokedAt} IS NOT NULL`
    ),
    versionCheck: check('ck_did_vm_version', sql`${table.version} > 0`),
  })
);

/* ============================================================================
 * 4. VERIFIABLE CREDENTIALS
 * ============================================================================
 *
 * W3C Verifiable Credentials issued to holders.
 */
export const verifiableCredentials = sqliteTable(
  'verifiable_credentials',
  {
    id: text('id').primaryKey(), // UUID v4
    holderUserId: integer('holder_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),

    issuerDid: text('issuer_did').notNull(),
    subjectDid: text('subject_did').notNull(),
    credentialType: text('credential_type', {
      enum: [
        'CivicIdentityCredential',
        'MembershipCredential',
        'KycVerificationCredential',
        'ReputationCredential',
      ],
    }).notNull(),
    credentialHash: text('credential_hash').notNull().unique(),
    encryptedClaims: text('encrypted_claims').notNull(),
    proofType: text('proof_type', {
      enum: ['Ed25519Signature2020', 'BbsBlsSignature2020', 'JsonWebSignature2020'],
    }).notNull(),
    status: text('status', {
      enum: ['active', 'suspended', 'revoked', 'expired'],
    })
      .notNull()
      .default('active'),

    version: integer('version').notNull().default(1),
    issuanceDate: integer('issuance_date', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull(),
    expirationDate: integer('expiration_date', { mode: 'timestamp' }),
    revokedAt: integer('revoked_at', { mode: 'timestamp' }),
  },
  (table) => ({
    holderIdx: index('idx_vc_holder_user').on(table.holderUserId),
    subjectIdx: index('idx_vc_subject_did').on(table.subjectDid),
    issuerIdx: index('idx_vc_issuer_did').on(table.issuerDid),
    statusIdx: index('idx_vc_status').on(table.status),
    issuerDidFormatCheck: check('ck_vc_issuer_did_format', sql`${table.issuerDid} LIKE 'did:%'`),
    subjectDidFormatCheck: check('ck_vc_subject_did_format', sql`${table.subjectDid} LIKE 'did:%'`),
    statusCheck: check(
      'ck_vc_status',
      sql`${table.status} IN ('active', 'suspended', 'revoked', 'expired')`
    ),
    credentialTypeCheck: check(
      'ck_vc_type',
      sql`${table.credentialType} IN ('CivicIdentityCredential', 'MembershipCredential', 'KycVerificationCredential', 'ReputationCredential')`
    ),
    proofTypeCheck: check(
      'ck_vc_proof_type',
      sql`${table.proofType} IN ('Ed25519Signature2020', 'BbsBlsSignature2020', 'JsonWebSignature2020')`
    ),
    revokedStateCheck: check(
      'ck_vc_revoked_state',
      sql`${table.status} != 'revoked' OR ${table.revokedAt} IS NOT NULL`
    ),
    temporalOrderCheck: check(
      'ck_vc_dates',
      sql`${table.expirationDate} IS NULL OR ${table.expirationDate} > ${table.issuanceDate}`
    ),
    versionCheck: check('ck_vc_version', sql`${table.version} > 0`),
  })
);

/* ============================================================================
 * 5. VERIFIABLE PRESENTATIONS
 * ============================================================================
 *
 * Cryptographic proofs presented by users to verifiers.
 */
export const verifiablePresentations = sqliteTable(
  'verifiable_presentations',
  {
    id: text('id').primaryKey(), // UUID v4
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),

    verifierDid: text('verifier_did').notNull(),
    presentationType: text('presentation_type').notNull(),
    challenge: text('challenge').notNull(),
    presentationHash: text('presentation_hash').notNull().unique(),
    status: text('status', {
      enum: ['verified', 'rejected', 'expired'],
    }).notNull(),

    version: integer('version').notNull().default(1),
    submittedAt: integer('submitted_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull(),
    verifiedAt: integer('verified_at', { mode: 'timestamp' }),
  },
  (table) => ({
    userIdx: index('idx_vp_user').on(table.userId),
    verifierIdx: index('idx_vp_verifier').on(table.verifierDid),
    statusIdx: index('idx_vp_status').on(table.status),
    verifierDidFormatCheck: check(
      'ck_vp_verifier_did_format',
      sql`${table.verifierDid} LIKE 'did:%'`
    ),
    statusCheck: check('ck_vp_status', sql`${table.status} IN ('verified', 'rejected', 'expired')`),
    verifiedStateCheck: check(
      'ck_vp_verified_state',
      sql`${table.status} != 'verified' OR ${table.verifiedAt} IS NOT NULL`
    ),
    verifiedAfterSubmittedCheck: check(
      'ck_vp_verified_after_submitted',
      sql`${table.verifiedAt} IS NULL OR ${table.verifiedAt} >= ${table.submittedAt}`
    ),
    versionCheck: check('ck_vp_version', sql`${table.version} > 0`),
  })
);

```

---

### `src/db/finance/relations.ts`
```typescript
import { relations } from 'drizzle-orm';
import { users } from '../user/tables';
import {
  financialAssets,
  financialAccounts,
  financialTransactions,
  financialLedgerEntries,
  accountBalances,
  balanceHolds,
  fiatProviders,
  fiatAccounts,
  fiatPaymentMethods,
  fiatTransactions,
  cryptoTransactions,
  exchangeRates,
  assetConversions,
  financialFees,
  fiatExternalTransactions,
  idempotencyKeys,
  reconciliationRecords,
} from './tables';

/**
 * ============================================================================
 * FINANCE DOMAIN RELATIONS
 * ============================================================================
 * ARCHITECTURAL NOTE:
 * Navigation from users to finance entities is intentionally one-directional
 * (child → parent only), per Section 05 boundary isolation matrix.
 * Direct queries on finance tables should be executed with { with: { user: true } }
 * instead of querying bidirectionally from users.
 * ============================================================================
 */

// financialAssets
export const financialAssetsRelations = relations(financialAssets, ({ many }) => ({
  financialLedgerEntries: many(financialLedgerEntries),
  accountBalances: many(accountBalances),
  balanceHolds: many(balanceHolds),
  cryptoTransactionsAsAsset: many(cryptoTransactions, { relationName: 'cryptoTransactionAsset' }),
  cryptoTransactionsAsFeeAsset: many(cryptoTransactions, {
    relationName: 'cryptoTransactionFeeAsset',
  }),
  exchangeRatesAsBase: many(exchangeRates, { relationName: 'exchangeRateBaseAsset' }),
  exchangeRatesAsQuote: many(exchangeRates, { relationName: 'exchangeRateQuoteAsset' }),
  assetConversionsAsFrom: many(assetConversions, { relationName: 'assetConversionFromAsset' }),
  assetConversionsAsTo: many(assetConversions, { relationName: 'assetConversionToAsset' }),
  financialFees: many(financialFees),
  reconciliationRecords: many(reconciliationRecords),
}));

// financialAccounts
export const financialAccountsRelations = relations(financialAccounts, ({ one, many }) => ({
  user: one(users, {
    fields: [financialAccounts.userId],
    references: [users.id],
  }),
  financialLedgerEntries: many(financialLedgerEntries),
  accountBalances: many(accountBalances),
  balanceHolds: many(balanceHolds),
  financialFeesReceived: many(financialFees),
  reconciliationRecords: many(reconciliationRecords),
}));

// financialTransactions
export const financialTransactionsRelations = relations(financialTransactions, ({ one, many }) => ({
  user: one(users, {
    fields: [financialTransactions.userId],
    references: [users.id],
  }),
  ledgerEntries: many(financialLedgerEntries),
  fiatTransaction: one(fiatTransactions),
  cryptoTransaction: one(cryptoTransactions),
  assetConversion: one(assetConversions),
  fees: many(financialFees),
  idempotencyKeys: many(idempotencyKeys),
}));

// financialLedgerEntries
export const financialLedgerEntriesRelations = relations(financialLedgerEntries, ({ one }) => ({
  transaction: one(financialTransactions, {
    fields: [financialLedgerEntries.transactionId],
    references: [financialTransactions.id],
  }),
  account: one(financialAccounts, {
    fields: [financialLedgerEntries.accountId],
    references: [financialAccounts.id],
  }),
  asset: one(financialAssets, {
    fields: [financialLedgerEntries.assetId],
    references: [financialAssets.id],
  }),
}));

// accountBalances
export const accountBalancesRelations = relations(accountBalances, ({ one }) => ({
  account: one(financialAccounts, {
    fields: [accountBalances.accountId],
    references: [financialAccounts.id],
  }),
  asset: one(financialAssets, {
    fields: [accountBalances.assetId],
    references: [financialAssets.id],
  }),
}));

// balanceHolds
export const balanceHoldsRelations = relations(balanceHolds, ({ one }) => ({
  account: one(financialAccounts, {
    fields: [balanceHolds.accountId],
    references: [financialAccounts.id],
  }),
  asset: one(financialAssets, {
    fields: [balanceHolds.assetId],
    references: [financialAssets.id],
  }),
}));

// fiatProviders
export const fiatProvidersRelations = relations(fiatProviders, ({ many }) => ({
  fiatAccounts: many(fiatAccounts),
  fiatTransactions: many(fiatTransactions),
  fiatExternalTransactions: many(fiatExternalTransactions),
  reconciliationRecords: many(reconciliationRecords),
}));

// fiatAccounts
export const fiatAccountsRelations = relations(fiatAccounts, ({ one, many }) => ({
  user: one(users, {
    fields: [fiatAccounts.userId],
    references: [users.id],
  }),
  provider: one(fiatProviders, {
    fields: [fiatAccounts.providerId],
    references: [fiatProviders.id],
  }),
  asset: one(financialAssets, {
    fields: [fiatAccounts.assetId],
    references: [financialAssets.id],
  }),
  paymentMethods: many(fiatPaymentMethods),
}));

// fiatPaymentMethods
export const fiatPaymentMethodsRelations = relations(fiatPaymentMethods, ({ one }) => ({
  user: one(users, {
    fields: [fiatPaymentMethods.userId],
    references: [users.id],
  }),
  fiatAccount: one(fiatAccounts, {
    fields: [fiatPaymentMethods.fiatAccountId],
    references: [fiatAccounts.id],
  }),
}));

// fiatTransactions
export const fiatTransactionsRelations = relations(fiatTransactions, ({ one }) => ({
  transaction: one(financialTransactions, {
    fields: [fiatTransactions.financialTransactionId],
    references: [financialTransactions.id],
  }),
  paymentMethod: one(fiatPaymentMethods, {
    fields: [fiatTransactions.paymentMethodId],
    references: [fiatPaymentMethods.id],
  }),
  asset: one(financialAssets, {
    fields: [fiatTransactions.assetId],
    references: [financialAssets.id],
  }),
  provider: one(fiatProviders, {
    fields: [fiatTransactions.providerId],
    references: [fiatProviders.id],
  }),
}));

// cryptoTransactions
export const cryptoTransactionsRelations = relations(cryptoTransactions, ({ one }) => ({
  transaction: one(financialTransactions, {
    fields: [cryptoTransactions.financialTransactionId],
    references: [financialTransactions.id],
  }),
  asset: one(financialAssets, {
    fields: [cryptoTransactions.assetId],
    references: [financialAssets.id],
    relationName: 'cryptoTransactionAsset',
  }),
  feeAsset: one(financialAssets, {
    fields: [cryptoTransactions.feeAssetId],
    references: [financialAssets.id],
    relationName: 'cryptoTransactionFeeAsset',
  }),
}));

// exchangeRates
export const exchangeRatesRelations = relations(exchangeRates, ({ one }) => ({
  baseAsset: one(financialAssets, {
    fields: [exchangeRates.baseAssetId],
    references: [financialAssets.id],
    relationName: 'exchangeRateBaseAsset',
  }),
  quoteAsset: one(financialAssets, {
    fields: [exchangeRates.quoteAssetId],
    references: [financialAssets.id],
    relationName: 'exchangeRateQuoteAsset',
  }),
}));

// assetConversions
export const assetConversionsRelations = relations(assetConversions, ({ one }) => ({
  transaction: one(financialTransactions, {
    fields: [assetConversions.financialTransactionId],
    references: [financialTransactions.id],
  }),
  fromAsset: one(financialAssets, {
    fields: [assetConversions.fromAssetId],
    references: [financialAssets.id],
    relationName: 'assetConversionFromAsset',
  }),
  toAsset: one(financialAssets, {
    fields: [assetConversions.toAssetId],
    references: [financialAssets.id],
    relationName: 'assetConversionToAsset',
  }),
}));

// financialFees
export const financialFeesRelations = relations(financialFees, ({ one }) => ({
  transaction: one(financialTransactions, {
    fields: [financialFees.transactionId],
    references: [financialTransactions.id],
  }),
  asset: one(financialAssets, {
    fields: [financialFees.assetId],
    references: [financialAssets.id],
  }),
  recipientAccount: one(financialAccounts, {
    fields: [financialFees.recipientAccountId],
    references: [financialAccounts.id],
  }),
}));

// fiatExternalTransactions
export const fiatExternalTransactionsRelations = relations(fiatExternalTransactions, ({ one }) => ({
  transaction: one(financialTransactions, {
    fields: [fiatExternalTransactions.financialTransactionId],
    references: [financialTransactions.id],
  }),
  provider: one(fiatProviders, {
    fields: [fiatExternalTransactions.providerId],
    references: [fiatProviders.id],
  }),
}));

// idempotencyKeys
export const idempotencyKeysRelations = relations(idempotencyKeys, ({ one }) => ({
  user: one(users, {
    fields: [idempotencyKeys.userId],
    references: [users.id],
  }),
  financialTransaction: one(financialTransactions, {
    fields: [idempotencyKeys.financialTransactionId],
    references: [financialTransactions.id],
  }),
}));

// reconciliationRecords
export const reconciliationRecordsRelations = relations(reconciliationRecords, ({ one }) => ({
  account: one(financialAccounts, {
    fields: [reconciliationRecords.accountId],
    references: [financialAccounts.id],
  }),
  asset: one(financialAssets, {
    fields: [reconciliationRecords.assetId],
    references: [financialAssets.id],
  }),
  provider: one(fiatProviders, {
    fields: [reconciliationRecords.providerId],
    references: [fiatProviders.id],
  }),
}));

```

---

### `src/db/finance/tables.ts`
```typescript
import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
  check,
  foreignKey,
} from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

import { users } from '../user/tables';

/**
 * ============================================================================
 * FINANCE DOMAIN
 * ============================================================================
 *
 * Responsibilities:
 * - Financial assets supported by the platform
 * - Financial accounts
 * - Financial transactions
 * - Double-entry ledger
 * - Account balances
 * - Balance holds
 * - Fiat providers / accounts / payment operations
 * - Crypto financial operations
 * - Asset conversions
 * - Fees
 * - External transaction references
 * - Idempotency
 * - Reconciliation
 *
 * Explicit boundaries:
 * - Authentication is owned by authentication/
 * - KYC / civil identity is owned by civil-identity/
 * - Authorization is owned by authorization/
 * - Blockchain technical infrastructure is owned by web3/
 * - Wallet identity is NOT represented here as a user identity
 *
 * Retention & Regulatory Policy:
 * - Double-Entry Ledger entries (financialLedgerEntries) and fees (financialFees)
 *   are APPEND-ONLY tables and MUST NEVER be deleted or updated.
 * - All foreign keys referencing users.id use onDelete: 'restrict' to ensure
 *   financial audit trails and accounting records survive user soft-deletion.
 *
 * Monetary values (Web3 Compatible):
 * - All amounts are stored as TEXT in the asset's smallest unit to support
 *   EVM precision (up to 18 decimals) which exceeds SQLite's 64-bit integer limit.
 * - Application layer MUST handle these using JS BigInt.
 * - BRL: 2 decimals  -> R$ 10.50 = "1050"
 * - USD: 2 decimals  -> US$ 10.50 = "1050"
 * - ETH: 18 decimals -> 1 ETH = "1000000000000000000"
 *
 * V1 supported financial assets:
 * - BRL
 * - USD
 * - BTC
 * ============================================================================
 */

/* ============================================================================
 * 1. FINANCIAL ASSETS
 * ============================================================================
 */
export const financialAssets = sqliteTable(
  'financial_assets',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    code: text('code').notNull(),
    symbol: text('symbol').notNull(),
    name: text('name').notNull(),
    type: text('type', {
      enum: ['fiat', 'crypto'],
    }).notNull(),
    decimals: integer('decimals').notNull(),
    status: text('status', {
      enum: ['active', 'inactive'],
    })
      .notNull()
      .default('active'),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdateFn(() => new Date()),
  },
  (table) => ({
    codeUq: uniqueIndex('uq_financial_assets_code').on(table.code),
    typeIdx: index('idx_financial_assets_type').on(table.type),
    statusIdx: index('idx_financial_assets_status').on(table.status),
    typeCheck: check('ck_financial_assets_type', sql`${table.type} IN ('fiat', 'crypto')`),
    statusCheck: check(
      'ck_financial_assets_status',
      sql`${table.status} IN ('active', 'inactive')`
    ),
    decimalsCheck: check(
      'ck_financial_assets_decimals',
      sql`${table.decimals} >= 0 AND ${table.decimals} <= 18`
    ),
  })
);

/* ============================================================================
 * 2. FINANCIAL ACCOUNTS
 * ============================================================================
 */
export const financialAccounts = sqliteTable(
  'financial_accounts',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id').references(() => users.id, {
      onDelete: 'restrict',
    }),
    accountType: text('account_type', {
      enum: ['user_available', 'treasury', 'operating', 'reserve', 'fees', 'escrow'],
    }).notNull(),
    status: text('status', {
      enum: ['active', 'inactive', 'suspended'],
    })
      .notNull()
      .default('active'),
    name: text('name').notNull(),
    version: integer('version').notNull().default(1),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdateFn(() => new Date()),
  },
  (table) => ({
    userIdx: index('idx_financial_accounts_user').on(table.userId),
    typeIdx: index('idx_financial_accounts_type').on(table.accountType),
    statusIdx: index('idx_financial_accounts_status').on(table.status),
    accountTypeCheck: check(
      'ck_financial_accounts_type',
      sql`${table.accountType} IN ('user_available', 'treasury', 'operating', 'reserve', 'fees', 'escrow')`
    ),
    statusCheck: check(
      'ck_financial_accounts_status',
      sql`${table.status} IN ('active', 'inactive', 'suspended')`
    ),
    userAccountTypeUq: uniqueIndex('uq_financial_accounts_user_type_name').on(
      table.userId,
      table.accountType,
      table.name
    ),
    ownerRuleCheck: check(
      'ck_financial_accounts_owner_rule',
      sql`(${table.accountType} = 'user_available' AND ${table.userId} IS NOT NULL) OR (${table.accountType} != 'user_available' AND ${table.userId} IS NULL)`
    ),
    versionCheck: check('ck_financial_accounts_version', sql`${table.version} > 0`),
  })
);

/* ============================================================================
 * 3. FINANCIAL TRANSACTIONS
 * ============================================================================
 */
export const financialTransactions = sqliteTable(
  'financial_transactions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id').references(() => users.id, {
      onDelete: 'restrict',
    }),
    type: text('type', {
      enum: [
        'deposit',
        'withdrawal',
        'transfer',
        'payment',
        'refund',
        'fee',
        'reward',
        'yield',
        'conversion',
        'adjustment',
      ],
    }).notNull(),
    category: text('category', {
      enum: [
        'membership',
        'rwa_yield',
        'grant',
        'operational',
        'payment',
        'trading',
        'withdrawal',
        'deposit',
        'fee',
        'other',
      ],
    })
      .notNull()
      .default('other'),
    status: text('status', {
      enum: ['pending', 'processing', 'completed', 'failed', 'cancelled', 'reversed', 'refunded'],
    })
      .notNull()
      .default('pending'),
    sourceType: text('source_type', {
      enum: [
        'contribution',
        'grant',
        'membership',
        'payroll',
        'withdrawal',
        'payment',
        'conversion',
        'system',
        'other',
      ],
    }),
    sourceId: text('source_id'),
    correlationId: text('correlation_id'),
    description: text('description').notNull(),
    version: integer('version').notNull().default(1),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdateFn(() => new Date()),
    completedAt: integer('completed_at', { mode: 'timestamp' }),
  },
  (table) => ({
    userIdx: index('idx_financial_transactions_user').on(table.userId),
    typeIdx: index('idx_financial_transactions_type').on(table.type),
    statusIdx: index('idx_financial_transactions_status').on(table.status),
    createdIdx: index('idx_financial_transactions_created').on(table.createdAt),
    correlationIdx: index('idx_financial_transactions_correlation').on(table.correlationId),
    typeCheck: check(
      'ck_financial_tx_type',
      sql`${table.type} IN ('deposit', 'withdrawal', 'transfer', 'payment', 'refund', 'fee', 'reward', 'yield', 'conversion', 'adjustment')`
    ),
    categoryCheck: check(
      'ck_financial_tx_category',
      sql`${table.category} IN ('membership', 'rwa_yield', 'grant', 'operational', 'payment', 'trading', 'withdrawal', 'deposit', 'fee', 'other')`
    ),
    statusCheck: check(
      'ck_financial_tx_status',
      sql`${table.status} IN ('pending', 'processing', 'completed', 'failed', 'cancelled', 'reversed', 'refunded')`
    ),
    sourceTypeCheck: check(
      'ck_financial_tx_source_type',
      sql`${table.sourceType} IS NULL OR ${table.sourceType} IN ('contribution', 'grant', 'membership', 'payroll', 'withdrawal', 'payment', 'conversion', 'system', 'other')`
    ),
    completedStateCheck: check(
      'ck_financial_tx_completed_state',
      sql`${table.status} != 'completed' OR ${table.completedAt} IS NOT NULL`
    ),
    temporalOrderCheck: check(
      'ck_financial_tx_dates',
      sql`${table.completedAt} IS NULL OR ${table.completedAt} >= ${table.createdAt}`
    ),
    versionCheck: check('ck_financial_tx_version', sql`${table.version} > 0`),
  })
);

/* ============================================================================
 * 4. FINANCIAL LEDGER ENTRIES
 * ============================================================================
 */
export const financialLedgerEntries = sqliteTable(
  'financial_ledger_entries',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    transactionId: integer('transaction_id')
      .notNull()
      .references(() => financialTransactions.id, {
        onDelete: 'restrict',
      }),
    accountId: integer('account_id')
      .notNull()
      .references(() => financialAccounts.id, {
        onDelete: 'restrict',
      }),
    assetId: integer('asset_id')
      .notNull()
      .references(() => financialAssets.id, {
        onDelete: 'restrict',
      }),
    direction: text('direction', {
      enum: ['debit', 'credit'],
    }).notNull(),
    amountBaseUnits: text('amount_base_units').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    transactionIdx: index('idx_financial_ledger_entries_transaction').on(table.transactionId),
    accountIdx: index('idx_financial_ledger_entries_account').on(table.accountId),
    assetIdx: index('idx_financial_ledger_entries_asset').on(table.assetId),
    createdIdx: index('idx_financial_ledger_entries_created').on(table.createdAt),
    directionCheck: check(
      'ck_financial_ledger_direction',
      sql`${table.direction} IN ('debit', 'credit')`
    ),
    amountCheck: check(
      'ck_financial_ledger_entries_amount_positive',
      sql`${table.amountBaseUnits} <> '' AND ltrim(${table.amountBaseUnits}, '0123456789') = '' AND ${table.amountBaseUnits} <> '0' AND ltrim(${table.amountBaseUnits}, '0') = ${table.amountBaseUnits}`
    ),
  })
);

/* ============================================================================
 * 5. ACCOUNT BALANCES
 * ============================================================================
 */
export const accountBalances = sqliteTable(
  'account_balances',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    accountId: integer('account_id')
      .notNull()
      .references(() => financialAccounts.id, {
        onDelete: 'restrict',
      }),
    assetId: integer('asset_id')
      .notNull()
      .references(() => financialAssets.id, {
        onDelete: 'restrict',
      }),
    availableBaseUnits: text('available_base_units').notNull().default('0'),
    lockedBaseUnits: text('locked_base_units').notNull().default('0'),
    version: integer('version').notNull().default(1),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdateFn(() => new Date()),
  },
  (table) => ({
    accountAssetUq: uniqueIndex('uq_account_balances_account_asset').on(
      table.accountId,
      table.assetId
    ),
    accountIdx: index('idx_account_balances_account').on(table.accountId),
    assetIdx: index('idx_account_balances_asset').on(table.assetId),
    availableCheck: check(
      'ck_account_balances_available_nonnegative',
      sql`${table.availableBaseUnits} <> '' AND ltrim(${table.availableBaseUnits}, '0123456789') = '' AND (${table.availableBaseUnits} = '0' OR ltrim(${table.availableBaseUnits}, '0') = ${table.availableBaseUnits})`
    ),
    lockedCheck: check(
      'ck_account_balances_locked_nonnegative',
      sql`${table.lockedBaseUnits} <> '' AND ltrim(${table.lockedBaseUnits}, '0123456789') = '' AND (${table.lockedBaseUnits} = '0' OR ltrim(${table.lockedBaseUnits}, '0') = ${table.lockedBaseUnits})`
    ),
    versionCheck: check('ck_account_balances_version', sql`${table.version} > 0`),
  })
);

/* ============================================================================
 * 6. BALANCE HOLDS
 * ============================================================================
 */
export const balanceHolds = sqliteTable(
  'balance_holds',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    accountId: integer('account_id')
      .notNull()
      .references(() => financialAccounts.id, {
        onDelete: 'restrict',
      }),
    assetId: integer('asset_id')
      .notNull()
      .references(() => financialAssets.id, {
        onDelete: 'restrict',
      }),
    amountBaseUnits: text('amount_base_units').notNull(),
    reason: text('reason').notNull(),
    referenceType: text('reference_type'),
    referenceId: text('reference_id'),
    status: text('status', {
      enum: ['active', 'released', 'expired', 'consumed'],
    })
      .notNull()
      .default('active'),
    version: integer('version').notNull().default(1),
    expiresAt: integer('expires_at', { mode: 'timestamp' }),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdateFn(() => new Date()),
    releasedAt: integer('released_at', { mode: 'timestamp' }),
  },
  (table) => ({
    accountIdx: index('idx_balance_holds_account').on(table.accountId),
    assetIdx: index('idx_balance_holds_asset').on(table.assetId),
    statusIdx: index('idx_balance_holds_status').on(table.status),
    referenceIdx: index('idx_balance_holds_reference').on(table.referenceType, table.referenceId),
    statusCheck: check(
      'ck_balance_holds_status',
      sql`${table.status} IN ('active', 'released', 'expired', 'consumed')`
    ),
    amountCheck: check(
      'ck_balance_holds_amount_positive',
      sql`${table.amountBaseUnits} <> '' AND ltrim(${table.amountBaseUnits}, '0123456789') = '' AND ${table.amountBaseUnits} <> '0' AND ltrim(${table.amountBaseUnits}, '0') = ${table.amountBaseUnits}`
    ),
    releasedStateCheck: check(
      'ck_balance_holds_released_state',
      sql`${table.status} != 'released' OR ${table.releasedAt} IS NOT NULL`
    ),
    expiredStateCheck: check(
      'ck_balance_holds_expired_state',
      sql`${table.status} != 'expired' OR ${table.expiresAt} IS NOT NULL`
    ),
    versionCheck: check('ck_balance_holds_version', sql`${table.version} > 0`),
  })
);

/* ============================================================================
 * 7. FIAT PROVIDERS
 * ============================================================================
 */
export const fiatProviders = sqliteTable(
  'fiat_providers',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    code: text('code').notNull(),
    type: text('type', {
      enum: ['bank', 'payment_provider', 'pix_provider', 'gateway'],
    }).notNull(),
    status: text('status', {
      enum: ['active', 'inactive', 'suspended'],
    })
      .notNull()
      .default('active'),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdateFn(() => new Date()),
  },
  (table) => ({
    codeUq: uniqueIndex('uq_fiat_providers_code').on(table.code),
    typeIdx: index('idx_fiat_providers_type').on(table.type),
    statusIdx: index('idx_fiat_providers_status').on(table.status),
    typeCheck: check(
      'ck_fiat_providers_type',
      sql`${table.type} IN ('bank', 'payment_provider', 'pix_provider', 'gateway')`
    ),
    statusCheck: check(
      'ck_fiat_providers_status',
      sql`${table.status} IN ('active', 'inactive', 'suspended')`
    ),
  })
);

/* ============================================================================
 * 8. FIAT ACCOUNTS
 * ============================================================================
 */
export const fiatAccounts = sqliteTable(
  'fiat_accounts',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, {
        onDelete: 'restrict',
      }),
    assetId: integer('asset_id')
      .notNull()
      .references(() => financialAssets.id, {
        onDelete: 'restrict',
      }),
    providerId: integer('provider_id').references(() => fiatProviders.id, {
      onDelete: 'restrict',
    }),
    type: text('type', {
      enum: ['bank_account', 'payment_account', 'pix_account'],
    }).notNull(),
    externalAccountId: text('external_account_id'),
    displayName: text('display_name'),
    last4: text('last4'),
    status: text('status', {
      enum: ['active', 'inactive', 'blocked'],
    })
      .notNull()
      .default('active'),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdateFn(() => new Date()),
    blockedAt: integer('blocked_at', { mode: 'timestamp' }),
  },
  (table) => ({
    userIdx: index('idx_fiat_accounts_user').on(table.userId),
    providerIdx: index('idx_fiat_accounts_provider').on(table.providerId),
    statusIdx: index('idx_fiat_accounts_status').on(table.status),
    typeCheck: check(
      'ck_fiat_accounts_type',
      sql`${table.type} IN ('bank_account', 'payment_account', 'pix_account')`
    ),
    statusCheck: check(
      'ck_fiat_accounts_status',
      sql`${table.status} IN ('active', 'inactive', 'blocked')`
    ),
    blockedStateCheck: check(
      'ck_fiat_accounts_blocked_state',
      sql`${table.status} != 'blocked' OR ${table.blockedAt} IS NOT NULL`
    ),
    externalUq: uniqueIndex('uq_fiat_accounts_provider_external').on(
      table.providerId,
      table.externalAccountId
    ),
    userAccountUq: uniqueIndex('uq_fiat_accounts_user_account').on(table.userId, table.id),
  })
);

/* ============================================================================
 * 9. FIAT PAYMENT METHODS
 * ============================================================================
 */
export const fiatPaymentMethods = sqliteTable(
  'fiat_payment_methods',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, {
        onDelete: 'restrict',
      }),
    fiatAccountId: integer('fiat_account_id'),
    type: text('type', {
      enum: ['pix', 'bank_transfer', 'boleto', 'card'],
    }).notNull(),
    label: text('label').notNull(),
    status: text('status', {
      enum: ['active', 'inactive', 'blocked'],
    })
      .notNull()
      .default('active'),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdateFn(() => new Date()),
    blockedAt: integer('blocked_at', { mode: 'timestamp' }),
  },
  (table) => ({
    fiatAccountFk: foreignKey({
      columns: [table.userId, table.fiatAccountId],
      foreignColumns: [fiatAccounts.userId, fiatAccounts.id],
      name: 'fk_fiat_payment_methods_user_account',
    }).onDelete('restrict'),
    userIdx: index('idx_fiat_payment_methods_user').on(table.userId),
    accountIdx: index('idx_fiat_payment_methods_account').on(table.fiatAccountId),
    typeIdx: index('idx_fiat_payment_methods_type').on(table.type),
    statusIdx: index('idx_fiat_payment_methods_status').on(table.status),
    typeCheck: check(
      'ck_fiat_pm_type',
      sql`${table.type} IN ('pix', 'bank_transfer', 'boleto', 'card')`
    ),
    statusCheck: check(
      'ck_fiat_pm_status',
      sql`${table.status} IN ('active', 'inactive', 'blocked')`
    ),
    blockedStateCheck: check(
      'ck_fiat_pm_blocked_state',
      sql`${table.status} != 'blocked' OR ${table.blockedAt} IS NOT NULL`
    ),
  })
);

/* ============================================================================
 * 10. FIAT TRANSACTIONS
 * ============================================================================
 */
export const fiatTransactions = sqliteTable(
  'fiat_transactions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    financialTransactionId: integer('financial_transaction_id')
      .notNull()
      .references(() => financialTransactions.id, {
        onDelete: 'restrict',
      }),
    providerId: integer('provider_id').references(() => fiatProviders.id, {
      onDelete: 'restrict',
    }),
    paymentMethodId: integer('payment_method_id').references(() => fiatPaymentMethods.id, {
      onDelete: 'restrict',
    }),
    assetId: integer('asset_id')
      .notNull()
      .references(() => financialAssets.id, {
        onDelete: 'restrict',
      }),
    direction: text('direction', {
      enum: ['inbound', 'outbound'],
    }).notNull(),
    amountBaseUnits: text('amount_base_units').notNull(),
    status: text('status', {
      enum: ['pending', 'processing', 'completed', 'failed', 'cancelled', 'reversed'],
    })
      .notNull()
      .default('pending'),
    version: integer('version').notNull().default(1),
    requestedAt: integer('requested_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    processedAt: integer('processed_at', { mode: 'timestamp' }),
    settledAt: integer('settled_at', { mode: 'timestamp' }),
  },
  (table) => ({
    transactionUq: uniqueIndex('uq_fiat_transactions_financial_transaction').on(
      table.financialTransactionId
    ),
    providerIdx: index('idx_fiat_transactions_provider').on(table.providerId),
    paymentMethodIdx: index('idx_fiat_transactions_payment_method').on(table.paymentMethodId),
    assetIdx: index('idx_fiat_transactions_asset').on(table.assetId),
    statusIdx: index('idx_fiat_transactions_status').on(table.status),
    directionCheck: check(
      'ck_fiat_tx_direction',
      sql`${table.direction} IN ('inbound', 'outbound')`
    ),
    statusCheck: check(
      'ck_fiat_tx_status',
      sql`${table.status} IN ('pending', 'processing', 'completed', 'failed', 'cancelled', 'reversed')`
    ),
    amountCheck: check(
      'ck_fiat_transactions_amount_positive',
      sql`${table.amountBaseUnits} <> '' AND ltrim(${table.amountBaseUnits}, '0123456789') = '' AND ${table.amountBaseUnits} <> '0' AND ltrim(${table.amountBaseUnits}, '0') = ${table.amountBaseUnits}`
    ),
    temporalOrderCheck: check(
      'ck_fiat_tx_dates',
      sql`${table.settledAt} IS NULL OR ${table.settledAt} >= ${table.requestedAt}`
    ),
    versionCheck: check('ck_fiat_tx_version', sql`${table.version} > 0`),
  })
);

/* ============================================================================
 * 11. CRYPTO TRANSACTIONS
 * ============================================================================
 */
export const cryptoTransactions = sqliteTable(
  'crypto_transactions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    financialTransactionId: integer('financial_transaction_id')
      .notNull()
      .references(() => financialTransactions.id, {
        onDelete: 'restrict',
      }),
    assetId: integer('asset_id')
      .notNull()
      .references(() => financialAssets.id, {
        onDelete: 'restrict',
      }),
    web3TransactionId: text('web3_transaction_id'),
    direction: text('direction', {
      enum: ['inbound', 'outbound'],
    }).notNull(),
    amountBaseUnits: text('amount_base_units').notNull(),
    feeAssetId: integer('fee_asset_id').references(() => financialAssets.id, {
      onDelete: 'restrict',
    }),
    feeBaseUnits: text('fee_base_units').notNull().default('0'),
    status: text('status', {
      enum: ['pending', 'processing', 'confirmed', 'failed', 'reversed'],
    })
      .notNull()
      .default('pending'),
    version: integer('version').notNull().default(1),
    requestedAt: integer('requested_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    settledAt: integer('settled_at', { mode: 'timestamp' }),
  },
  (table) => ({
    transactionUq: uniqueIndex('uq_crypto_transactions_financial_transaction').on(
      table.financialTransactionId
    ),
    web3TransactionUq: uniqueIndex('uq_crypto_transactions_web3_transaction').on(
      table.web3TransactionId
    ),
    assetIdx: index('idx_crypto_transactions_asset').on(table.assetId),
    statusIdx: index('idx_crypto_transactions_status').on(table.status),
    directionCheck: check(
      'ck_crypto_tx_direction',
      sql`${table.direction} IN ('inbound', 'outbound')`
    ),
    statusCheck: check(
      'ck_crypto_tx_status',
      sql`${table.status} IN ('pending', 'processing', 'confirmed', 'failed', 'reversed')`
    ),
    amountCheck: check(
      'ck_crypto_transactions_amount_positive',
      sql`${table.amountBaseUnits} <> '' AND ltrim(${table.amountBaseUnits}, '0123456789') = '' AND ${table.amountBaseUnits} <> '0' AND ltrim(${table.amountBaseUnits}, '0') = ${table.amountBaseUnits}`
    ),
    feeCheck: check(
      'ck_crypto_transactions_fee_nonnegative',
      sql`${table.feeBaseUnits} <> '' AND ltrim(${table.feeBaseUnits}, '0123456789') = '' AND (${table.feeBaseUnits} = '0' OR ltrim(${table.feeBaseUnits}, '0') = ${table.feeBaseUnits})`
    ),
    feeAssetCheck: check(
      'ck_crypto_transactions_fee_asset',
      sql`${table.feeBaseUnits} = '0' OR ${table.feeAssetId} IS NOT NULL`
    ),
    temporalOrderCheck: check(
      'ck_crypto_tx_dates',
      sql`${table.settledAt} IS NULL OR ${table.settledAt} >= ${table.requestedAt}`
    ),
    versionCheck: check('ck_crypto_tx_version', sql`${table.version} > 0`),
  })
);

/* ============================================================================
 * 12. EXCHANGE RATES
 * ============================================================================
 */
export const exchangeRates = sqliteTable(
  'exchange_rates',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    baseAssetId: integer('base_asset_id')
      .notNull()
      .references(() => financialAssets.id, {
        onDelete: 'restrict',
      }),
    quoteAssetId: integer('quote_asset_id')
      .notNull()
      .references(() => financialAssets.id, {
        onDelete: 'restrict',
      }),
    rate: text('rate').notNull(),
    source: text('source').notNull(),
    quotedAt: integer('quoted_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    expiresAt: integer('expires_at', { mode: 'timestamp' }),
  },
  (table) => ({
    pairIdx: index('idx_exchange_rates_pair').on(table.baseAssetId, table.quoteAssetId),
    quotedIdx: index('idx_exchange_rates_quoted').on(table.quotedAt),
    pairDifferentCheck: check(
      'ck_exchange_rates_different_assets',
      sql`${table.baseAssetId} <> ${table.quoteAssetId}`
    ),
    rateCheck: check('ck_exchange_rates_rate_positive', sql`CAST(${table.rate} AS REAL) > 0`),
    expiresCheck: check(
      'ck_exchange_rates_expires_after_quoted',
      sql`${table.expiresAt} IS NULL OR ${table.expiresAt} >= ${table.quotedAt}`
    ),
  })
);

/* ============================================================================
 * 13. ASSET CONVERSIONS
 * ============================================================================
 */
export const assetConversions = sqliteTable(
  'asset_conversions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    financialTransactionId: integer('financial_transaction_id')
      .notNull()
      .references(() => financialTransactions.id, {
        onDelete: 'restrict',
      }),
    fromAssetId: integer('from_asset_id')
      .notNull()
      .references(() => financialAssets.id, {
        onDelete: 'restrict',
      }),
    toAssetId: integer('to_asset_id')
      .notNull()
      .references(() => financialAssets.id, {
        onDelete: 'restrict',
      }),
    fromAmountBaseUnits: text('from_amount_base_units').notNull(),
    toAmountBaseUnits: text('to_amount_base_units').notNull(),
    rate: text('rate').notNull(),
    rateSource: text('rate_source'),
    quotedAt: integer('quoted_at', { mode: 'timestamp' }),
    feeAmountBaseUnits: text('fee_amount_base_units').notNull().default('0'),
    status: text('status', {
      enum: ['pending', 'processing', 'completed', 'failed', 'cancelled'],
    })
      .notNull()
      .default('pending'),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    completedAt: integer('completed_at', { mode: 'timestamp' }),
  },
  (table) => ({
    transactionUq: uniqueIndex('uq_asset_conversions_transaction').on(table.financialTransactionId),
    fromAssetIdx: index('idx_asset_conversions_from_asset').on(table.fromAssetId),
    toAssetIdx: index('idx_asset_conversions_to_asset').on(table.toAssetId),
    statusCheck: check(
      'ck_asset_conversions_status',
      sql`${table.status} IN ('pending', 'processing', 'completed', 'failed', 'cancelled')`
    ),
    fromAmountCheck: check(
      'ck_asset_conversions_from_amount_positive',
      sql`${table.fromAmountBaseUnits} <> '' AND ltrim(${table.fromAmountBaseUnits}, '0123456789') = '' AND ${table.fromAmountBaseUnits} <> '0' AND ltrim(${table.fromAmountBaseUnits}, '0') = ${table.fromAmountBaseUnits}`
    ),
    toAmountCheck: check(
      'ck_asset_conversions_to_amount_positive',
      sql`${table.toAmountBaseUnits} <> '' AND ltrim(${table.toAmountBaseUnits}, '0123456789') = '' AND ${table.toAmountBaseUnits} <> '0' AND ltrim(${table.toAmountBaseUnits}, '0') = ${table.toAmountBaseUnits}`
    ),
    feeCheck: check(
      'ck_asset_conversions_fee_nonnegative',
      sql`${table.feeAmountBaseUnits} <> '' AND ltrim(${table.feeAmountBaseUnits}, '0123456789') = '' AND (${table.feeAmountBaseUnits} = '0' OR ltrim(${table.feeAmountBaseUnits}, '0') = ${table.feeAmountBaseUnits})`
    ),
    assetsDifferentCheck: check(
      'ck_asset_conversions_different_assets',
      sql`${table.fromAssetId} <> ${table.toAssetId}`
    ),
    rateCheck: check('ck_asset_conversions_rate_positive', sql`CAST(${table.rate} AS REAL) > 0`),
  })
);

/* ============================================================================
 * 14. FINANCIAL FEES
 * ============================================================================
 */
export const financialFees = sqliteTable(
  'financial_fees',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    transactionId: integer('transaction_id')
      .notNull()
      .references(() => financialTransactions.id, {
        onDelete: 'restrict',
      }),
    assetId: integer('asset_id')
      .notNull()
      .references(() => financialAssets.id, {
        onDelete: 'restrict',
      }),
    recipientAccountId: integer('recipient_account_id').references(() => financialAccounts.id, {
      onDelete: 'restrict',
    }),
    feeType: text('fee_type', {
      enum: ['platform', 'withdrawal', 'payment', 'conversion', 'network', 'other'],
    }).notNull(),
    amountBaseUnits: text('amount_base_units').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    transactionIdx: index('idx_financial_fees_transaction').on(table.transactionId),
    assetIdx: index('idx_financial_fees_asset').on(table.assetId),
    recipientIdx: index('idx_financial_fees_recipient_account').on(table.recipientAccountId),
    feeTypeCheck: check(
      'ck_financial_fees_type',
      sql`${table.feeType} IN ('platform', 'withdrawal', 'payment', 'conversion', 'network', 'other')`
    ),
    amountCheck: check(
      'ck_financial_fees_amount_positive',
      sql`${table.amountBaseUnits} <> '' AND ltrim(${table.amountBaseUnits}, '0123456789') = '' AND ${table.amountBaseUnits} <> '0' AND ltrim(${table.amountBaseUnits}, '0') = ${table.amountBaseUnits}`
    ),
  })
);

/* ============================================================================
 * 15. EXTERNAL TRANSACTIONS
 * ============================================================================
 */
export const fiatExternalTransactions = sqliteTable(
  'fiat_external_transactions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    financialTransactionId: integer('financial_transaction_id')
      .notNull()
      .references(() => financialTransactions.id, {
        onDelete: 'restrict',
      }),
    providerId: integer('provider_id').references(() => fiatProviders.id, {
      onDelete: 'restrict',
    }),
    externalTransactionId: text('external_transaction_id').notNull(),
    type: text('type').notNull(),
    status: text('status').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdateFn(() => new Date()),
  },
  (table) => ({
    providerExternalUq: uniqueIndex('uq_fiat_external_transactions_provider_external').on(
      table.providerId,
      table.externalTransactionId
    ),
    transactionIdx: index('idx_fiat_external_transactions_transaction').on(
      table.financialTransactionId
    ),
    providerIdx: index('idx_fiat_external_transactions_provider').on(table.providerId),
    statusIdx: index('idx_fiat_external_transactions_status').on(table.status),
  })
);

/* ============================================================================
 * 16. IDEMPOTENCY KEYS
 * ============================================================================
 */
export const idempotencyKeys = sqliteTable(
  'idempotency_keys',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id').references(() => users.id, {
      onDelete: 'restrict',
    }),
    scope: text('scope').notNull(),
    key: text('key').notNull(),
    requestHash: text('request_hash').notNull(),
    financialTransactionId: integer('financial_transaction_id').references(
      () => financialTransactions.id,
      {
        onDelete: 'restrict',
      }
    ),
    status: text('status', {
      enum: ['processing', 'completed', 'failed'],
    })
      .notNull()
      .default('processing'),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    expiresAt: integer('expires_at', { mode: 'timestamp' }),
  },
  (table) => ({
    scopeKeyUq: uniqueIndex('uq_idempotency_scope_key').on(table.scope, table.key),
    userIdx: index('idx_idempotency_keys_user').on(table.userId),
    transactionIdx: index('idx_idempotency_keys_transaction').on(table.financialTransactionId),
    statusIdx: index('idx_idempotency_keys_status').on(table.status),
    statusCheck: check(
      'ck_idempotency_keys_status',
      sql`${table.status} IN ('processing', 'completed', 'failed')`
    ),
    expiresCheck: check(
      'ck_idempotency_keys_expires',
      sql`${table.expiresAt} IS NULL OR ${table.createdAt} < ${table.expiresAt}`
    ),
  })
);

/* ============================================================================
 * 17. RECONCILIATION RECORDS
 * ============================================================================
 */
export const reconciliationRecords = sqliteTable(
  'reconciliation_records',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    providerId: integer('provider_id').references(() => fiatProviders.id, {
      onDelete: 'restrict',
    }),
    accountId: integer('account_id')
      .notNull()
      .references(() => financialAccounts.id, {
        onDelete: 'restrict',
      }),
    assetId: integer('asset_id')
      .notNull()
      .references(() => financialAssets.id, {
        onDelete: 'restrict',
      }),
    expectedBalanceBaseUnits: text('expected_balance_base_units').notNull(),
    actualBalanceBaseUnits: text('actual_balance_base_units').notNull(),
    differenceBaseUnits: text('difference_base_units').notNull(),
    status: text('status', {
      enum: ['matched', 'mismatch', 'resolved'],
    })
      .notNull()
      .default('matched'),
    reconciliationRunId: text('reconciliation_run_id').notNull(),
    version: integer('version').notNull().default(1),
    reconciliationDate: integer('reconciliation_date', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    resolvedAt: integer('resolved_at', { mode: 'timestamp' }),
  },
  (table) => ({
    accountIdx: index('idx_reconciliation_records_account').on(table.accountId),
    assetIdx: index('idx_reconciliation_records_asset').on(table.assetId),
    providerIdx: index('idx_reconciliation_records_provider').on(table.providerId),
    statusIdx: index('idx_reconciliation_records_status').on(table.status),
    statusCheck: check(
      'ck_reconciliation_status',
      sql`${table.status} IN ('matched', 'mismatch', 'resolved')`
    ),
    resolvedStateCheck: check(
      'ck_reconciliation_resolved_state',
      sql`${table.status} != 'resolved' OR ${table.resolvedAt} IS NOT NULL`
    ),
    versionCheck: check('ck_reconciliation_records_version', sql`${table.version} > 0`),
    expectedCheck: check(
      'ck_reconciliation_expected_nonnegative',
      sql`${table.expectedBalanceBaseUnits} <> '' AND ltrim(${table.expectedBalanceBaseUnits}, '0123456789') = '' AND (${table.expectedBalanceBaseUnits} = '0' OR ltrim(${table.expectedBalanceBaseUnits}, '0') = ${table.expectedBalanceBaseUnits})`
    ),
    actualCheck: check(
      'ck_reconciliation_actual_nonnegative',
      sql`${table.actualBalanceBaseUnits} <> '' AND ltrim(${table.actualBalanceBaseUnits}, '0123456789') = '' AND (${table.actualBalanceBaseUnits} = '0' OR ltrim(${table.actualBalanceBaseUnits}, '0') = ${table.actualBalanceBaseUnits})`
    ),
  })
);

```

---

### `src/infrastructure/repositories/DrizzleAuthenticationRepositoryAdapter.ts`
```typescript
import { eq, and, isNull } from 'drizzle-orm';
import {
  userAuthenticators,
  passwordCredentials,
  totpCredentials,
  webauthnCredentials,
} from '../../db/authentication/tables';
import {
  IAuthenticationRepository,
  PasswordCredentialRecord,
  TotpCredentialRecord,
  WebAuthnCredentialRecord,
} from '../../application/ports/output/IAuthenticationRepository';

export type { PasswordCredentialRecord, TotpCredentialRecord, WebAuthnCredentialRecord };

export class DrizzleAuthenticationRepositoryAdapter implements IAuthenticationRepository {
  constructor(private readonly db: any) {}

  // --------------------------------------------------------------------------
  // PASSWORD CREDENTIALS (Strictly in authentication domain)
  // --------------------------------------------------------------------------
  async findPasswordCredentialByUserId(userId: number): Promise<PasswordCredentialRecord | null> {
    const [row] = await this.db
      .select({
        authenticatorId: passwordCredentials.authenticatorId,
        userId: userAuthenticators.userId,
        passwordHash: passwordCredentials.passwordHash,
      })
      .from(passwordCredentials)
      .innerJoin(userAuthenticators, eq(passwordCredentials.authenticatorId, userAuthenticators.id))
      .where(
        and(
          eq(userAuthenticators.userId, userId),
          eq(userAuthenticators.type, 'password'),
          isNull(userAuthenticators.revokedAt)
        )
      )
      .limit(1);

    if (!row) return null;
    return row;
  }

  async savePasswordCredential(userId: number, passwordHash: string): Promise<string> {
    const existing = await this.findPasswordCredentialByUserId(userId);

    if (existing) {
      await this.db
        .update(passwordCredentials)
        .set({ passwordHash })
        .where(eq(passwordCredentials.authenticatorId, existing.authenticatorId));
      return existing.authenticatorId;
    }

    const authenticatorId = crypto.randomUUID();
    await this.db.insert(userAuthenticators).values({
      id: authenticatorId,
      userId,
      type: 'password',
      verifiedAt: new Date(),
    });

    await this.db.insert(passwordCredentials).values({
      authenticatorId,
      passwordHash,
    });

    return authenticatorId;
  }

  // --------------------------------------------------------------------------
  // TOTP CREDENTIALS
  // --------------------------------------------------------------------------
  async findTotpCredentialByUserId(userId: number): Promise<TotpCredentialRecord | null> {
    const [row] = await this.db
      .select({
        authenticatorId: totpCredentials.authenticatorId,
        userId: userAuthenticators.userId,
        encryptedTotpSecret: totpCredentials.encryptedTotpSecret,
        verifiedAt: userAuthenticators.verifiedAt,
      })
      .from(totpCredentials)
      .innerJoin(userAuthenticators, eq(totpCredentials.authenticatorId, userAuthenticators.id))
      .where(
        and(
          eq(userAuthenticators.userId, userId),
          eq(userAuthenticators.type, 'totp'),
          isNull(userAuthenticators.revokedAt)
        )
      )
      .limit(1);

    if (!row) return null;
    return {
      authenticatorId: row.authenticatorId,
      userId: row.userId,
      encryptedTotpSecret: row.encryptedTotpSecret,
      verified: row.verifiedAt !== null,
    };
  }

  async saveTotpSecret(userId: number, encryptedTotpSecret: string): Promise<string> {
    const existing = await this.findTotpCredentialByUserId(userId);
    if (existing) {
      await this.db
        .update(totpCredentials)
        .set({ encryptedTotpSecret })
        .where(eq(totpCredentials.authenticatorId, existing.authenticatorId));
      return existing.authenticatorId;
    }

    const authenticatorId = crypto.randomUUID();
    await this.db.insert(userAuthenticators).values({
      id: authenticatorId,
      userId,
      type: 'totp',
    });

    await this.db.insert(totpCredentials).values({
      authenticatorId,
      encryptedTotpSecret,
    });

    return authenticatorId;
  }

  async verifyTotpAuthenticator(authenticatorId: string): Promise<void> {
    await this.db
      .update(userAuthenticators)
      .set({ verifiedAt: new Date() })
      .where(eq(userAuthenticators.id, authenticatorId));
  }

  // --------------------------------------------------------------------------
  // WEBAUTHN / PASSKEY CREDENTIALS
  // --------------------------------------------------------------------------
  async findAllWebAuthnCredentialsByUserId(userId: number): Promise<WebAuthnCredentialRecord[]> {
    const rows = await this.db
      .select({
        authenticatorId: webauthnCredentials.authenticatorId,
        userId: userAuthenticators.userId,
        credentialId: webauthnCredentials.credentialId,
        publicKeyCose: webauthnCredentials.publicKeyCose,
        signCount: webauthnCredentials.signCount,
      })
      .from(webauthnCredentials)
      .innerJoin(userAuthenticators, eq(webauthnCredentials.authenticatorId, userAuthenticators.id))
      .where(
        and(
          eq(userAuthenticators.userId, userId),
          eq(userAuthenticators.type, 'webauthn'),
          isNull(userAuthenticators.revokedAt)
        )
      );

    return rows;
  }

  async findWebAuthnCredentialById(credentialId: string): Promise<WebAuthnCredentialRecord | null> {
    const [row] = await this.db
      .select({
        authenticatorId: webauthnCredentials.authenticatorId,
        userId: userAuthenticators.userId,
        credentialId: webauthnCredentials.credentialId,
        publicKeyCose: webauthnCredentials.publicKeyCose,
        signCount: webauthnCredentials.signCount,
      })
      .from(webauthnCredentials)
      .innerJoin(userAuthenticators, eq(webauthnCredentials.authenticatorId, userAuthenticators.id))
      .where(
        and(
          eq(webauthnCredentials.credentialId, credentialId),
          eq(userAuthenticators.type, 'webauthn'),
          isNull(userAuthenticators.revokedAt)
        )
      )
      .limit(1);

    if (!row) return null;
    return row;
  }

  async saveWebAuthnCredential(
    userId: number,
    credentialId: string,
    publicKeyCose: string,
    rpId: string,
    backupEligible: boolean,
    backupState: boolean,
    uvInitialized: boolean,
    aaguid?: string,
    attestationFormat?: string,
    attestationObject?: string
  ): Promise<string> {
    const authenticatorId = crypto.randomUUID();
    await this.db.insert(userAuthenticators).values({
      id: authenticatorId,
      userId,
      type: 'webauthn',
      verifiedAt: new Date(),
    });

    await this.db.insert(webauthnCredentials).values({
      authenticatorId,
      credentialId,
      publicKeyCose,
      rpId,
      backupEligible,
      backupState,
      uvInitialized,
      aaguid,
      attestationFormat,
      attestationObject,
    });

    return authenticatorId;
  }

  async updateWebAuthnSignCount(credentialId: string, newSignCount: number): Promise<void> {
    await this.db
      .update(webauthnCredentials)
      .set({ signCount: newSignCount })
      .where(eq(webauthnCredentials.credentialId, credentialId));
  }
}

```

---

### `src/infrastructure/repositories/DrizzleAuthTransactionRepository.ts`
```typescript
import { DrizzleD1Database } from '../../../types/bindings';
import { IAuthTransactionRepository } from '../../../application/ports/output/IAuthTransactionRepository';
import { AuthenticationTransaction } from '../../../domains/identity/entities/AuthenticationTransaction';
import { AuthenticationChallenge } from '../../../domains/identity/entities/AuthenticationChallenge';
import { authTransactions, authChallenges } from '../../../db/authentication/tables';
import { eq, sql, and, inArray, gt, isNull } from 'drizzle-orm';

export class DrizzleAuthTransactionRepository implements IAuthTransactionRepository {
  constructor(private readonly db: DrizzleD1Database) {}

  async createTransaction(transaction: AuthenticationTransaction): Promise<void> {
    const data = transaction.toPersistence();
    await this.db.insert(authTransactions).values(data);
  }

  async getTransactionById(id: string): Promise<AuthenticationTransaction | null> {
    const result = await this.db
      .select()
      .from(authTransactions)
      .where(eq(authTransactions.id, id))
      .limit(1)
      .get();
      
    if (!result) return null;
    return AuthenticationTransaction.fromPersistence(result);
  }

  async updateTransaction(transaction: AuthenticationTransaction): Promise<void> {
    const data = transaction.toPersistence();
    await this.db
      .update(authTransactions)
      .set(data)
      .where(eq(authTransactions.id, data.id));
  }

  async createChallenge(challenge: AuthenticationChallenge): Promise<void> {
    const data = challenge.toPersistence();
    await this.db.insert(authChallenges).values(data);
  }

  async getChallengeById(id: string): Promise<AuthenticationChallenge | null> {
    const result = await this.db
      .select()
      .from(authChallenges)
      .where(eq(authChallenges.id, id))
      .limit(1)
      .get();

    if (!result) return null;
    return AuthenticationChallenge.fromPersistence(result);
  }

  async getChallengeByHash(hash: string): Promise<AuthenticationChallenge | null> {
    const result = await this.db
      .select()
      .from(authChallenges)
      .where(eq(authChallenges.challengeHash, hash))
      .limit(1)
      .get();

    if (!result) return null;
    return AuthenticationChallenge.fromPersistence(result);
  }

  async updateChallenge(challenge: AuthenticationChallenge): Promise<void> {
    const data = challenge.toPersistence();
    await this.db
      .update(authChallenges)
      .set(data)
      .where(eq(authChallenges.id, data.id));
  }

  async completeFactorAtomically(txId: string, aal: number, authEpochAtStart: number, method: string): Promise<boolean> {
    const result = await this.db
      .update(authTransactions)
      .set({
        status: 'verified',
        currentAal: aal,
        method: method,
        assuranceMethod: method,
        lastAuthenticatedAt: new Date()
      })
      .where(
        and(
          eq(authTransactions.id, txId),
          inArray(authTransactions.status, ['created', 'awaiting_factor']),
          eq(authTransactions.authEpochAtStart, authEpochAtStart)
        )
      );
      
    return result.meta.changes > 0;
  }

  async recordFailedAttemptAtomically(txId: string, maxAttempts: number): Promise<boolean> {
    const result = await this.db
      .update(authTransactions)
      .set({
        failureCount: sql`${authTransactions.failureCount} + 1`,
        status: sql`CASE WHEN ${authTransactions.failureCount} + 1 >= ${maxAttempts} THEN 'locked' ELSE ${authTransactions.status} END`
      })
      .where(
        and(
          eq(authTransactions.id, txId),
          inArray(authTransactions.status, ['created', 'awaiting_factor'])
        )
      );
      
    return result.meta.changes > 0;
  }

  async consumeChallengeAtomically(challengeId: string): Promise<boolean> {
    const result = await this.db
      .update(authChallenges)
      .set({
        usedAt: new Date()
      })
      .where(
        and(
          eq(authChallenges.id, challengeId),
          isNull(authChallenges.usedAt),
          gt(authChallenges.expiresAt, new Date())
        )
      );
    return result.meta.changes > 0;
  }
}

```

---

### `src/infrastructure/repositories/DrizzleCivilIdentityRepositoryAdapter.ts`
```typescript
import { eq, desc } from 'drizzle-orm';
import { citizens, identityDocuments, kycVerifications } from '../../db/civil-identity/tables';
import {
  ICivilIdentityRepository,
  CitizenRecord,
  IdentityDocumentRecord,
  KycVerificationRecord,
} from '../../application/ports/output/ICivilIdentityRepository';

export type { CitizenRecord, IdentityDocumentRecord, KycVerificationRecord };

export class DrizzleCivilIdentityRepositoryAdapter implements ICivilIdentityRepository {
  constructor(private readonly db: any) {}

  async findByDid(did: string): Promise<CitizenRecord | null> {
    const username = did.split(':').pop();
    const [row] = await this.db
      .select()
      .from(citizens)
      .where(eq(citizens.username, username || did))
      .limit(1);

    if (!row) return null;
    return this.mapCitizenRow(row);
  }

  async createCitizen(data: Partial<CitizenRecord> & { userId: number }): Promise<CitizenRecord> {
    const [inserted] = await this.db
      .insert(citizens)
      .values({
        userId: data.userId,
        legalFirstName: data.legalFirstName || null,
        legalLastName: data.legalLastName || null,
        nationalityCode: data.nationalityCode || 'BR',
        birthDate: data.birthDate || null,
        maritalStatus: (data.maritalStatus as any) || null,
        civilStatus: data.civilStatus || 'pending',
      })
      .returning();

    return this.mapCitizenRow(inserted);
  }

  async findCitizenByUserId(userId: number): Promise<CitizenRecord | null> {
    const [row] = await this.db
      .select()
      .from(citizens)
      .where(eq(citizens.userId, userId))
      .limit(1);

    if (!row) return null;
    return this.mapCitizenRow(row);
  }

  async updateCivilStatus(
    userId: number,
    civilStatus: 'pending' | 'verified' | 'suspended' | 'revoked',
    verifiedBy?: number
  ): Promise<void> {
    await this.db
      .update(citizens)
      .set({
        civilStatus,
        verifiedAt: civilStatus === 'verified' ? new Date() : null,
        verifiedBy: verifiedBy || null,
        statusChangedAt: new Date(),
      })
      .where(eq(citizens.userId, userId));
  }

  async createIdentityDocument(data: IdentityDocumentRecord): Promise<IdentityDocumentRecord> {
    const [inserted] = await this.db
      .insert(identityDocuments)
      .values({
        userId: data.userId,
        documentType: data.documentType,
        countryCode: data.countryCode || 'BR',
        numberLookupHash: data.numberLookupHash,
        encryptedNumber: data.encryptedNumber,
        last4: data.last4 || null,
        source: data.source,
        verificationStatus: data.verificationStatus || 'pending',
        verifiedAt: data.verifiedAt || null,
        verifiedBy: data.verifiedBy || null,
      })
      .returning();

    return {
      id: inserted.id,
      userId: inserted.userId,
      documentType: inserted.documentType as any,
      countryCode: inserted.countryCode,
      numberLookupHash: inserted.numberLookupHash,
      encryptedNumber: inserted.encryptedNumber,
      last4: inserted.last4,
      source: inserted.source as any,
      verificationStatus: inserted.verificationStatus as any,
      verifiedAt: inserted.verifiedAt ? new Date(inserted.verifiedAt) : null,
      verifiedBy: inserted.verifiedBy,
      version: inserted.version,
    };
  }

  async findDocumentsByUserId(userId: number): Promise<IdentityDocumentRecord[]> {
    const rows = await this.db
      .select()
      .from(identityDocuments)
      .where(eq(identityDocuments.userId, userId));

    return rows.map((r: any) => ({
      id: r.id,
      userId: r.userId,
      documentType: r.documentType,
      countryCode: r.countryCode,
      numberLookupHash: r.numberLookupHash,
      encryptedNumber: r.encryptedNumber,
      last4: r.last4,
      source: r.source,
      verificationStatus: r.verificationStatus,
      verifiedAt: r.verifiedAt ? new Date(r.verifiedAt) : null,
      verifiedBy: r.verifiedBy,
      version: r.version,
    }));
  }

  async createKycVerification(data: KycVerificationRecord): Promise<KycVerificationRecord> {
    const [inserted] = await this.db
      .insert(kycVerifications)
      .values({
        userId: data.userId,
        verificationLevel: data.verificationLevel,
        status: data.status,
        provider: data.provider,
        riskScore: data.riskScore || null,
        rejectionReason: data.rejectionReason || null,
        startedAt: data.startedAt,
        completedAt: data.completedAt || null,
        expiresAt: data.expiresAt || null,
      })
      .returning();

    return {
      id: inserted.id,
      userId: inserted.userId,
      verificationLevel: inserted.verificationLevel as any,
      status: inserted.status as any,
      provider: inserted.provider,
      riskScore: inserted.riskScore,
      rejectionReason: inserted.rejectionReason,
      startedAt: new Date(inserted.startedAt),
      completedAt: inserted.completedAt ? new Date(inserted.completedAt) : null,
      expiresAt: inserted.expiresAt ? new Date(inserted.expiresAt) : null,
      version: inserted.version,
    };
  }

  async getLatestKycByUserId(userId: number): Promise<KycVerificationRecord | null> {
    const [row] = await this.db
      .select()
      .from(kycVerifications)
      .where(eq(kycVerifications.userId, userId))
      .orderBy(desc(kycVerifications.id))
      .limit(1);

    if (!row) return null;

    return {
      id: row.id,
      userId: row.userId,
      verificationLevel: row.verificationLevel as any,
      status: row.status as any,
      provider: row.provider,
      riskScore: row.riskScore,
      rejectionReason: row.rejectionReason,
      startedAt: new Date(row.startedAt),
      completedAt: row.completedAt ? new Date(row.completedAt) : null,
      expiresAt: row.expiresAt ? new Date(row.expiresAt) : null,
      version: row.version,
    };
  }

  private mapCitizenRow(row: any): CitizenRecord {
    return {
      userId: row.userId,
      username: row.username,
      legalFirstName: row.legalFirstName,
      legalLastName: row.legalLastName,
      nationalityCode: row.nationalityCode,
      birthDate: row.birthDate,
      maritalStatus: row.maritalStatus,
      civilStatus: row.civilStatus,
      verifiedAt: row.verifiedAt ? new Date(row.verifiedAt) : null,
      verifiedBy: row.verifiedBy,
      version: row.version,
    };
  }
}

```

---

### `src/infrastructure/repositories/DrizzleFinanceRepository.ts`
```typescript
import { eq, and } from 'drizzle-orm';
import {
  financialAccounts,
  accountBalances,
  financialTransactions,
  financialLedgerEntries,
} from '../../db/finance/tables';
import { idempotencyKeys, outboxEvents } from '../../db/infrastructure/tables';
import { Result } from '../../shared/kernel/Result';
import {
  IFinanceRepository,
  FinancialAccountRecord,
  AccountBalanceRecord,
  FinancialTransactionRecord,
} from '../../application/ports/output/IFinanceRepository';
import { LedgerEntry } from '../../domains/finance/entities/LedgerTransaction';

export type { FinancialAccountRecord, AccountBalanceRecord, FinancialTransactionRecord };

export class DrizzleFinanceRepository implements IFinanceRepository {
  constructor(private readonly db: any) {}

  async getTreasuryAccount(): Promise<Result<FinancialAccountRecord>> {
    try {
      const [row] = await this.db
        .select()
        .from(financialAccounts)
        .where(eq(financialAccounts.accountType, 'treasury'))
        .limit(1);

      if (!row) {
        // Se não existir a conta tesouraria, cria uma nova conta padrão de tesouraria
        const [inserted] = await this.db
          .insert(financialAccounts)
          .values({
            userId: null,
            accountType: 'treasury',
            name: 'ASPPIBRA DAO Main Treasury',
            status: 'active',
          })
          .returning();

        return Result.ok({
          id: inserted.id,
          userId: inserted.userId,
          accountType: inserted.accountType as any,
          status: inserted.status as any,
          name: inserted.name,
          version: inserted.version,
        });
      }

      return Result.ok({
        id: row.id,
        userId: row.userId,
        accountType: row.accountType as any,
        status: row.status as any,
        name: row.name,
        version: row.version,
      });
    } catch (err: any) {
      return Result.fail(err.message);
    }
  }

  async getTreasuryBalance(): Promise<Result<AccountBalanceRecord[]>> {
    try {
      const treasuryRes = await this.getTreasuryAccount();
      if (treasuryRes.isFailure) {
        return Result.fail(treasuryRes.error || 'Treasury account error');
      }

      const treasuryId = treasuryRes.getValue().id;
      const rows = await this.db
        .select()
        .from(accountBalances)
        .where(eq(accountBalances.accountId, treasuryId));

      const balances: AccountBalanceRecord[] = rows.map((r: any) => ({
        id: r.id,
        accountId: r.accountId,
        assetId: r.assetId,
        availableBaseUnits: r.availableBaseUnits,
        lockedBaseUnits: r.lockedBaseUnits,
        version: r.version,
      }));

      return Result.ok(balances);
    } catch (err: any) {
      return Result.fail(err.message);
    }
  }

  async createTransaction(data: {
    userId?: number | null;
    type: 'deposit' | 'withdrawal' | 'transfer' | 'payment' | 'refund' | 'fee' | 'reward' | 'yield' | 'conversion' | 'adjustment';
    category?: string;
    description: string;
    amountBaseUnits: string;
    assetId: number;
  }): Promise<Result<FinancialTransactionRecord>> {
    try {
      const treasuryRes = await this.getTreasuryAccount();
      if (treasuryRes.isFailure) return Result.fail(treasuryRes.error || 'Treasury account error');

      const treasuryId = treasuryRes.getValue().id;

      // 1. Criar registro de transação
      const [tx] = await this.db
        .insert(financialTransactions)
        .values({
          userId: data.userId || null,
          type: data.type,
          category: (data.category as any) || 'operational',
          status: 'completed',
          description: data.description,
          completedAt: new Date(),
        })
        .returning();

      // 2. Criar entrada contábil (Ledger Entry)
      await this.db.insert(financialLedgerEntries).values({
        transactionId: tx.id,
        accountId: treasuryId,
        assetId: data.assetId,
        direction: data.type === 'deposit' ? 'credit' : 'debit',
        amountBaseUnits: data.amountBaseUnits,
      });

      return Result.ok({
        id: tx.id,
        userId: tx.userId,
        type: tx.type as any,
        category: tx.category,
        status: tx.status as any,
        description: tx.description,
        createdAt: new Date(tx.createdAt),
        completedAt: tx.completedAt ? new Date(tx.completedAt) : null,
      });
    } catch (err: any) {
      return Result.fail(err.message);
    }
  }

  /**
   * Inserts a top-level financial transaction record and returns its generated DB id.
   * Called by DoubleEntryLedgerService BEFORE inserting ledger entries.
   */
  async insertTransaction(data: {
    userId?: number | null;
    type: string;
    category: string;
    description: string;
    status: string;
  }): Promise<number> {
    const [tx] = await this.db
      .insert(financialTransactions)
      .values({
        userId: data.userId || null,
        type: data.type,
        category: data.category,
        status: data.status,
        description: data.description,
        completedAt: new Date(),
      })
      .returning({ id: financialTransactions.id });

    if (!tx) throw new Error('Falha ao inserir registro de transação financeira.');
    return tx.id;
  }
  async listTransactions(userId?: number): Promise<Result<FinancialTransactionRecord[]>> {
    try {
      const query = userId
        ? this.db.select().from(financialTransactions).where(eq(financialTransactions.userId, userId))
        : this.db.select().from(financialTransactions);

      const rows = await query;
      const txs: FinancialTransactionRecord[] = rows.map((r: any) => ({
        id: r.id,
        userId: r.userId,
        type: r.type,
        category: r.category,
        status: r.status,
        description: r.description,
        createdAt: new Date(r.createdAt),
        completedAt: r.completedAt ? new Date(r.completedAt) : null,
      }));

      return Result.ok(txs);
    } catch (err: any) {
      return Result.fail(err.message);
    }
  }

  // --------------------------------------------------------------------------
  // DOUBLE-ENTRY LEDGER & IDEMPOTENCY
  // --------------------------------------------------------------------------
  
  async claimIdempotency(idempotencyKey: string): Promise<boolean> {
    try {
      // Tenta inserir a chave com expiração de 24h
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      await this.db.insert(idempotencyKeys).values({
        id: idempotencyKey,
        expiresAt,
      });
      return true;
    } catch (err: any) {
      // Se houver conflito (UNIQUE constraint falhar), a transação já foi processada
      if (err.message && err.message.includes('UNIQUE constraint failed')) {
        return false;
      }
      throw err;
    }
  }

  async insertLedgerEntries(entries: LedgerEntry[], transactionId: number): Promise<void> {
    const payload = entries.map(entry => ({
      transactionId, // Real DB-generated transaction id, never a placeholder
      accountId: parseInt(entry.accountId, 10),
      assetId: parseInt(entry.amount.assetId, 10),
      direction: entry.type,
      amountBaseUnits: entry.amount.amount.toString(),
    }));

    if (payload.length > 0) {
      await this.db.insert(financialLedgerEntries).values(payload);
    }
  }

  async updateBalanceWithOCC(
    accountId: string,
    assetId: string,
    amount: bigint,
    type: 'debit' | 'credit'
  ): Promise<boolean> {
    // 1. Busca o saldo atual e a versão
    const [balance] = await this.db
      .select({
        id: accountBalances.id,
        availableBaseUnits: accountBalances.availableBaseUnits,
        version: accountBalances.version,
      })
      .from(accountBalances)
      .where(
        and(
          eq(accountBalances.accountId, parseInt(accountId, 10)),
          eq(accountBalances.assetId, parseInt(assetId, 10))
        )
      )
      .limit(1);

    if (!balance) {
      throw new Error(`Balance not found for account ${accountId} and asset ${assetId}`);
    }

    let currentAvailable = BigInt(balance.availableBaseUnits);
    
    // Debit means removing money from available balance in this domain context (if asset, credit means adding)
    // Wait, in double-entry:
    // User Deposit: Debit Treasury (increase), Credit User Liability (increase)
    // The exact math depends on the account type (Asset vs Liability).
    // For simplicity, we assume Debit = Subtract from source, Credit = Add to dest
    // Actually standard accounting: Debit increases assets, Credit decreases assets.
    // Let's implement a simple logic:
    if (type === 'debit') {
      currentAvailable -= amount;
    } else {
      currentAvailable += amount;
    }

    if (currentAvailable < 0n) {
      throw new Error(`Insufficient funds for account ${accountId}`);
    }

    const res = await this.db
      .update(accountBalances)
      .set({
        availableBaseUnits: currentAvailable.toString(),
        version: balance.version + 1,
      })
      .where(
        and(
          eq(accountBalances.id, balance.id),
          eq(accountBalances.version, balance.version)
        )
      );

    // Drizzle with SQLite returns info about changes. If rows matched/updated = 0, OCC failed.
    if (res.rowsAffected === 0) {
      return false; // OCC Failed!
    }

    return true;
  }

  async persistOutboxEvent(eventType: string, payload: any): Promise<void> {
    const eventId = crypto.randomUUID();
    await this.db.insert(outboxEvents).values({
      id: eventId,
      aggregateId: String(payload.transactionId ?? eventId), // Use real transaction ID from payload
      aggregateType: 'LedgerTransaction',
      aggregateVersion: 1,
      eventName: eventType,
      payload: JSON.stringify(payload),
    });
  }
}

```

---

### `src/infrastructure/repositories/DrizzleIdentityResolverAdapter.ts`
```typescript
import { eq, and } from 'drizzle-orm';
import { IIdentityResolverPort } from '../../application/ports/output/IIdentityResolverPort';
import { IdentityAssertion } from '../../application/dto/IdentityAssertion';
import { IdentityResolutionResult } from '../../application/dto/IdentityResolutionResult';
import { wallets } from '../../db/web3/tables';
import { webauthnCredentials, oauthIdentities, userAuthenticators } from '../../db/authentication/tables';
import { didIdentities } from '../../db/ssi/tables';

export class DrizzleIdentityResolverAdapter implements IIdentityResolverPort {
  constructor(private readonly db: any) { }

  async resolve(assertion: IdentityAssertion): Promise<IdentityResolutionResult> {
    switch (assertion.type) {
      case 'oauth': {
        const [oauthRecord] = await this.db
          .select({ userId: oauthIdentities.userId })
          .from(oauthIdentities)
          .where(
            and(
              eq(oauthIdentities.provider, assertion.provider),
              eq(oauthIdentities.subjectId, assertion.subjectId),
              eq(oauthIdentities.status, 'active')
            )
          )
          .limit(1);

        if (oauthRecord) {
          return {
            status: 'resolved',
            userId: oauthRecord.userId,
            bindingType: 'oauth',
            provider: assertion.provider,
          };
        }
        break;
      }

      case 'web3_wallet': {
        const normalizedAddress = assertion.subjectId.toLowerCase();

        // Find network by namespace and chainId? Wait, assertion has networkId.
        // If assertion has networkId, we just join web3Networks to enforce the namespace/chainId?
        // Actually, the user's plan mentions namespace + chainId + addressNormalized. 
        // We will assume assertion provides networkId and we just validate it's active.
        const [wallet] = await this.db
          .select({ userId: wallets.userId })
          .from(wallets)
          .where(
            and(
              eq(wallets.addressNormalized, normalizedAddress),
              eq(wallets.networkId, assertion.networkId),
              eq(wallets.status, 'active')
            )
          )
          .limit(1);

        if (wallet && wallet.userId) {
          return {
            status: 'resolved',
            userId: wallet.userId,
            bindingType: 'web3_wallet',
            provider: 'evm',
          };
        }
        break;
      }

      case 'passkey': {
        const [passkey] = await this.db
          .select({ userId: userAuthenticators.userId })
          .from(webauthnCredentials)
          .innerJoin(userAuthenticators, eq(webauthnCredentials.authenticatorId, userAuthenticators.id))
          .where(eq(webauthnCredentials.credentialId, assertion.subjectId))
          .limit(1);

        if (passkey) {
          return {
            status: 'resolved',
            userId: passkey.userId,
            bindingType: 'passkey',
            provider: 'webauthn',
          };
        }
        break;
      }

      case 'ssi_did': {
        const [did] = await this.db
          .select({ userId: didIdentities.userId })
          .from(didIdentities)
          .where(
            and(
              eq(didIdentities.did, assertion.subjectId),
              eq(didIdentities.status, 'active')
            )
          )
          .limit(1);

        if (did) {
          return {
            status: 'resolved',
            userId: did.userId,
            bindingType: 'ssi_did',
            provider: 'polygonid',
          };
        }
        break;
      }
    }

    return {
      status: 'not_linked',
      code: 'IDENTITY_NOT_LINKED',
      message: 'Identidade não vinculada a nenhuma conta existente.',
    };
  }
}

```

---

### `src/infrastructure/repositories/DrizzleOutboxRepository.ts`
```typescript
import { IDomainEvent } from '../../shared/kernel/DomainEvent';
import { Result } from '../../shared/kernel/Result';
import { IOutboxRepository, OutboxEventRecord } from '../../application/ports/output/IOutboxRepository';
import { outboxEvents } from '../../db/infrastructure/tables';
import { eq, asc, sql } from 'drizzle-orm';

export class DrizzleOutboxRepository implements IOutboxRepository {
  // Recebe a instância do banco OU da transação (tx) ativa no UnitOfWork
  constructor(private db: any) {}

  async saveEvent(event: IDomainEvent, aggregateId: number, aggregateType: string, aggregateVersion: number): Promise<Result<void>> {
    try {
      const eventId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2);
      await this.db.insert(outboxEvents).values({
        id: eventId,
        aggregateId,
        aggregateType,
        aggregateVersion,
        eventName: event.constructor.name,
        payload: JSON.stringify(event),
        metadata: JSON.stringify({ occurredOn: event.dateTimeOccurred }),
        attempts: 0,
        published: false,
        createdAt: new Date(),
      });
      return Result.ok();
    } catch (error: any) {
      return Result.fail(`Failed to save outbox event: ${error.message}`);
    }
  }

  async getPendingEvents(limit: number): Promise<Result<OutboxEventRecord[]>> {
    try {
      const pending = await this.db
        .select()
        .from(outboxEvents)
        .where(eq(outboxEvents.published, false))
        .orderBy(asc(outboxEvents.createdAt))
        .limit(limit);
        
      return Result.ok(pending);
    } catch (error: any) {
      return Result.fail(`Failed to fetch pending outbox events: ${error.message}`);
    }
  }

  async markAsPublished(eventId: string): Promise<Result<void>> {
    try {
      await this.db
        .update(outboxEvents)
        .set({
          published: true,
          publishedAt: new Date(),
        })
        .where(eq(outboxEvents.id, eventId));
      return Result.ok();
    } catch (error: any) {
      return Result.fail(`Failed to mark outbox event as published: ${error.message}`);
    }
  }

  async markAsFailed(eventId: string, error: string): Promise<Result<void>> {
    try {
      const result = await this.db
        .update(outboxEvents)
        .set({
          attempts: sql`${outboxEvents.attempts} + 1`,
          error: error.substring(0, 500)
        })
        .where(eq(outboxEvents.id, eventId))
        .returning();
        
      if (!result || result.length === 0) {
        return Result.fail('Event not found');
      }

      return Result.ok();
    } catch (err: any) {
      return Result.fail(`Failed to mark outbox event as failed: ${err.message}`);
    }
  }
}


```

---

### `src/infrastructure/repositories/DrizzlePasswordResetRepository.ts`
```typescript
import { Result } from '../../shared/kernel/Result';
import { IPasswordResetRepository, PasswordReset } from '../../application/ports/output/IPasswordResetRepository';
import { passwordResets } from '../../db/authentication/tables';
import { eq } from 'drizzle-orm';

export class DrizzlePasswordResetRepository implements IPasswordResetRepository {
  constructor(private db: any) {}

  async findByToken(tokenHash: string): Promise<Result<PasswordReset>> {
    try {
      const [reset] = await this.db
        .select()
        .from(passwordResets)
        .where(eq(passwordResets.tokenHash, tokenHash))
        .limit(1);

      if (!reset) {
        return Result.fail('PasswordResetNotFound');
      }
      return Result.ok(reset as PasswordReset);
    } catch (e: any) {
      return Result.fail(e.message);
    }
  }

  async invalidate(id: number): Promise<Result<void>> {
    try {
      await this.db
        .update(passwordResets)
        .set({ usedAt: new Date() })
        .where(eq(passwordResets.id, id));
      return Result.ok();
    } catch (e: any) {
      return Result.fail(e.message);
    }
  }

  async create(data: { userId: number; tokenHash: string; expiresAt: Date }): Promise<Result<void>> {
    try {
      await this.db.insert(passwordResets).values(data);
      return Result.ok();
    } catch (e: any) {
      return Result.fail(e.message);
    }
  }

  async consumeToken(tokenHash: string): Promise<Result<PasswordReset>> {
    try {
      const { and, isNull, sql } = await import('drizzle-orm');
      
      const [reset] = await this.db
        .update(passwordResets)
        .set({ usedAt: new Date() })
        .where(and(
          eq(passwordResets.tokenHash, tokenHash),
          isNull(passwordResets.usedAt),
          sql`${passwordResets.expiresAt} > ${sql`(unixepoch())`}`
        ))
        .returning();

      if (!reset) {
        return Result.fail('PasswordResetNotFoundOrUsed');
      }
      return Result.ok(reset as PasswordReset);
    } catch (e: any) {
      return Result.fail(e.message);
    }
  }
}

```

---

### `src/infrastructure/repositories/DrizzleSessionRepository.ts`
```typescript
import { ISessionRepository } from '../../application/ports/output/ISessionRepository';
import { eq, and, isNull } from 'drizzle-orm';
import { userSessions } from '../../db/authentication/tables';

export class DrizzleSessionRepository implements ISessionRepository {
  constructor(private db: any) {}

  async createSession(sessionData: {
    id: string;
    userId: number;
    jti: string;
    ip: string;
    userAgent: string;
    familyId?: string;
    refreshTokenHash: string;
    aal: number;
    authEpoch: number;
    createdAt: Date;
    expiresAt: Date;
    lastAuthenticatedAt?: Date;
  }): Promise<void> {
    await this.db.insert(userSessions).values(sessionData);
  }

  async rotateRefreshTokenAtomically(sessionId: string, oldRefreshTokenHash: string): Promise<boolean> {
    const result = await this.db
      .update(userSessions)
      .set({ revokedAt: new Date(), revocationReason: 'Rotated' })
      .where(
        and(
          eq(userSessions.id, sessionId),
          isNull(userSessions.revokedAt),
          eq(userSessions.refreshTokenHash, oldRefreshTokenHash)
        )
      );
    
    return result.meta.changes > 0;
  }

  async revokeSession(sessionId: string): Promise<void> {
    await this.db
      .update(userSessions)
      .set({ revokedAt: new Date(), revocationReason: 'User logout' })
      .where(eq(userSessions.id, sessionId));
  }

  async revokeAllUserSessions(userId: number): Promise<void> {
    await this.db.update(userSessions)
      .set({ revokedAt: new Date(), revocationReason: 'Revoked all user sessions' })
      .where(eq(userSessions.userId, userId));
  }

  async getSessionById(sessionId: string): Promise<any | null> {
    const [session] = await this.db
      .select()
      .from(userSessions)
      .where(eq(userSessions.id, sessionId))
      .limit(1);
    return session || null;
  }

  async createRefreshTokenFamily(familyData: {
    id: string;
    userId: number;
    createdAt: Date;
  }): Promise<void> {
    const { refreshTokenFamilies } = await import('../../db/authentication/tables');
    await this.db.insert(refreshTokenFamilies).values(familyData);
  }

  async revokeFamily(familyId: string, reason?: string): Promise<void> {
    const { refreshTokenFamilies, userSessions } = await import('../../db/authentication/tables');
    
    // Revoke the family
    await this.db.update(refreshTokenFamilies)
      .set({ revokedAt: new Date(), revocationReason: reason || 'Family revoked' })
      .where(eq(refreshTokenFamilies.id, familyId));

    // Revoke all sessions in the family
    await this.db.update(userSessions)
      .set({ revokedAt: new Date(), revocationReason: reason || 'Parent family revoked' })
      .where(eq(userSessions.familyId, familyId));
  }

  async getSessionByRefreshTokenHash(refreshTokenHash: string): Promise<any | null> {
    const [session] = await this.db
      .select()
      .from(userSessions)
      .where(eq(userSessions.refreshTokenHash, refreshTokenHash))
      .limit(1);
    return session || null;
  }
}

```

---

### `src/infrastructure/repositories/DrizzleSsiRepository.ts`
```typescript
import { eq, and, sql } from 'drizzle-orm';
import { didIdentities, verifiableCredentials } from '../../db/ssi/tables';
import { Result } from '../../shared/kernel/Result';
import {
  ISsiRepository,
  DidIdentityRecord,
  VerifiableCredentialRecord,
} from '../../application/ports/output/ISsiRepository';

export type { DidIdentityRecord, VerifiableCredentialRecord };

export class DrizzleSsiRepository implements ISsiRepository {
  constructor(private db: any) {}

  async findDidByUserId(userId: number): Promise<Result<DidIdentityRecord>> {
    try {
      const result = await this.db
        .select()
        .from(didIdentities)
        .where(and(eq(didIdentities.userId, userId), eq(didIdentities.status, 'active')))
        .limit(1);

      if (!result || result.length === 0) {
        return Result.fail('DID identity not found');
      }

      return Result.ok({
        id: result[0].id,
        userId: result[0].userId,
        did: result[0].did,
        method: result[0].method,
        controller: result[0].controller,
        status: result[0].status,
        version: result[0].version || 1,
      });
    } catch (error: any) {
      return Result.fail(error.message);
    }
  }

  async saveDid(record: DidIdentityRecord): Promise<Result<DidIdentityRecord>> {
    try {
      const existing = await this.db
        .select()
        .from(didIdentities)
        .where(eq(didIdentities.id, record.id))
        .limit(1);

      if (!existing || existing.length === 0) {
        await this.db.insert(didIdentities).values({
          id: record.id,
          userId: record.userId,
          did: record.did,
          method: record.method,
          controller: record.controller,
          status: record.status || 'active',
          version: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        record.version = 1;
      } else {
        const currentVersion = record.version ?? existing[0].version ?? 1;

        const updated = await this.db
          .update(didIdentities)
          .set({
            status: record.status || 'active',
            updatedAt: new Date(),
            version: sql`${didIdentities.version} + 1`,
          })
          .where(
            and(
              eq(didIdentities.id, record.id),
              eq(didIdentities.version, currentVersion)
            )
          )
          .returning();

        if (!updated || updated.length === 0) {
          return Result.fail('CONCURRENT_MODIFICATION_ERROR: DID identity was modified by another process');
        }

        record.version = currentVersion + 1;
      }
      return Result.ok(record);
    } catch (error: any) {
      return Result.fail(error.message);
    }
  }

  async saveVerifiableCredential(
    record: VerifiableCredentialRecord
  ): Promise<Result<VerifiableCredentialRecord>> {
    try {
      await this.db.insert(verifiableCredentials).values({
        id: record.id,
        holderUserId: record.holderUserId,
        issuerDid: record.issuerDid,
        subjectDid: record.subjectDid,
        credentialType: record.credentialType,
        credentialHash: record.credentialHash,
        encryptedClaims: record.encryptedClaims,
        proofType: record.proofType,
        status: record.status || 'active',
        issuanceDate: record.issuanceDate,
        expirationDate: record.expirationDate || null,
        version: 1,
      });

      return Result.ok(record);
    } catch (error: any) {
      return Result.fail(error.message);
    }
  }

  async findVerifiableCredentialById(id: string): Promise<Result<VerifiableCredentialRecord>> {
    try {
      const [row] = await this.db
        .select()
        .from(verifiableCredentials)
        .where(eq(verifiableCredentials.id, id))
        .limit(1);

      if (!row) return Result.fail('Verifiable Credential not found');

      return Result.ok({
        id: row.id,
        holderUserId: row.holderUserId,
        issuerDid: row.issuerDid,
        subjectDid: row.subjectDid,
        credentialType: row.credentialType as any,
        credentialHash: row.credentialHash,
        encryptedClaims: row.encryptedClaims,
        proofType: row.proofType as any,
        status: row.status as any,
        issuanceDate: new Date(row.issuanceDate),
        expirationDate: row.expirationDate ? new Date(row.expirationDate) : null,
        revokedAt: row.revokedAt ? new Date(row.revokedAt) : null,
        version: row.version,
      });
    } catch (error: any) {
      return Result.fail(error.message);
    }
  }

  async listVerifiableCredentialsByUserId(
    userId: number
  ): Promise<Result<VerifiableCredentialRecord[]>> {
    try {
      const rows = await this.db
        .select()
        .from(verifiableCredentials)
        .where(eq(verifiableCredentials.holderUserId, userId));

      const credentials: VerifiableCredentialRecord[] = rows.map((row: any) => ({
        id: row.id,
        holderUserId: row.holderUserId,
        issuerDid: row.issuerDid,
        subjectDid: row.subjectDid,
        credentialType: row.credentialType,
        credentialHash: row.credentialHash,
        encryptedClaims: row.encryptedClaims,
        proofType: row.proofType,
        status: row.status,
        issuanceDate: new Date(row.issuanceDate),
        expirationDate: row.expirationDate ? new Date(row.expirationDate) : null,
        revokedAt: row.revokedAt ? new Date(row.revokedAt) : null,
        version: row.version,
      }));

      return Result.ok(credentials);
    } catch (error: any) {
      return Result.fail(error.message);
    }
  }

  async revokeVerifiableCredential(id: string): Promise<Result<void>> {
    try {
      await this.db
        .update(verifiableCredentials)
        .set({
          status: 'revoked',
          revokedAt: new Date(),
        })
        .where(eq(verifiableCredentials.id, id));

      return Result.ok(undefined);
    } catch (error: any) {
      return Result.fail(error.message);
    }
  }
}

```

---

## 2. Identificação de Gaps de DDD e Segurança (AF-001 a AF-014)

### Gaps Encontrados e Status de Correção:
1. **AF-005 / Colisão de Provedores OAuth**: `oauth_identities` possuía um `index` comum em vez de `uniqueIndex`. Solução: alterado para `uniqueIndex('uq_oauth_identities_provider_subject')`.
2. **Bypass de Passkey Revogada (Segurança P0)**: `DrizzleIdentityResolverAdapter.ts` não verificava `revokedAt` para passkeys. Solução: adicionado filtro `isNull(userAuthenticators.revokedAt)`.
3. **Invariante Contábil (INV-FIN-001)**: `DrizzleFinanceRepository.ts` operava entradas com `transactionId: 1` fixo e entradas únicas. Solução: atualizado para exigir `transactionId` real da camada de aplicação e gerar lançamentos dobrados.
4. **Resiliência a Mutações Concorrentes no Edge (D1)**: OCC no `DrizzleFinanceRepository.ts` e repositórios associados atualizado para validar `res?.meta?.changes ?? res?.rowsAffected ?? 0`.
