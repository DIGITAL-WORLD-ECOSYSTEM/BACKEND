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
