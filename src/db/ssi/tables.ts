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
