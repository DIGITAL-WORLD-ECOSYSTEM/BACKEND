import { sqliteTable, text, integer, index, uniqueIndex, primaryKey, check } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { users } from '../user/tables';
import { CONSENT_TYPES } from '../constants';



//
//   Compliance subsystem
//   USER / ACTOR
//   N/A
//   SECURITY / AUDIT events

// ----------------------------------------------------------------------
// Entity: userConsents
// ----------------------------------------------------------------------
export const userConsents = sqliteTable(
  'user_consents',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),

    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    consentType:   text('consent_type', { enum: CONSENT_TYPES }).notNull(),
    policyVersion: text('policy_version').notNull(), // Ex: '2.1.0' ou '2026-08'
    status:        text('status', { enum: ['accepted', 'declined', 'revoked'] }).notNull(),

    // Rastreabilidade
    source:    text('source'),    // 'web', 'mobile', 'api', 'admin'
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    metadata:  text('metadata', { mode: 'json' }),

    acceptedAt: integer('accepted_at', { mode: 'timestamp' }),
    revokedAt:  integer('revoked_at',  { mode: 'timestamp' }),
    createdAt:  integer('created_at',  { mode: 'timestamp' }).default(sql`(unixepoch())`).notNull(),
  },
  (table) => ({
    userIdx:        index('idx_consents_user').on(table.userId),
    typeVersionIdx: index('idx_consents_type_version').on(table.consentType, table.policyVersion),
  })
);

