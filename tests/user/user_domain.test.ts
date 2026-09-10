import { describe, it, expect } from 'vitest';
import { createUserId, fromTrustedUserId } from '../../src/shared/kernel/ids/UserId';
import { PublicId } from '../../src/domains/user/value-objects/PublicId';
import { Email } from '../../src/domains/user/value-objects/Email';
import { UserStatusPolicy } from '../../src/domains/user/policies/UserStatusPolicy';
import { User } from '../../src/domains/user/entities/User';

describe('USER Domain - Production Hardening & Invariants', () => {
  describe('Email Value Object', () => {
    it('creates a valid Email and normalizes to lowercase', () => {
      const result = Email.create('User.Test+Tag@EXAMPLE.COM');
      expect(result.isOk()).toBe(true);
      const email = result.getValue();
      expect(email.getRaw()).toBe('User.Test+Tag@EXAMPLE.COM');
      expect(email.getNormalized()).toBe('user.test+tag@example.com');
      expect(email.toString()).toBe('user.test+tag@example.com');
    });

    it('rejects invalid email formats, empty strings, and out-of-boundary lengths', () => {
      expect(Email.create('').isErr()).toBe(true);
      expect(Email.create('invalid-email').isErr()).toBe(true);
      expect(Email.create('user@').isErr()).toBe(true);
      expect(Email.create('@domain.com').isErr()).toBe(true);
      expect(Email.create('a@b.c').isErr()).toBe(true); // < 5 chars
    });

    it('compares emails based on canonical normalized value', () => {
      const e1 = Email.create('john.doe@example.com').getValue();
      const e2 = Email.create('JOHN.DOE@EXAMPLE.COM').getValue();
      expect(e1.equals(e2)).toBe(true);
    });
  });

  describe('PublicId Value Object (Canonical EVM Address)', () => {
    it('creates a valid PublicId from 40-hex EVM address and normalizes to lowercase', () => {
      const raw = '0x1234567890ABCDEF1234567890ABCDEF12345678';
      const result = PublicId.create(raw);
      expect(result.isOk()).toBe(true);
      const vo = result.getValue();
      expect(vo.getValue()).toBe('0x1234567890abcdef1234567890abcdef12345678');
      expect(vo.toString()).toBe('0x1234567890abcdef1234567890abcdef12345678');
    });

    it('rejects invalid or malformed EVM addresses', () => {
      expect(PublicId.create('').isErr()).toBe(true);
      expect(PublicId.create('0x1234').isErr()).toBe(true); // short
      expect(PublicId.create('0x1234567890abcdef1234567890abcdef1234567Z').isErr()).toBe(true); // non-hex 'Z'
      expect(PublicId.create('1234567890abcdef1234567890abcdef12345678').isErr()).toBe(true); // missing 0x prefix
    });
  });

  describe('User Aggregate Root Encapsulation & Immutability', () => {
    it('validates creation in runtime returning Result<User, Error>', () => {
      const userId = fromTrustedUserId(1);
      const email = Email.create('test@example.com').getValue();

      const userResult = User.create({
        id: userId,
        email,
        subjectType: 'human',
      });

      expect(userResult.isOk()).toBe(true);
      const user = userResult.getValue();

      expect(user.id).toBe(1);
      expect(user.email).toBe('test@example.com');
      expect(user.emailNormalized).toBe('test@example.com');
      expect(user.status).toBe('pending_setup');
      expect(user.publicId).toBeNull();
      expect(user.isActive()).toBe(false);
    });

    it('protects Date fields against external mutation via defensive copying', () => {
      const user = User.create({
        id: fromTrustedUserId(1),
        email: Email.create('test@example.com').getValue(),
      }).getValue();

      const originalYear = user.createdAt.getFullYear();
      const createdAtCopy = user.createdAt;
      createdAtCopy.setFullYear(1900); // Try mutating external Date object

      // The internal Date must NOT have mutated!
      expect(user.createdAt.getFullYear()).toBe(originalYear);
      expect(user.createdAt.getFullYear()).not.toBe(1900);
    });

    it('enforces email verification consistency (cannot verify non-existent email)', () => {
      const userWithoutEmail = User.create({
        id: fromTrustedUserId(2),
        email: null,
      }).getValue();

      const verifyResult = userWithoutEmail.markEmailVerified();
      expect(verifyResult.isErr()).toBe(true);
      expect(verifyResult.typedError?.code).toBe('INVALID_EMAIL_VERIFICATION');
    });

    it('performs soft-delete setting status to disabled and prevents multiple soft-deletes', () => {
      const user = User.create({
        id: fromTrustedUserId(3),
        status: 'active',
      }).getValue();

      const deleteRes1 = user.softDelete();
      expect(deleteRes1.isOk()).toBe(true);
      expect(user.isDeleted()).toBe(true);
      expect(user.status).toBe('disabled');
      expect(user.isActive()).toBe(false);

      // Second soft-delete must fail with AlreadyDeletedError
      const deleteRes2 = user.softDelete();
      expect(deleteRes2.isErr()).toBe(true);
      expect(deleteRes2.typedError?.code).toBe('ALREADY_DELETED');
    });

    it('reassigning PublicId returns structured PublicIdAlreadyAssignedError', () => {
      const user = User.create({
        id: fromTrustedUserId(4),
        status: 'active',
      }).getValue();

      const pubId1 = PublicId.create('0x1111111111111111111111111111111111111111').getValue();
      const pubId2 = PublicId.create('0x2222222222222222222222222222222222222222').getValue();

      expect(user.assignPublicId(pubId1).isOk()).toBe(true);
      const reassignResult = user.assignPublicId(pubId2);
      expect(reassignResult.isErr()).toBe(true);
      expect(reassignResult.typedError?.code).toBe('PUBLIC_ID_ALREADY_ASSIGNED');
    });
  });
});
