import { describe, it, expect } from 'vitest';
import { SiweMessage } from '../../src/domains/web3/value-objects/SiweMessage';
import { Web3DomainError } from '../../src/domains/web3/errors/Web3Errors';

describe('SiweMessage Value Object (EIP-4361 Canonical Formatting)', () => {
  const validAddress = '0x1234567890abcdef1234567890abcdef12345678';
  const validNonce = 'a1b2c3d4e5f67890';
  const domain = 'w3.app';

  it('correctly constructs and formats canonical EIP-4361 message', () => {
    const now = new Date('2026-10-01T12:00:00.000Z');
    const expiresAt = new Date('2026-10-01T12:05:00.000Z');

    const siwe = new SiweMessage({
      domain,
      address: validAddress,
      nonce: validNonce,
      chainId: 56,
      statement: 'Assine para acessar sua conta.',
      uri: 'https://w3.app/login',
      issuedAt: now,
      expirationTime: expiresAt,
    });

    const formatted = siwe.toMessage();

    expect(formatted).toContain('w3.app wants you to sign in with your Ethereum account:');
    expect(formatted).toContain(validAddress);
    expect(formatted).toContain('Assine para acessar sua conta.');
    expect(formatted).toContain('URI: https://w3.app/login');
    expect(formatted).toContain('Version: 1');
    expect(formatted).toContain('Chain ID: 56');
    expect(formatted).toContain(`Nonce: ${validNonce}`);
    expect(formatted).toContain('Issued At: 2026-10-01T12:00:00.000Z');
    expect(formatted).toContain('Expiration Time: 2026-10-01T12:05:00.000Z');
  });

  it('detects expiration correctly', () => {
    const now = new Date('2026-10-01T12:00:00.000Z');
    const past = new Date('2026-10-01T11:59:00.000Z');
    const future = new Date('2026-10-01T12:05:00.000Z');

    const expiredSiwe = new SiweMessage({
      domain,
      address: validAddress,
      nonce: validNonce,
      issuedAt: past,
      expirationTime: past,
    });

    const activeSiwe = new SiweMessage({
      domain,
      address: validAddress,
      nonce: validNonce,
      issuedAt: now,
      expirationTime: future,
    });

    expect(expiredSiwe.isExpired(now)).toBe(true);
    expect(activeSiwe.isExpired(now)).toBe(false);
  });

  it('rejects empty domain or nonce with less than 8 characters', () => {
    expect(() => {
      new SiweMessage({
        domain: '',
        address: validAddress,
        nonce: validNonce,
      });
    }).toThrow(Web3DomainError);

    expect(() => {
      new SiweMessage({
        domain,
        address: validAddress,
        nonce: '12345', // < 8 chars
      });
    }).toThrow(Web3DomainError);
  });
});
