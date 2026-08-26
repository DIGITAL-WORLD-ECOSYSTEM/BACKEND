import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

import { USER_STATUS } from '../constants';

/**
 * ============================================================================
 * USER / ACTOR — PERSISTENCE MODEL
 * ============================================================================
 *
 * Physical owner:
 *   src/db/user/
 *
 * Responsibility:
 *   Represents the internal account of the platform and data directly
 *   belonging to that account.
 *
 * This module DOES NOT own:
 *   - authentication credentials
 *   - sessions
 *   - Google/GitHub identities
 *   - wallet storage
 *   - wallet authentication
 *   - KYC processes
 *   - civil identity
 *   - DID/SSI
 *   - authorization / RBAC
 *   - security/audit history
 *
 * ----------------------------------------------------------------------------
 * IDENTITY MODEL
 * ----------------------------------------------------------------------------
 *
 * users.id
 *   = internal relational identity
 *
 * users.publicId
 *   = persisted public identity of the account
 *   = public representation derived from the INTERNAL wallet address
 *
 * wallets.address
 *   = technical source of truth for the internal blockchain identity
 *   = owned by src/db/web3/
 *
 * IMPORTANT:
 *   publicId is NOT:
 *   - a random UUID;
 *   - an account-creation identifier;
 *   - a KYC identifier;
 *   - a DID;
 *   - an external withdrawal-wallet identifier;
 *   - a blockchain-network identifier.
 *
 * publicId lifecycle:
 *
 *      account created
 *          ↓
 *      onboarding completed
 *          ↓
 *      KYC approved
 *          ↓
 *      user requests internal wallet
 *          ↓
 *      internal wallet created
 *          ↓
 *      wallet becomes ACTIVE
 *          ↓
 *      users.publicId = internal wallets.address
 *
 * publicId therefore represents the PUBLIC IDENTITY OF THE ACCOUNT,
 * while wallets.address remains the TECHNICAL SOURCE OF TRUTH for the
 * internal blockchain identity.
 *
 * Cross-table invariant:
 *
 *   users.publicId === active internal wallets.address
 *
 * This invariant is strictly enforced by application/domain lifecycle logic.
 * The database cannot physically prevent inconsistencies here.
 * It is intentionally NOT modeled as a direct foreign key because
 * users.id <-> wallets.userId remains the authoritative relational link.
 *
 * publicId rules:
 *   - NULL before the internal wallet is active;
 *   - assigned only after KYC approval and internal wallet activation;
 *   - never generated randomly by this table;
 *   - never assigned by a frontend client;
 *   - never assigned from an external withdrawal wallet;
 *   - never changed by profile updates;
 *   - never changed by password/authentication changes;
 *   - never changed by Google/GitHub linking;
 *   - never changed merely because the user changes email;
 *   - replacement is an exceptional identity-recovery operation.
 *
 * The internal wallet has ONE EVM address.
 * The chain/network context belongs to the blockchain operation itself.
 *
 * Therefore:
 *
 *   publicId
 *      = account public identity
 *
 *   wallets.address
 *      = technical wallet address
 *
 *   chainId / network
 *      = transaction execution context
 *
 * The user does not need to know the internal network topology.
 * The platform controls chain selection internally.
 *
 * ----------------------------------------------------------------------------
 * ACCOUNT / KYC DISTINCTION
 * ----------------------------------------------------------------------------
 *
 * users.status
 *   = lifecycle/security state of the account
 *
 * kycVerifications.status
 *   = lifecycle state of an individual KYC process
 *
 * These concepts are NOT interchangeable.
 *
 * Examples:
 *
 *   kycVerifications.status = rejected
 *      DOES NOT imply:
 *      users.status = suspended
 *
 *   KYC rejection may simply require a new KYC submission.
 *
 * Account suspension is an explicit security/administrative decision
 * and is not automatically derived from ordinary KYC rejection.
 *
 * ----------------------------------------------------------------------------
 * EMAIL / INITIAL LOGIN
 * ----------------------------------------------------------------------------
 *
 * users.email
 *   = primary account contact
 *   = initial login identifier for the account
 *
 * users.emailNormalized
 *   = canonical lookup key
 *   = uniqueness key
 *   = authoritative lookup field for initial email login
 *
 * Authentication credentials belong to:
 *   src/db/authentication/
 *
 * USER persists the identity used for login.
 * AUTHENTICATION persists the proof/control mechanism.
 *
 * ----------------------------------------------------------------------------
 * WALLET POLICY
 * ----------------------------------------------------------------------------
 *
 * The internal wallet is NOT an account-creation mechanism.
 *
 * Initial account creation happens before the internal wallet.
 *
 * Google / GitHub / Wallet authentication identities:
 *   - do not own the internal account;
 *   - must resolve to an existing users.id when linking/authenticating;
 *   - must not silently create duplicate internal accounts.
 *
 * IMPORTANT:
 *   Wallet authentication is available only after the account exists
 *   and wallet linking/creation has been explicitly established.
 *
 * External withdrawal wallets:
 *   - are NOT owned by USER;
 *   - do NOT define users.publicId;
 *   - do NOT replace the internal wallet;
 *   - belong to the Web3/financial operation model.
 *
 * ----------------------------------------------------------------------------
 * SUBJECT TYPE GOVERNANCE
 * ----------------------------------------------------------------------------
 *
 * human:
 *   normal individual/citizen account.
 *
 * service:
 *   controlled application/service/agent account.
 *
 * system:
 *   technical system account.
 *
 * Creation policy:
 *   - human may follow the normal registration lifecycle;
 *   - service creation must be controlled by application/administrative flow;
 *   - system accounts must be controlled by bootstrap/internal operations.
 *
 * These governance rules belong to application/domain layers rather than
 * database CHECK constraints.
 *
 * ----------------------------------------------------------------------------
 * PUBLIC IDENTITY REVOCATION / REPLACEMENT
 * ----------------------------------------------------------------------------
 *
 * If the internal wallet is revoked for an exceptional security reason
 * (for example, confirmed credential compromise), the old public identity
 * must NOT be casually reused or overwritten.
 *
 * The replacement policy is:
 *
 *   old internal wallet
 *       ↓
 *   revoked
 *       ↓
 *   historical identity preserved
 *       ↓
 *   new internal wallet
 *       ↓
 *   new public identity assigned
 *
 * The historical association is maintained outside this base USER table
 * through the Web3 identity/lifecycle model and audit trail.
 *
 * Normal profile, email, password, Google/GitHub or ordinary administrative
 * changes must never rotate publicId.
 *
 * ============================================================================
 */

// ============================================================================
// 10. USER / ACTOR — ROOT ACCOUNT
// ============================================================================

/**
 * Entity: users
 *
 * Root relational representation of an internal platform account.
 */
export const users = sqliteTable(
  'users',
  {
    // ------------------------------------------------------------------------
    // INTERNAL IDENTITY
    // ------------------------------------------------------------------------

    /**
     * Internal relational identity.
     *
     * Used by foreign keys throughout the database.
     * Must not be exposed as the public identity of the account.
     */
    id: integer('id').primaryKey({ autoIncrement: true }),

    /**
     * Public blockchain identity of the account.
     *
     * NULL:
     *   Account has not yet received an ACTIVE internal wallet.
     *
     * NON-NULL:
     *   Must equal the address of the account's ACTIVE internal wallet.
     *
     * Source of technical truth:
     *   web3.wallets.address
     *
     * This column is a persisted public identity representation for USER.
     * It is deliberately nullable during the account lifecycle.
     *
     * Never:
     *   - generate randomly;
     *   - accept arbitrary client-provided assignment;
     *   - assign from an external withdrawal wallet;
     *   - change during ordinary profile/authentication updates.
     */
    publicId: text('public_id').unique(),

    /**
     * Defines the nature of the account subject.
     *
     * human:
     *   normal citizen / individual account
     *
     * service:
     *   application service / agent account
     *
     * system:
     *   technical system account
     */
    subjectType: text('subject_type', {
      enum: ['human', 'service', 'system'],
    })
      .notNull()
      .default('human'),

    // ------------------------------------------------------------------------
    // PRIMARY ACCOUNT CONTACT / INITIAL LOGIN IDENTIFIER
    // ------------------------------------------------------------------------

    /**
     * Primary email of the account.
     *
     * USER owns the account contact identity.
     * AUTHENTICATION owns the credential used to prove control of it.
     *
     * For normal human registration flows this is the initial login
     * identifier.
     *
     * Nullable because controlled service/system accounts may follow
     * different provisioning rules.
     */
    email: text('email'),

    /**
     * Canonical representation used for:
     *   - account lookup;
     *   - uniqueness;
     *   - initial email login resolution.
     *
     * The normalization algorithm itself belongs to the application layer.
     */
    emailNormalized: text('email_normalized'),

    /**
     * Timestamp at which the current primary email was verified.
     *
     * If non-null, email must exist.
     */
    emailVerifiedAt: integer('email_verified_at', { mode: 'timestamp' }),

    /**
     * Timestamp of the last primary email change.
     *
     * If non-null, email must exist.
     */
    emailChangedAt: integer('email_changed_at', { mode: 'timestamp' }),

    // ------------------------------------------------------------------------
    // ACCOUNT SECURITY / LIFECYCLE STATE
    // ------------------------------------------------------------------------

    /**
     * Global authentication epoch.
     *
     * Incremented by authentication/security flows when all existing
     * sessions must be invalidated.
     *
     * USER stores the account state.
     * AUTHENTICATION owns actual session invalidation.
     *
     * Invariant:
     *   authEpoch must be monotonic and never decrease.
     */
    authEpoch: integer('auth_epoch').default(1).notNull(),

    /**
     * Lifecycle state of the account itself.
     *
     * This is NOT the KYC status.
     */
    status: text('status', {
      enum: USER_STATUS,
    })
      .default('pending_setup')
      .notNull(),

    failedLoginAttempts: integer('failed_login_attempts').default(0).notNull(),
    lastFailedLoginAt: integer('last_failed_login_at', { mode: 'timestamp' }),

    /**
     * Timestamp when account status last changed.
     *
     * Application invariant:
     *   statusChangedAt = NULL only if no transition has occurred since creation.
     *   It must be updated whenever status changes.
     */
    statusChangedAt: integer('status_changed_at', { mode: 'timestamp' }),

    /**
     * Historical timestamp associated with account locking.
     *
     * Application invariant:
     *   lockedAt != null means the account has historically been locked.
     *   It does NOT necessarily represent the current active state.
     *   Current state is strictly governed by the `status` column.
     */
    lockedAt: integer('locked_at', { mode: 'timestamp' }),

    /**
     * Historical timestamp associated with account disabling.
     *
     * Application invariant:
     *   disabledAt != null means the account has historically been disabled.
     *   It does NOT necessarily represent the current active state.
     *   Current state is strictly governed by the `status` column.
     */
    disabledAt: integer('disabled_at', { mode: 'timestamp' }),

    /**
     * Soft-delete timestamp.
     *
     * NULL means the account is not soft-deleted.
     *
     * Soft-delete semantics are intentionally kept at the application
     * lifecycle layer rather than inferred automatically from status.
     */
    deletedAt: integer('deleted_at', { mode: 'timestamp' }),

    // ------------------------------------------------------------------------
    // AUDITABLE TIMESTAMPS
    // ------------------------------------------------------------------------

    createdAt: integer('created_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull(),

    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (table) => ({
    // ----------------------------------------------------------------------
    // PERFORMANCE INDEXES
    // ----------------------------------------------------------------------

    statusIdx: index('idx_users_status').on(table.status),

    /**
     * Supports queries filtering active/non-deleted accounts.
     */
    activeActorIdx: index('idx_users_active_actor').on(
      table.status,
      table.deletedAt
    ),

    /**
     * Prevents duplicate active account emails while allowing soft-deleted account email reuse.
     */
    activeEmailNormalizedUnq: uniqueIndex('uq_users_active_email_normalized')
      .on(table.emailNormalized)
      .where(sql`${table.deletedAt} IS NULL`),

    // ----------------------------------------------------------------------
    // DOMAIN / DATA-INTEGRITY CHECKS
    // ----------------------------------------------------------------------

    /**
     * Protects the account subject type even if the ORM is bypassed.
     */
    subjectTypeCheck: check(
      'users_subject_type_check',
      sql`${table.subjectType} IN ('human', 'service', 'system')`
    ),

    /**
     * Protects the account lifecycle state at database level.
     */
    statusCheck: check(
      'users_status_check',
      sql`${table.status} IN ('pending_setup', 'active', 'suspended', 'locked', 'disabled')`
    ),

    /**
     * authEpoch must always be a valid positive version.
     */
    authEpochCheck: check(
      'users_auth_epoch_check',
      sql`${table.authEpoch} >= 1`
    ),

    /**
     * email and emailNormalized must either both exist or both be NULL.
     *
     * Valid:
     *   email = NULL
     *   emailNormalized = NULL
     *
     * or:
     *   email != NULL
     *   emailNormalized != NULL
     *
     * Invalid:
     *   email != NULL
     *   emailNormalized = NULL
     *
     * Invalid:
     *   email = NULL
     *   emailNormalized != NULL
     */
    emailNormalizationCheck: check(
      'users_email_normalization_check',
      sql`(
        ${table.email} IS NULL AND ${table.emailNormalized} IS NULL
      ) OR (
        ${table.email} IS NOT NULL AND ${table.emailNormalized} IS NOT NULL
      )`
    ),

    /**
     * A verified email cannot exist without an email address.
     */
    emailVerificationCheck: check(
      'users_email_verification_check',
      sql`${table.emailVerifiedAt} IS NULL OR ${table.email} IS NOT NULL`
    ),

    /**
     * An email-change timestamp cannot exist without an email address.
     */
    emailChangedCheck: check(
      'users_email_changed_check',
      sql`${table.emailChangedAt} IS NULL OR ${table.email} IS NOT NULL`
    ),
  })
);

// ============================================================================
// 10.1 USER PROFILE
// ============================================================================

/**
 * Entity: userProfiles
 *
 * Presentation/public-profile information.
 *
 * Does NOT contain:
 *   - KYC/PII legal identity
 *   - credentials
 *   - roles
 *   - wallet information
 *   - audit information
 *
 * Username normalization:
 *   usernameNormalized is the authoritative uniqueness key.
 *   The normalization algorithm belongs to the application/domain layer.
 */
export const userProfiles = sqliteTable(
  'user_profiles',
  {
    /**
     * 1:1 relationship with users.
     */
    userId: integer('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),

    /**
     * Public profile username.
     *
     * Minimum structural validation occurs in the database.
     * Complete username policy is application/domain responsibility.
     */
    username: text('username').notNull(),

    /**
     * Canonical username used for lookup/uniqueness.
     */
    usernameNormalized: text('username_normalized').notNull(),

    displayName: text('display_name'),
    avatarUrl: text('avatar_url'),
    website: text('website'),
    about: text('about'),

    profileVisibility: text('profile_visibility', {
      enum: ['public', 'members', 'private'],
    })
      .notNull()
      .default('private'),

    isDiscoverable: integer('is_discoverable', {
      mode: 'boolean',
    })
      .notNull()
      .default(false),

    /**
     * Soft-delete timestamp.
     *
     * APPLICATION INVARIANT:
     *   Must be updated atomically in the same transaction/use-case as parent
     *   `users.deletedAt` to ensure username release and active profile index alignment.
     */
    deletedAt: integer('deleted_at', { mode: 'timestamp' }),

    createdAt: integer('created_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull(),

    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (table) => ({
    /**
     * Prevents duplicate active usernames while allowing soft-deleted account username reuse.
     */
    activeUsernameNormalizedUnq: uniqueIndex(
      'uq_user_profiles_active_username_normalized'
    )
      .on(table.usernameNormalized)
      .where(sql`${table.deletedAt} IS NULL`),

    /**
     * Basic database-level structural constraint.
     *
     * Full username rules belong to application/domain validation.
     */
    usernameCheck: check(
      'username_format_check',
      sql`length(${table.username}) >= 3`
    ),

    profileVisibilityCheck: check(
      'user_profiles_visibility_check',
      sql`${table.profileVisibility} IN ('public', 'members', 'private')`
    ),
  })
);

// ============================================================================
// 10.2 USER CONTACTS
// ============================================================================

/**
 * Entity: userContacts
 *
 * Secondary communication channels.
 *
 * Important:
 *   users.email remains the account's primary account/login identity.
 *   userContacts.isPrimary merely indicates the preferred contact inside the
 *   secondary contacts collection. It does NOT replace users.email.
 *
 * Secondary email:
 *   A secondary_email must never silently become the account's primary
 *   login identity.
 */
export const userContacts = sqliteTable(
  'user_contacts',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),

    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    type: text('type', {
      enum: ['phone', 'mobile', 'whatsapp', 'secondary_email'],
    }).notNull(),

    /**
     * Human/display representation.
     */
    value: text('value').notNull(),

    /**
     * Canonical searchable representation.
     *
     * Normalization rules belong to application/domain validation.
     */
    normalizedValue: text('normalized_value').notNull(),

    verificationMethod: text('verification_method', {
      enum: ['sms', 'whatsapp', 'email', 'admin', 'import'],
    }),

    verifiedAt: integer('verified_at', { mode: 'timestamp' }),

    isPrimary: integer('is_primary', { mode: 'boolean' })
      .notNull()
      .default(false),

    createdAt: integer('created_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull(),

    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (table) => ({
    userIdx: index('idx_user_contacts_user').on(table.userId),

    /**
     * Prevents the exact same normalized contact/type from being registered
     * more than once across the system.
     */
    normalizedUnq: uniqueIndex('uq_user_contacts_normalized').on(
      table.type,
      table.normalizedValue
    ),

    /**
     * INVARIANT: Exactly one primary contact per user, independently of the contact type.
     *
     * This is intentionally global across all contact types.
     */
    primaryUnq: uniqueIndex('uq_user_contacts_primary')
      .on(table.userId)
      .where(sql`${table.isPrimary} = true`),

    typeCheck: check(
      'user_contacts_type_check',
      sql`${table.type} IN ('phone', 'mobile', 'whatsapp', 'secondary_email')`
    ),

    verificationMethodCheck: check(
      'user_contacts_verification_method_check',
      sql`${table.verificationMethod} IS NULL OR ${table.verificationMethod} IN ('sms', 'whatsapp', 'email', 'admin', 'import')`
    ),

    /**
     * A contact cannot be marked as verified without a verification method.
     */
    verifiedAtCheck: check(
      'user_contacts_verified_at_check',
      sql`${table.verifiedAt} IS NULL OR ${table.verificationMethod} IS NOT NULL`
    ),
  })
);

// ============================================================================
// 10.3 USER ADDRESSES
// ============================================================================

/**
 * Entity: userAddresses
 *
 * Physical addresses belonging to the account.
 *
 * These are personal addresses only.
 * Real-estate properties belong to src/db/real-estate/.
 *
 * A street is required for the current physical-address model.
 * Domain-specific address validation belongs to application/domain layers.
 */
export const userAddresses = sqliteTable(
  'user_addresses',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),

    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    type: text('type', {
      enum: ['residential', 'commercial', 'billing', 'shipping'],
    }).notNull(),

    country: text('country').default('BR').notNull(),

    state: text('state').notNull(),
    city: text('city').notNull(),
    neighborhood: text('neighborhood'),
    street: text('street').notNull(),
    number: text('number'),
    complement: text('complement'),
    zipCode: text('zip_code').notNull(),

    isPrimary: integer('is_primary', { mode: 'boolean' })
      .notNull()
      .default(false),

    createdAt: integer('created_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull(),

    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (table) => ({
    userIdx: index('idx_user_addresses_user').on(table.userId),

    /**
     * INVARIANT: Exactly ONE primary address per user PER TYPE.
     *
     * Example:
     *   one primary residential
     *   one primary billing
     *   one primary shipping
     *   one primary commercial
     */
    primaryUnq: uniqueIndex('uq_user_addresses_primary')
      .on(table.userId, table.type)
      .where(sql`${table.isPrimary} = true`),

    typeCheck: check(
      'user_addresses_type_check',
      sql`${table.type} IN ('residential', 'commercial', 'billing', 'shipping')`
    ),
  })
);

// ============================================================================
// 10.4 USER PROFESSIONAL EXPERIENCE
// ============================================================================

/**
 * Entity: userProfessionalExperience
 *
 * Professional history of the user.
 *
 * organizationId is optional because the organization may exist outside
 * the DAO registry.
 *
 * When organizationId is present:
 *   organizations is the authoritative internal reference.
 *
 * When organizationId is NULL:
 *   companyName contains the external organization snapshot/name.
 */
export const userProfessionalExperience = sqliteTable(
  'user_professional_experience',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),

    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    organizationId: integer('organization_id'),

    companyName: text('company_name'),

    role: text('role').notNull(),
    description: text('description'),

    /**
     * Date-only values.
     *
     * Expected application format:
     *   YYYY-MM-DD
     *
     * Exact ISO date-format validation remains an application/domain rule.
     */
    startDate: text('start_date'),
    endDate: text('end_date'),

    verifiedAt: integer('verified_at', { mode: 'timestamp' }),

    createdAt: integer('created_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull(),
  },
  (table) => ({
    userIdx: index('idx_professional_exp_user').on(table.userId),

    /**
     * Prevents an inverted range when an end date exists.
     */
    dateOrderCheck: check(
      'user_professional_experience_date_order_check',
      sql`${table.endDate} IS NULL OR ${table.startDate} IS NULL OR ${table.endDate} >= ${table.startDate}`
    ),

    /**
     * Ensures that professional experience is linked either to an internal
     * organization or contains an external snapshot name.
     */
    organizationOrNameCheck: check(
      'user_professional_experience_organization_check',
      sql`${table.organizationId} IS NOT NULL OR ${table.companyName} IS NOT NULL`
    ),
  })
);

// ============================================================================
// 10.5 USER EDUCATION
// ============================================================================

/**
 * Entity: userEducation
 *
 * Academic / educational history.
 *
 * When organizationId is present:
 *   organizations is the authoritative internal reference.
 *
 * When organizationId is NULL:
 *   institutionName contains the external institution snapshot/name.
 */
export const userEducation = sqliteTable(
  'user_education',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),

    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    organizationId: integer('organization_id'),

    institutionName: text('institution_name'),

    degree: text('degree').notNull(),
    field: text('field'),
    level: text('level'),

    /**
     * Date-only values.
     *
     * Expected application format:
     *   YYYY-MM-DD
     *
     * Exact ISO date-format validation remains an application/domain rule.
     */
    startDate: text('start_date'),
    endDate: text('end_date'),

    verifiedAt: integer('verified_at', { mode: 'timestamp' }),

    createdAt: integer('created_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull(),
  },
  (table) => ({
    userIdx: index('idx_education_user').on(table.userId),

    dateOrderCheck: check(
      'user_education_date_order_check',
      sql`${table.endDate} IS NULL OR ${table.startDate} IS NULL OR ${table.endDate} >= ${table.startDate}`
    ),

    /**
     * Ensures that education is linked either to an internal
     * organization or contains an external institution snapshot name.
     */
    organizationOrNameCheck: check(
      'user_education_organization_check',
      sql`${table.organizationId} IS NOT NULL OR ${table.institutionName} IS NOT NULL`
    ),
  })
);

// ============================================================================
// 10.6 MEMBERSHIP CARDS
// ============================================================================

/**
 * Entity: membershipCards
 *
 * DAO membership credential.
 *
 * It is NOT:
 *   - authentication credential
 *   - RBAC role
 *   - KYC document
 *   - blockchain wallet
 *
 * Lifecycle:
 *   A user may retain historical revoked/expired cards.
 *   At most ONE card may be ACTIVE at any moment for a given user.
 *
 * Important Invariant:
 *   `status = 'active'` and `expiryDate < now` can physically coexist in the database.
 *   The transition to 'expired' belongs strictly to the application lifecycle,
 *   and is not enforced by a database CHECK constraint.
 */
export const membershipCards = sqliteTable(
  'membership_cards',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),

    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    /**
     * Hash used for offline verification.
     *
     * No redundant uniqueIndex is required because .unique()
     * already creates the uniqueness constraint/index.
     */
    cardHash: text('card_hash').notNull().unique(),

    tier: text('tier', {
      enum: ['citizen', 'partner', 'founder', 'honorary'],
    })
      .notNull()
      .default('citizen'),

    issueDate: integer('issue_date', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull(),

    expiryDate: integer('expiry_date', { mode: 'timestamp' }),

    qrCodeUrl: text('qr_code_url'),

    status: text('status', {
      enum: ['active', 'expired', 'revoked'],
    })
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
    userIdx: index('idx_cards_user').on(table.userId),

    /**
     * A user may have historical cards, but only one active card.
     */
    activeUserCardUnique: uniqueIndex('uq_membership_cards_active_user')
      .on(table.userId)
      .where(sql`${table.status} = 'active'`),

    tierCheck: check(
      'membership_cards_tier_check',
      sql`${table.tier} IN ('citizen', 'partner', 'founder', 'honorary')`
    ),

    statusCheck: check(
      'membership_cards_status_check',
      sql`${table.status} IN ('active', 'expired', 'revoked')`
    ),

    expiryOrderCheck: check(
      'membership_cards_expiry_order_check',
      sql`${table.expiryDate} IS NULL OR ${table.expiryDate} > ${table.issueDate}`
    ),
  })
);

// ============================================================================
// 10.7 USER NOTIFICATION SETTINGS
// ============================================================================

/**
 * Entity: userNotificationSettings
 *
 * Stores personal communication preferences only.
 *
 * It does NOT define:
 *   - which events exist;
 *   - when an event is generated;
 *   - how notifications are delivered;
 *   - email/chat transport.
 *
 * Those responsibilities belong to COMMUNICATION.
 *
 * Preference keys:
 *   The `type` column is intentionally extensible.
 *   The authoritative catalog of valid preference keys belongs to the
 *   application/communication layer rather than being hard-coded here.
 */
export const userNotificationSettings = sqliteTable(
  'user_notification_settings',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),

    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    /**
     * Extensible preference key.
     *
     * Examples:
     *   activity_comments
     *   application_news
     *   governance_updates
     *
     * The canonical preference catalog is defined outside persistence.
     */
    type: text('type').notNull(),

    enabled: integer('enabled', { mode: 'boolean' })
      .default(true)
      .notNull(),

    createdAt: integer('created_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull(),

    /**
     * Updated whenever the preference changes.
     *
     * Useful for synchronization, audit correlation and future
     * multi-device settings reconciliation.
     */
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (table) => ({
    userTypeUnique: uniqueIndex('uq_user_notification_settings_type').on(
      table.userId,
      table.type
    ),
  })
);

/**
 * ============================================================================
 * USER EXTERNAL IDENTITIES (OAuth / Social Identity Bindings)
 * ============================================================================
 * Conceptual owner: Identity Core (src/domains/identity/external-identities/)
 *
 * Restrição Constitucional (AF-005):
 * UNIQUE(provider, provider_subject_id)
 */
export const userExternalIdentities = sqliteTable(
  'user_external_identities',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),

    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    provider: text('provider').notNull(),

    providerSubjectId: text('provider_subject_id').notNull(),

    emailAtBinding: text('email_at_binding'),

    createdAt: integer('created_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull(),
  },
  (table) => ({
    providerSubjectUnique: uniqueIndex('uq_user_external_identities_provider_subject').on(
      table.provider,
      table.providerSubjectId
    ),
    userIdIdx: index('idx_user_external_identities_user_id').on(table.userId),
  })
);

