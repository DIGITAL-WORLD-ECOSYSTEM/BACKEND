import { relations } from 'drizzle-orm';

import {
  userAddresses,
  userContacts,
  userEducation,
  userNotificationSettings,
  userProfessionalExperience,
  userProfiles,
  users,
  membershipCards,
} from './tables';

/**
 * ============================================================================
 * USER / ACTOR — RELATIONSHIP MODEL
 * ============================================================================
 *
 * `users` is the relational root for the platform account.
 *
 * CONSTITUTIONAL BOUNDARY COMPLIANCE (Section 05):
 * To strictly enforce Bounded Context isolation and Golden Rule #20:
 * `src/db/user/relations.ts` ONLY defines navigation relations for entities owned
 * directly by the USER context (profiles, contacts, addresses, experience, education, cards, settings).
 */

export const usersRelations = relations(users, ({ one, many }) => ({
  /**
   * One-to-one user profile.
   */
  profile: one(userProfiles, {
    fields: [users.id],
    references: [userProfiles.userId],
  }),

  /**
   * User-owned secondary contacts.
   */
  contacts: many(userContacts),

  /**
   * User-owned personal addresses.
   */
  addresses: many(userAddresses),

  /**
   * User-owned professional experience history.
   */
  professionalExperience: many(userProfessionalExperience),

  /**
   * User-owned academic/education history.
   */
  education: many(userEducation),

  /**
   * DAO membership credentials.
   */
  membershipCards: many(membershipCards),

  /**
   * Personal notification preferences.
   */
  notificationSettings: many(userNotificationSettings),
}));

export const userProfilesRelations = relations(userProfiles, ({ one }) => ({
  user: one(users, {
    fields: [userProfiles.userId],
    references: [users.id],
  }),
}));

export const userContactsRelations = relations(userContacts, ({ one }) => ({
  user: one(users, {
    fields: [userContacts.userId],
    references: [users.id],
  }),
}));

export const userAddressesRelations = relations(userAddresses, ({ one }) => ({
  user: one(users, {
    fields: [userAddresses.userId],
    references: [users.id],
  }),
}));

export const userProfessionalExperienceRelations = relations(
  userProfessionalExperience,
  ({ one }) => ({
    user: one(users, {
      fields: [userProfessionalExperience.userId],
      references: [users.id],
    }),
  })
);

export const userEducationRelations = relations(
  userEducation,
  ({ one }) => ({
    user: one(users, {
      fields: [userEducation.userId],
      references: [users.id],
    }),
  })
);

export const membershipCardsRelations = relations(
  membershipCards,
  ({ one }) => ({
    user: one(users, {
      fields: [membershipCards.userId],
      references: [users.id],
    }),
  })
);

export const userNotificationSettingsRelations = relations(
  userNotificationSettings,
  ({ one }) => ({
    user: one(users, {
      fields: [userNotificationSettings.userId],
      references: [users.id],
    }),
  })
);
