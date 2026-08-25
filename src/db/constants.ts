// Constants extracted mechanically


export const USER_ROLES    = ['citizen', 'partner', 'admin', 'system', 'dev'] as const;


export const USER_STATUS   = ['pending_setup', 'active', 'suspended', 'locked', 'disabled'] as const;


export const AUTH_TYPES    = ['password', 'totp', 'webauthn', 'recovery_code', 'wallet'] as const;


export const CONSENT_TYPES = ['terms_of_service', 'privacy_policy', 'marketing', 'data_processing', 'cookies'] as const;


export const SECURITY_EVENT_TYPES = [
  'authentication_succeeded',
  'authentication_failed',
  'credential_created',
  'credential_verified',
  'credential_revoked',
  'password_changed',
  'password_reset_requested',
  'passkey_registered',
  'passkey_used',
  'totp_enabled',
  'totp_verified',
  'wallet_linked',
  'wallet_verified',
  'wallet_authenticated',
  'wallet_suspended',
  'wallet_revoked',
  'wallet_unlinked',
  'recovery_code_consumed',
  'account_locked',
  'account_unlocked',
  'auth_epoch_incremented',
] as const;

