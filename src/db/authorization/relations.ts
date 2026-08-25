import { relations } from 'drizzle-orm';
import { roles, userRoles } from './tables';
import { users } from '../user/tables';




export const rolesRelations = relations(roles, ({ many }) => ({
  userRoles: many(userRoles),
}));



export const userRolesRelations = relations(userRoles, ({ one }) => ({
  user: one(users, {
    fields: [userRoles.userId],
    references: [users.id],
    relationName: 'roleOwner',
  }),
  role: one(roles, {
    fields: [userRoles.roleId],
    references: [roles.id],
  }),
  grantedByUser: one(users, {
    fields: [userRoles.grantedBy],
    references: [users.id],
    relationName: 'grantedRoles',
  }),
  revokedByUser: one(users, {
    fields: [userRoles.revokedBy],
    references: [users.id],
    relationName: 'revokedRoles',
  }),
}));

