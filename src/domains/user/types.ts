export const USER_STATUSES = [
  'pending_setup',
  'active',
  'suspended',
  'locked',
  'disabled',
] as const;

export type UserStatus = typeof USER_STATUSES[number];

export const USER_SUBJECT_TYPES = [
  'human',
  'service',
  'system',
] as const;

export type UserSubjectType = typeof USER_SUBJECT_TYPES[number];

export interface UserProps {
  id: import('../../shared/kernel/ids/UserId').UserId;
  publicId: string | null;
  subjectType: UserSubjectType;
  email: string | null;
  emailNormalized: string | null;
  emailVerifiedAt: Date | null;
  emailChangedAt: Date | null;
  status: UserStatus;
  statusChangedAt: Date | null;
  lockedAt: Date | null;
  disabledAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
