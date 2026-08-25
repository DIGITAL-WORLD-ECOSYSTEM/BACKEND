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
