import { sqliteTable, text, integer, index, uniqueIndex, primaryKey, check } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';



//
//   Infrastructure subsystem (Cross-cutting)
//   N/A
//   Multiple domains
//   N/A

// ----------------------------------------------------------------------
// Entity: outboxEvents
// ----------------------------------------------------------------------
export const outboxEvents = sqliteTable('outbox_events', {
  id: text('id').primaryKey(), // UUID do evento (eventId)
  aggregateId: integer('aggregate_id').notNull(),
  aggregateType: text('aggregate_type').notNull(),
  aggregateVersion: integer('aggregate_version').notNull(),
  eventName: text('event_name').notNull(),
  payload: text('payload').notNull(), // JSON
  metadata: text('metadata'), // JSON
  attempts: integer('attempts').default(0).notNull(),
  published: integer('published', { mode: 'boolean' }).default(false).notNull(),
  publishedAt: integer('published_at', { mode: 'timestamp' }),
  error: text('error'),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(strftime('%s', 'now'))`).notNull(),
});

