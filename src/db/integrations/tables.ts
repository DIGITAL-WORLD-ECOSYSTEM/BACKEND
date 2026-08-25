import { sqliteTable, text, integer, index, uniqueIndex, primaryKey, check } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { users } from '../user/tables';



//
//   Integrations subsystem
//   N/A
//   N/A
//   N/A

// ----------------------------------------------------------------------
// Entity: integrationConfigs
// ----------------------------------------------------------------------
export const integrationConfigs = sqliteTable(
  'integration_configs',
  {
    id: text('id').primaryKey(), // UUID
    provider: text('provider').notNull(), // ex: binance, stripe, openai
    category: text('category', {
      enum: ['finance', 'web3', 'ai', 'communications', 'oauth', 'infrastructure', 'analytics'],
    }).notNull(),
    environment: text('environment', {
      enum: ['local', 'preview', 'staging', 'production'],
    })
      .notNull()
      .default('production'),

    baseUrl: text('base_url'),
    sandboxMode: integer('sandbox_mode', { mode: 'boolean' }).default(false),

    riskClassification: text('risk_classification', {
      enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL', 'NUCLEAR'],
    })
      .notNull()
      .default('MEDIUM'),

    rotationIntervalDays: integer('rotation_interval_days'),
    nextRotationAt: integer('next_rotation_at', { mode: 'timestamp' }),

    status: text('status', {
      enum: ['online', 'failing', 'missing'],
    }).default('missing'),

    dependencies: text('dependencies', { mode: 'json' }).$type<string[]>(), // Ex: ["Billing", "Marketplace"]

    createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(strftime('%s', 'now'))`),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(strftime('%s', 'now'))`),
  },
  (table) => ({
    providerEnvIdx: uniqueIndex('idx_integration_provider_env').on(
      table.provider,
      table.environment
    ),
  })
);



// ----------------------------------------------------------------------
// Entity: integrationSecrets
// ----------------------------------------------------------------------
export const integrationSecrets = sqliteTable(
  'integration_secrets',
  {
    id: text('id').primaryKey(), // UUID
    configId: text('config_id')
      .notNull()
      .references(() => integrationConfigs.id, { onDelete: 'cascade' }),
    keyName: text('key_name').notNull(), // ex: STRIPE_SECRET
    encryptedValue: text('encrypted_value').notNull(), // AES-256-GCM encrypted

    version: integer('version').notNull().default(1),
    scopesAllowed: text('scopes_allowed', { mode: 'json' }).$type<string[]>(),

    // Leasing & Ownership
    leaseExpiresAt: integer('lease_expires_at', { mode: 'timestamp' }),
    ownerRole: text('owner_role').default('dev'),
    ownerUserId: integer('owner_user_id').references(() => users.id),

    updatedBy: integer('updated_by').references(() => users.id), // ID do admin
    updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(strftime('%s', 'now'))`),
  },
  (table) => ({
    configKeyIdx: uniqueIndex('idx_integration_secret_config_key').on(
      table.configId,
      table.keyName
    ),
  })
);



// ----------------------------------------------------------------------
// Entity: integrationSecretVersions
// ----------------------------------------------------------------------
export const integrationSecretVersions = sqliteTable('integration_secret_versions', {
  id: text('id').primaryKey(), // UUID
  secretId: text('secret_id')
    .notNull()
    .references(() => integrationSecrets.id, { onDelete: 'cascade' }),
  encryptedValue: text('encrypted_value').notNull(),
  version: integer('version').notNull(),

  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(strftime('%s', 'now'))`),
  createdBy: integer('created_by').references(() => users.id),
});

