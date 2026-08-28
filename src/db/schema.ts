/**
 * DATABASE SCHEMA AGGREGATOR
 *
 * Project: Governance System (ASPPIBRA DAO)
 * ORM: Drizzle ORM
 * Database: SQLite / Cloudflare D1
 *
 * PURPOSE
 * -------
 * This file is the central composition point of the Drizzle schema.
 *
 * It:
 *   - re-exports domain tables;
 *   - re-exports domain relations;
 *   - exposes schema constants;
 *   - preserves compatibility with existing consumers;
 *   - registers the complete schema surface for Drizzle Query API.
 *
 * ARCHITECTURAL ROLE
 * ------------------
 * This file is an AGGREGATOR.
 *
 * It is NOT:
 *   - a domain;
 *   - a business-rule layer;
 *   - a repository;
 *   - a service;
 *   - an application use case.
 *
 * DATABASE OWNERSHIP RULE
 * -----------------------
 * Each physical table belongs to exactly one persistence domain below.
 *
 * Infrastructure/application code SHOULD import tables directly from
 * their owning domain module whenever practical.
 *
 * Prefer:
 *
 *   import { users } from '@/db/user/tables';
 *
 * over:
 *
 *   import { users } from '@/db/schema';
 *
 * The schema aggregator remains valid for:
 *   - Drizzle schema composition;
 *   - Database Factory registration;
 *   - Query API registration;
 *   - compatibility with legacy consumers during migration.
 *
 * IMPORTANT
 * ---------
 * The numeric prefixes below describe documentation order only.
 * They DO NOT establish application dependency priority.
 *
 * Actual dependencies must be inferred from:
 *   1. Foreign Keys;
 *   2. Drizzle relations();
 *   3. Application-layer imports;
 *   4. Domain events;
 *   5. Explicit logical references.
 *
 * SOURCE OF TRUTH
 * ---------------
 * The table lists below represent the CURRENT PHYSICAL DATABASE SCHEMA.
 *
 * Do NOT add future/planned entities to this document until they
 * physically exist in the corresponding tables.ts file.
 */

/**
 * ======================================================================
 * PERSISTENCE DOMAIN DEPENDENCY MAP
 * ======================================================================
 *
 * Terminology:
 *
 * Depends on:
 *   A physical FK or declared persistence dependency.
 *
 * References:
 *   A logical/application reference that does not necessarily represent
 *   a physical FK.
 *
 * Cross-cutting:
 *   Infrastructure used by multiple domains rather than owned by a
 *   single business domain.
 */

/**
 * ======================================================================
 * 10. USER / ACTOR
 * ======================================================================
 *
 * Role:
 *   Base actor/account identity persistence.
 *
 * Persistence owner:
 *   user
 *
 * Tables:
 *   - users
 *   - userProfiles
 *   - userContacts
 *   - userAddresses
 *   - userProfessionalExperience
 *   - userEducation
 *   - membershipCards
 *   - userNotificationSettings
 *
 * Depends on:
 *   - None at persistence FK level for the aggregate root "users".
 *   - organizations (optional reference via userProfessionalExperience.organizationId and userEducation.organizationId).
 *
 * Prohibited Dependencies (Section 05 Boundary Matrix):
 *   - web3
 *   - civil-identity
 *   - ssi
 *   - finance
 *
 * Referenced by:
 *   - authentication
 *   - authorization
 *   - civil-identity
 *   - ssi
 *   - organizations
 *   - web3
 *   - social
 *   - communication
 *   - governance
 *   - contributions
 *   - contracts
 *   - finance
 *   - real-estate
 *   - integrations
 *   - compliance
 *   - security
 *
 * Architectural rule:
 *   "users" is the base actor identity and should not become a
 *   container for unrelated business concepts.
 */

/**
 * ======================================================================
 * 20. AUTHENTICATION
 * ======================================================================
 *
 * Role:
 *   Authentication credentials, authentication challenges and sessions.
 *
 * Persistence owner:
 *   authentication
 *
 * Tables:
 *   - userAuthenticators
 *   - passwordCredentials
 *   - webauthnCredentials
 *   - totpCredentials
 *   - recoverySets
 *   - recoveryCredentials
 *   - passwordResets
 *   - userSessions
 *   - authChallenges
 *   - walletAuthenticators
 *
 * Depends on:
 *   - USER / ACTOR
 *
 * References:
 *   - WEB3 IDENTITY through walletAuthenticators -> wallets
 *
 * Cross-cutting concerns:
 *   - SECURITY / AUDIT events
 *
 * Architectural rule:
 *   Authentication mechanisms belong here.
 *   Wallets themselves do NOT belong here; only wallet-based
 *   authentication belongs here.
 */

/**
 * ======================================================================
 * 30. AUTHORIZATION
 * ======================================================================
 *
 * Role:
 *   Role-based authorization and role assignments.
 *
 * Persistence owner:
 *   authorization
 *
 * Tables:
 *   - roles
 *   - userRoles
 *
 * Depends on:
 *   - USER / ACTOR
 *
 * References:
 *   - None beyond the explicit user/role relationships currently
 *     represented in the schema.
 *
 * Architectural rule:
 *   Authorization data must not be inferred from users.status or from
 *   legacy "primary role" fields.
 *   userRoles is the source for role assignment persistence.
 *
 * NOTE:
 *   No permissions or rolePermissions tables are declared here because
 *   they are not part of the current physical schema.
 */

/**
 * ======================================================================
 * 40. CIVIL IDENTITY / KYC
 * ======================================================================
 *
 * Role:
 *   Civil identity and KYC verification persistence.
 *
 * Persistence owner:
 *   civil-identity
 *
 * Tables:
 *   - citizens
 *   - identityDocuments
 *   - kycVerifications
 *
 * Depends on:
 *   - USER / ACTOR
 *
 * References:
 *   - None beyond the explicit user relationships currently declared.
 *
 * Important semantic distinction:
 *
 *   citizens.civilStatus
 *     = state of the civil identity/account identity.
 *
 *   kycVerifications.status
 *     = state of an individual KYC verification process.
 *
 * These states are NOT interchangeable.
 *
 * Architectural rule:
 *   KYC verification is not the same concept as account suspension.
 */

/**
 * ======================================================================
 * 50. SSI / DIGITAL IDENTITY
 * ======================================================================
 *
 * Role:
 *   Self-Sovereign Identity and secure digital identity material.
 *
 * Persistence owner:
 *   ssi
 *
 * Tables:
 *   - secureVaults
 *   - didIdentities
 *   - didVerificationMethods
 *
 * Depends on:
 *   - USER / ACTOR
 *
 * References:
 *   - None beyond the current physical FK relationships.
 *
 * Architectural rule:
 *   This domain stores digital identity material and DID structures.
 *   It must not silently become a replacement for the civil identity
 *   or authentication domains.
 */

/**
 * ======================================================================
 * 60. ORGANIZATIONS
 * ======================================================================
 *
 * Role:
 *   Organizations, memberships and mandates.
 *
 * Persistence owner:
 *   organizations
 *
 * Tables:
 *   - organizations
 *   - organizationMemberships
 *   - mandates
 *
 * Depends on:
 *   - USER / ACTOR
 *   - CIVIL IDENTITY / KYC through mandates.appointmentDocumentId
 *
 * Referenced by:
 *   - USER / ACTOR (optional reference via userProfessionalExperience.organizationId and userEducation.organizationId)
 *
 * References:
 *   - identityDocuments through the appointment document relationship.
 *
 * Architectural rule:
 *   Organization membership and organizational mandates are different
 *   concepts and should not be collapsed into users or roles.
 */

/**
 * ======================================================================
 * 70. WEB3 IDENTITY
 * ======================================================================
 *
 * Role:
 *   Blockchain wallet identity and wallet ownership.
 *
 * Persistence owner:
 *   web3
 *
 * Tables:
 *   - wallets
 *
 * Depends on:
 *   - USER / ACTOR
 *
 * Referenced by:
 *   - AUTHENTICATION through walletAuthenticators
 *   - SECURITY / AUDIT through securityEvents.walletId
 *   - REAL ESTATE / RWA logically and through blockchain-related data
 *
 * Architectural rule:
 *   wallets represents Web3 identity.
 *   walletAuthenticators represents authentication using a wallet and
 *   therefore belongs to AUTHENTICATION.
 */

/**
 * ======================================================================
 * 80. SOCIAL
 * ======================================================================
 *
 * Role:
 *   Social identity, publishing and social interactions.
 *
 * Persistence owner:
 *   social
 *
 * Tables:
 *   - userSocialLinks
 *   - posts
 *   - postComments
 *   - postFavorites
 *
 * Depends on:
 *   - USER / ACTOR
 *
 * Internal relationships:
 *   - postComments -> posts
 *   - postFavorites -> posts
 *
 * Architectural rule:
 *   Social content remains separate from the core user identity.
 */

/**
 * ======================================================================
 * 90. COMMUNICATION
 * ======================================================================
 *
 * Role:
 *   Omnichannel communication persistence.
 *
 * Persistence owner:
 *   communication
 *
 * Tables:
 *   Notifications:
 *   - notifications
 *
 *   Email:
 *   - emailAccounts
 *   - emailThreads
 *   - emailLabels
 *   - emails
 *   - emailMessageLabels
 *   - emailAttachments
 *   - emailEvents
 *
 *   Chat:
 *   - chatConversations
 *   - chatParticipants
 *   - chatMessages
 *   - chatAttachments
 *   - chatReadReceipts
 *   - chatEvents
 *
 * Depends on:
 *   - USER / ACTOR
 *
 * Internal relationships:
 *   - emailThreads -> emailAccounts
 *   - emailLabels -> emailAccounts
 *   - emails -> emailAccounts
 *   - emails -> emailThreads
 *   - emailMessageLabels -> emails
 *   - emailMessageLabels -> emailLabels
 *   - emailAttachments -> emails
 *   - emailEvents -> emails
 *   - chatParticipants -> chatConversations
 *   - chatMessages -> chatConversations
 *   - chatAttachments -> chatMessages
 *   - chatReadReceipts -> chatMessages
 *   - chatEvents -> chatConversations
 *
 * Architectural rule:
 *   Email, Chat and Notifications are communication concerns.
 *   They should not become hidden storage layers for unrelated
 *   business domains.
 */

/**
 * ======================================================================
 * 100. GOVERNANCE
 * ======================================================================
 *
 * Role:
 *   DAO governance proposals and voting.
 *
 * Persistence owner:
 *   governance
 *
 * Tables:
 *   - govProposals
 *   - govVotes
 *
 * Depends on:
 *   - USER / ACTOR
 *
 * Internal relationships:
 *   - govVotes -> govProposals
 *
 * References:
 *   - ORGANIZATIONS may be an application-level reference when
 *     governance is scoped to an organization, but no corresponding
 *     Organization FK is currently defined in these tables.
 *
 * Architectural rule:
 *   Do not document future delegation/voting-strategy tables here until
 *   they physically exist.
 */

/**
 * ======================================================================
 * 110. CONTRIBUTIONS
 * ======================================================================
 *
 * Role:
 *   Contribution and bounty persistence.
 *
 * Persistence owner:
 *   contributions
 *
 * Tables:
 *   - bounties
 *
 * Depends on:
 *   - USER / ACTOR
 *
 * Internal relationships:
 *   - bounties.creatorId -> users
 *   - bounties.assigneeId -> users
 *
 * Architectural rule:
 *   Current physical persistence is intentionally minimal.
 *   Do not infer task-management tables that are not physically present.
 */

/**
 * ======================================================================
 * 120. CONTRACTS / OBLIGATIONS
 * ======================================================================
 *
 * Role:
 *   Contract and payment-obligation persistence.
 *
 * Persistence owner:
 *   contracts
 *
 * Tables:
 *   - contracts
 *
 * Depends on:
 *   - USER / ACTOR
 *
 * Architectural rule:
 *   A contract is a business/legal obligation.
 *   It must remain conceptually distinct from individual treasury
 *   transactions.
 */

/**
 * ======================================================================
 * 130. FINANCE / TREASURY
 * ======================================================================
 *
 * Role:
 *   Treasury transaction ledger.
 *
 * Persistence owner:
 *   finance
 *
 * Tables:
 *   - treasuryLedger
 *
 * Depends on:
 *   - USER / ACTOR
 *
 * References:
 *   - REAL ESTATE / RWA may generate financial events logically.
 *   - WEB3 IDENTITY may provide blockchain transaction context logically.
 *
 * Architectural rule:
 *   wallets is NOT owned by finance.
 *   The physical owner of wallets is WEB3 IDENTITY.
 */

/**
 * ======================================================================
 * 140. REAL ESTATE / RWA
 * ======================================================================
 *
 * Role:
 *   Real-estate asset registration, documentation, workflow and
 *   blockchain/RWA persistence.
 *
 * Persistence owner:
 *   real-estate
 *
 * Tables:
 *   - reProperties
 *   - rePropertyLocation
 *   - reSurveyPoints
 *   - rePropertyLand
 *   - rePropertyConstruction
 *   - rePropertyInfrastructure
 *   - rePropertyPricing
 *   - rePropertyOwners
 *   - rePropertyProfessionals
 *   - rePropertyDocuments
 *   - rePropertyMedia
 *   - rePropertyBlockchain
 *   - rePropertyWorkflow
 *   - rePropertyAuditLog
 *
 * Depends on:
 *   - USER / ACTOR through property owner/actor references.
 *
 * Logical references:
 *   - WEB3 IDENTITY through blockchain ownership/wallet information.
 *   - ORGANIZATIONS through professionals and organizational context.
 *
 * Internal relationships:
 *   - All reProperty* child entities reference reProperties.
 *
 * Architectural rule:
 *   Real-estate persistence is a complete bounded persistence area.
 *   Do not distribute its child tables across unrelated domains.
 */

/**
 * ======================================================================
 * 150. INTEGRATIONS
 * ======================================================================
 *
 * Role:
 *   External provider configuration and secret metadata.
 *
 * Persistence owner:
 *   integrations
 *
 * Tables:
 *   - integrationConfigs
 *   - integrationSecrets
 *   - integrationSecretVersions
 *
 * Depends on:
 *   - None at the integrationConfigs root level.
 *
 * References:
 *   - USER / ACTOR through ownerUserId / updatedBy / createdBy relationships.
 *
 * Internal relationships:
 *   - integrationSecrets -> integrationConfigs
 *   - integrationSecretVersions -> integrationSecrets
 *
 * Architectural rule:
 *   Integration configuration is infrastructure/integration metadata.
 *   It must not become an application-domain substitute for provider
 *   services.
 */

/**
 * ======================================================================
 * 160. COMPLIANCE / PRIVACY
 * ======================================================================
 *
 * Role:
 *   Privacy consent and policy acceptance persistence.
 *
 * Persistence owner:
 *   compliance
 *
 * Tables:
 *   - userConsents
 *
 * Depends on:
 *   - USER / ACTOR
 *
 * Emits:
 *   - SECURITY / AUDIT events at the application level when applicable.
 *
 * Architectural rule:
 *   Compliance/privacy is separate from CIVIL IDENTITY / KYC.
 *
 * Important:
 *   kycVerifications does NOT belong to compliance in the current
 *   physical schema. It belongs to CIVIL IDENTITY / KYC.
 *
 * NOTE:
 *   No termsOfService or privacyPolicies tables are currently declared
 *   in the physical schema.
 */

/**
 * ======================================================================
 * 170. SECURITY / AUDIT
 * ======================================================================
 *
 * Role:
 *   Cross-cutting security telemetry and audit persistence.
 *
 * Persistence owner:
 *   security
 *
 * Tables:
 *   - securityEvents
 *   - auditLogs
 *   - auditLogsImmutable
 *
 * Cross-cutting:
 *   Yes.
 *
 * References:
 *   - USER / ACTOR
 *   - AUTHENTICATION
 *   - WEB3 IDENTITY
 *   - Multiple application domains
 *
 * Architectural rule:
 *   SECURITY / AUDIT records events and audit history.
 *   It MUST NOT become the owner of business rules.
 *
 * Important distinction:
 *   - securityEvents = security telemetry/events
 *   - auditLogs = operational/audit records
 *   - auditLogsImmutable = append-oriented immutable audit chain
 */

/**
 * ======================================================================
 * 180. INFRASTRUCTURE
 * ======================================================================
 *
 * Role:
 *   Transactional outbox persistence.
 *
 * Persistence owner:
 *   infrastructure
 *
 * Tables:
 *   - outboxEvents
 *
 * Depends on:
 *   - None at database FK level.
 *
 * Cross-cutting:
 *   Yes.
 *
 * Purpose:
 *   Reliable asynchronous event publication.
 *
 * Architectural rule:
 *   This domain must remain infrastructure-only.
 *
 * It MUST NOT contain:
 *   - business entities;
 *   - business rules;
 *   - application use cases.
 */

/**
 * ======================================================================
 * FINAL ARCHITECTURAL RULES
 * ======================================================================
 *
 * 1. One physical table has one persistence owner.
 *
 * 2. The numeric domain order is documentation order only.
 *
 * 3. A table must not be described here unless it physically exists in
 *    the current schema/<domain>/tables.ts.
 *
 * 4. Future/planned entities must not be added to this map until they
 *    actually exist in the physical schema.
 *
 * 5. Logical references must not be described as physical foreign keys.
 *
 * 6. Domain business rules do not belong in this file.
 *
 * 7. The aggregator may preserve compatibility for existing consumers,
 *    but new infrastructure code should prefer direct domain table
 *    imports.
 *
 * 8. Changes to table ownership, columns, foreign keys, indexes,
 *    constraints or relations require corresponding inventory validation.
 *
 * 9. The authoritative physical representation remains the respective
 *    tables.ts and relations.ts files plus the validated schema inventory.
 *
 * 10. This file documents the CURRENT STATE. It must never become a
 *     speculative roadmap.
 */

export * from './constants';

export * from './user/tables';
export * from './user/relations';

export * from './authentication/tables';
export * from './authentication/relations';

export * from './authorization/tables';
export * from './authorization/relations';

export * from './civil-identity/tables';
export * from './civil-identity/relations';

export * from './ssi/tables';
export * from './ssi/relations';

export * from './web3/tables';
export * from './web3/relations';

export * from './finance/tables';
export * from './finance/relations';

export * from './integrations/tables';
export * from './integrations/relations';

export * from './compliance/tables';
export * from './compliance/relations';

export * from './security/tables';
export * from './security/relations';

export * from './infrastructure/tables';