import { describe, it, expect } from 'vitest';
import { UserAccount } from '../../src/domains/identity/entities/UserAccount';
import { User } from '../../src/domains/identity/entities/User';

describe('IAM Entity: UserAccount Semantic Invariants', () => {
  it('should instantiate UserAccount and enforce active human authentication', () => {
    const account = new UserAccount({
      id: 1,
      publicId: 'usr_abc123',
      email: 'test@example.com',
      emailNormalized: 'test@example.com',
      status: 'active',
      subjectType: 'human',
      failedLoginAttempts: 0,
      lastFailedLoginAt: null,
      authEpoch: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    expect(account.id).toBe(1);
    expect(account.canAuthenticate()).toBe(true);
  });

  it('should lockout account after MAX_FAILED_ATTEMPTS (5) and reject authentication', () => {
    const account = new UserAccount({
      id: 1,
      email: 'test@example.com',
      status: 'active',
      subjectType: 'human',
      failedLoginAttempts: 0,
      lastFailedLoginAt: null,
      authEpoch: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    for (let i = 0; i < 4; i++) {
      account.registerFailedLogin();
      expect(account.status).toBe('active');
      expect(account.canAuthenticate()).toBe(true);
    }

    account.registerFailedLogin(); // 5th attempt
    expect(account.status).toBe('locked');
    expect(account.canAuthenticate()).toBe(false);

    account.resetFailedLogins();
    expect(account.status).toBe('active');
    expect(account.failedLoginAttempts).toBe(0);
    expect(account.canAuthenticate()).toBe(true);
  });

  it('preserves full backward compatibility when instantiated through legacy User shim', () => {
    const legacyUser = new User({
      id: 42,
      email: 'legacy@example.com',
      status: 'active',
      subjectType: 'citizen',
      failedLoginAttempts: 0,
      lastFailedLoginAt: null,
      authEpoch: 10,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    expect(legacyUser instanceof UserAccount).toBe(true);
    expect(legacyUser.canAuthenticate()).toBe(true);
    expect(legacyUser.authEpoch).toBe(10);
  });
});
