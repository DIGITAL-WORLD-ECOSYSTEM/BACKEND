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
