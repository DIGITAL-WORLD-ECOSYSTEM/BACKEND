import { relations, AnyColumn, RelationConfig } from 'drizzle-orm';
import { securityEvents } from './tables';
import { users } from '../user/tables';
import { userAuthenticators, userSessions } from '../authentication/tables';




// No explicit ORM relations currently required.


// No explicit ORM relations currently required.


// No explicit ORM relations currently required.


// No explicit ORM relations currently required.


// No explicit ORM relations currently required.


// No explicit ORM relations currently required.


// No explicit ORM relations currently required.


// No explicit ORM relations currently required.


// No explicit ORM relations currently required.


export const securityEventsRelations = relations(securityEvents, ({ one }) => ({
  user: one(users, { fields: [securityEvents.userId], references: [users.id], relationName: 'userSecurityEvents' }),
  authenticator: one(userAuthenticators, { fields: [securityEvents.authenticatorId], references: [userAuthenticators.id] }),
  session: one(userSessions, { fields: [securityEvents.sessionId], references: [userSessions.id] }),
}));

