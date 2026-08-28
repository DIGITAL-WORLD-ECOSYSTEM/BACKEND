import { sqliteTable, text, integer, index, uniqueIndex, check } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { users } from '../user/tables';
import { financialTransactions } from '../finance/tables';

/**
 * ============================================================================
 * INFRASTRUCTURE DOMAIN (Outbox, Idempotency & Message Receipts)
 * ============================================================================
 */

// ----------------------------------------------------------------------
// Entity: outboxEvents
// ----------------------------------------------------------------------
export const outboxEvents = sqliteTable(
  'outbox_events',
  {
    id: text('id').primaryKey(), // UUID do evento (eventId)
    aggregateId: text('aggregate_id').notNull(),
    aggregateType: text('aggregate_type').notNull(),
    aggregateVersion: integer('aggregate_version').notNull(),
    eventName: text('event_name').notNull(),
    payload: text('payload').notNull(), // JSON
    metadata: text('metadata'), // JSON
    attempts: integer('attempts').default(0).notNull(),
    published: integer('published', { mode: 'boolean' }).default(false).notNull(),
    publishedAt: integer('published_at', { mode: 'timestamp' }),
    leaseOwner: text('lease_owner'),
    leaseExpiresAt: integer('lease_expires_at', { mode: 'timestamp' }),
    error: text('error'),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull(),
  },
  (table) => ({
    publishedIdx: index('idx_outbox_events_published').on(table.published),
    leaseIdx: index('idx_outbox_events_lease').on(table.leaseExpiresAt),
    createdIdx: index('idx_outbox_events_created').on(table.createdAt),
  })
);

// ----------------------------------------------------------------------
// Entity: idempotencyKeys
// ----------------------------------------------------------------------
export const idempotencyKeys = sqliteTable(
  'idempotency_keys',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id').references(() => users.id, { onDelete: 'restrict' }),
    scope: text('scope').notNull().default('default'),
    key: text('key').notNull(),
    requestHash: text('request_hash').notNull().default('hash'),
    financialTransactionId: integer('financial_transaction_id').references(
      () => financialTransactions.id,
      { onDelete: 'restrict' }
    ),
    status: text('status', {
      enum: ['processing', 'completed', 'failed'],
    })
      .notNull()
      .default('processing'),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp' }),
  },
  (table) => ({
    userScopeKeyUnq: uniqueIndex('uq_idempotency_user_scope_key')
      .on(table.userId, table.scope, table.key)
      .where(sql`${table.userId} IS NOT NULL`),
    anonScopeKeyUnq: uniqueIndex('uq_idempotency_anon_scope_key')
      .on(table.scope, table.key)
      .where(sql`${table.userId} IS NULL`),
    statusIdx: index('idx_idempotency_keys_status').on(table.status),
  })
);

// ----------------------------------------------------------------------
// Entity: eventConsumerReceipts
// ----------------------------------------------------------------------
export const eventConsumerReceipts = sqliteTable(
  'event_consumer_receipts',
  {
    id: text('id').primaryKey(), // UUID v4
    consumerId: text('consumer_id').notNull(),
    eventId: text('event_id').notNull(),
    processedAt: integer('processed_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull(),
  },
  (table) => ({
    consumerEventUnq: uniqueIndex('uq_consumer_event').on(table.consumerId, table.eventId),
    eventIdx: index('idx_receipts_event').on(table.eventId),
  })
);
