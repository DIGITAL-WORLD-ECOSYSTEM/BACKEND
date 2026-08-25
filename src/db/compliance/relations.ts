import { relations } from 'drizzle-orm';
import { userConsents } from './tables';
import { users } from '../user/tables';

export const userConsentsRelations = relations(userConsents, ({ one }) => ({
  user: one(users, { fields: [userConsents.userId], references: [users.id] }),
}));
