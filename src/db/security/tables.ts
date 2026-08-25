import { sqliteTable, text, integer, index, uniqueIndex, primaryKey, check } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { users } from '../user/tables';
import { wallets } from '../web3/tables';
import { userAuthenticators, userSessions } from '../authentication/tables';
import { SECURITY_EVENT_TYPES } from '../constants';



//
//   Security / Audit subsystem (Cross-cutting)
//   N/A
//   Multiple domains
//   N/A

// ----------------------------------------------------------------------
// Entity: securityEvents
// ----------------------------------------------------------------------
export const securityEvents = sqliteTable('security_events', {
  id: text('id').primaryKey(),
  userId: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
  walletId: integer('wallet_id').references(() => wallets.id, { onDelete: 'set null' }),
  authenticatorId: text('authenticator_id').references(() => userAuthenticators.id, { onDelete: 'set null' }),
  sessionId: text('session_id').references(() => userSessions.id, { onDelete: 'set null' }),
  
  event: text('event', { enum: SECURITY_EVENT_TYPES }).notNull(),
  result: text('result', { enum: ['success', 'failure', 'denied'] }).notNull(),
  source: text('source', { enum: ['web', 'mobile', 'api', 'worker', 'admin'] }),
  
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  requestId: text('request_id'),
  correlationId: text('correlation_id'),
  
  metadata: text('metadata', { mode: 'json' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`).notNull(),
}, (table) => ({
  userCreatedIdx: index('idx_security_events_user_created').on(table.userId, table.createdAt),
  walletCreatedIdx: index('idx_security_events_wallet_created').on(table.walletId, table.createdAt),
  authIdx: index('idx_security_events_auth').on(table.authenticatorId),
  eventCheck: check('security_events_event_check', sql`${table.event} IN ('authentication_succeeded', 'authentication_failed', 'credential_created', 'credential_verified', 'credential_revoked', 'password_changed', 'password_reset_requested', 'passkey_registered', 'passkey_used', 'totp_enabled', 'totp_verified', 'wallet_linked', 'wallet_verified', 'wallet_authenticated', 'wallet_suspended', 'wallet_revoked', 'wallet_unlinked', 'recovery_code_consumed', 'account_locked', 'account_unlocked', 'auth_epoch_incremented')`),
  resultCheck: check('security_events_result_check', sql`${table.result} IN ('success', 'failure', 'denied')`),
}));



// ----------------------------------------------------------------------
// Entity: auditLogs
// ----------------------------------------------------------------------
export const auditLogs = sqliteTable(
  'audit_logs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    actorId: integer('actor_id').references(() => users.id),
    targetUserId: integer('target_user_id').references(() => users.id),

    action: text('action').notNull(), // Ex: 'VAULT_GENESIS', 'HANDSHAKE_SUCCESS'
    status: text('status').default('success'),
    ipAddress: text('ip_address'),

    metadata: text('metadata', { mode: 'json' }),

    createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(strftime('%s', 'now'))`),
  },
  (table) => ({
    actionIdx: index('idx_audit_action').on(table.action),
    actorIdx: index('idx_audit_actor').on(table.actorId),
  })
);



// ----------------------------------------------------------------------
// Entity: auditLogsImmutable
// ----------------------------------------------------------------------
export const auditLogsImmutable = sqliteTable('audit_logs_immutable', {
  id: text('id').primaryKey(), // UUID
  actorId: integer('actor_id').references(() => users.id),
  actorIp: text('actor_ip'),
  actorUserAgent: text('actor_user_agent'),

  action: text('action').notNull(), // ex: ROTATE_BINANCE_PROD
  resource: text('resource'), // ex: integration_secrets:uuid

  eventHash: text('event_hash').notNull().unique(), // Hash SHA-256 de (id, actorId, action, previousHash, etc)
  previousHash: text('previous_hash'), // Encadeamento

  reason: text('reason'), // Motivo
  status: text('status', { enum: ['success', 'failed'] }).default('success'),

  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(strftime('%s', 'now'))`),
});

