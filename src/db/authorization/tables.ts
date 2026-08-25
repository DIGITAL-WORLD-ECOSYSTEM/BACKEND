import { sqliteTable, text, integer, index, uniqueIndex, primaryKey, check } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { users } from '../user/tables';



//
//   Authorization subsystem (RBAC)
//   USER / ACTOR
//   N/A
//   SECURITY / AUDIT events

// ----------------------------------------------------------------------
// Entity: roles
// ----------------------------------------------------------------------
export const roles = sqliteTable('roles', {
  id:          integer('id').primaryKey({ autoIncrement: true }),
  key:         text('key').notNull().unique(), // 'admin', 'citizen', 'partner', 'auditor'...
  displayName: text('display_name').notNull(),
  description: text('description'),
  status:      text('status', { enum: ['active', 'disabled', 'archived'] }).default('active').notNull(),
  isSystem:    integer('is_system', { mode: 'boolean' }).default(false).notNull(), // true = não pode ser deletado
  version:     integer('version').default(1).notNull(),
  createdBy:   integer('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt:   integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`).notNull(),
  updatedAt:   integer('updated_at', { mode: 'timestamp' }).default(sql`(unixepoch())`).notNull().$onUpdateFn(() => new Date()),
}, (table) => ({
  statusIdx: index('idx_roles_status').on(table.status),
  versionCheck: check('roles_version_check', sql`${table.version} >= 1`),
  statusCheck: check('roles_status_check', sql`${table.status} IN ('active', 'disabled', 'archived')`),
}));



// ----------------------------------------------------------------------
// Entity: userRoles
// ----------------------------------------------------------------------
export const userRoles = sqliteTable(
  'user_roles',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    roleId: integer('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'restrict' }),

    // Auditoria da concessão
    grantSource: text('grant_source', { enum: ['admin', 'system', 'migration', 'policy'] }).notNull().default('admin'),
    grantedBy: integer('granted_by').references(() => users.id, { onDelete: 'set null' }),
    grantReason: text('grant_reason'),
    grantedAt: integer('granted_at', { mode: 'timestamp' }).default(sql`(unixepoch())`).notNull(),

    // Lifecycle da concessão
    expiresAt: integer('expires_at', { mode: 'timestamp' }),
    
    revokedBy: integer('revoked_by').references(() => users.id, { onDelete: 'set null' }),
    revokedAt: integer('revoked_at', { mode: 'timestamp' }),
    revocationReason: text('revocation_reason'),

    version: integer('version').default(1).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(unixepoch())`).notNull().$onUpdateFn(() => new Date()),
  },
  (table) => ({
    userRoleLifecycleIdx: index('idx_user_roles_user_role_lifecycle').on(table.userId, table.roleId, table.revokedAt, table.expiresAt),
    roleLifecycleIdx: index('idx_user_roles_role_lifecycle').on(table.roleId, table.revokedAt, table.expiresAt),
    grantedByIdx: index('idx_user_roles_granted_by').on(table.grantedBy),
    revokedByIdx: index('idx_user_roles_revoked_by').on(table.revokedBy),
    
    expiresAfterGrantCheck: check('user_roles_expires_after_grant', sql`${table.expiresAt} IS NULL OR ${table.expiresAt} > ${table.grantedAt}`),
    revokedAfterGrantCheck: check('user_roles_revoked_after_grant', sql`${table.revokedAt} IS NULL OR ${table.revokedAt} >= ${table.grantedAt}`),
    revocationCoherenceCheck: check('user_roles_revocation_coherence', sql`${table.revokedBy} IS NULL OR ${table.revokedAt} IS NOT NULL`),
    versionCheck: check('user_roles_version_check', sql`${table.version} >= 1`),
    grantSourceCheck: check('user_roles_grant_source_check', sql`${table.grantSource} IN ('admin', 'system', 'migration', 'policy')`),
  })
);

