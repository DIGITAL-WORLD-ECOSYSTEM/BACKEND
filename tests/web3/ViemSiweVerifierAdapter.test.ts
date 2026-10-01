import { describe, it, expect } from 'vitest';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { ViemSiweVerifierAdapter } from '../../src/infrastructure/security/crypto/ViemSiweVerifierAdapter';
import { SiweMessage } from '../../src/domains/web3/value-objects/SiweMessage';
import {
  InvalidSiweSignatureError,
  ExpiredChallengeError,
} from '../../src/domains/web3/errors/Web3Errors';

describe('ViemSiweVerifierAdapter (EIP-4361 SIWE Signature Verification)', () => {
  const verifier = new ViemSiweVerifierAdapter();
  const domain = 'w3.app';
  const nonce = '1234567890abcdef';

  it('successfully verifies a valid cryptographic signature from a real EVM key', async () => {
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 10 * 60 * 1000);

    const siwe = new SiweMessage({
      domain,
      address: account.address,
      nonce,
      chainId: 56,
      statement: 'Assine para autenticar ou vincular sua carteira ao ecossistema.',
      uri: `https://${domain}`,
      issuedAt: now,
      expirationTime: expiresAt,
    });

    const message = siwe.toMessage();
    const signature = await account.signMessage({ message });

    const result = await verifier.verify({
      message,
      signature,
      expectedNonce: nonce,
      expectedDomain: domain,
    });

    expect(result.address.toLowerCase()).toBe(account.address.toLowerCase());
    expect(result.nonce).toBe(nonce);
    expect(result.domain.toLowerCase()).toBe(domain.toLowerCase());
    expect(result.chainId).toBe(56);
  });

  it('rejects forged signature from a different account', async () => {
    const legitKey = generatePrivateKey();
    const legitAccount = privateKeyToAccount(legitKey);

    const attackerKey = generatePrivateKey();
    const attackerAccount = privateKeyToAccount(attackerKey);

    const now = new Date();
    const siwe = new SiweMessage({
      domain,
      address: legitAccount.address, // Declara ser a conta legítima
      nonce,
      chainId: 56,
      issuedAt: now,
    });

    const message = siwe.toMessage();
    // O atacante assina a mensagem com sua própria chave
    const forgedSignature = await attackerAccount.signMessage({ message });

    await expect(
      verifier.verify({
        message,
        signature: forgedSignature,
        expectedNonce: nonce,
        expectedDomain: domain,
      })
    ).rejects.toThrow(InvalidSiweSignatureError);
  });

  it('rejects when expected nonce does not match', async () => {
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);

    const siwe = new SiweMessage({
      domain,
      address: account.address,
      nonce: 'originalNonce123',
    });

    const message = siwe.toMessage();
    const signature = await account.signMessage({ message });

    await expect(
      verifier.verify({
        message,
        signature,
        expectedNonce: 'differentNonce456',
        expectedDomain: domain,
      })
    ).rejects.toThrow(InvalidSiweSignatureError);
  });

  it('rejects when expected domain does not match (phishing protection)', async () => {
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);

    const siwe = new SiweMessage({
      domain: 'phishing-site.xyz',
      address: account.address,
      nonce,
    });

    const message = siwe.toMessage();
    const signature = await account.signMessage({ message });

    await expect(
      verifier.verify({
        message,
        signature,
        expectedNonce: nonce,
        expectedDomain: 'w3.app',
      })
    ).rejects.toThrow(InvalidSiweSignatureError);
  });

  it('rejects expired SIWE messages', async () => {
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);

    const pastDate = new Date(Date.now() - 10000);
    const expiredSiwe = new SiweMessage({
      domain,
      address: account.address,
      nonce,
      issuedAt: new Date(Date.now() - 20000),
      expirationTime: pastDate,
    });

    const message = expiredSiwe.toMessage();
    const signature = await account.signMessage({ message });

    await expect(
      verifier.verify({
        message,
        signature,
        expectedNonce: nonce,
        expectedDomain: domain,
      })
    ).rejects.toThrow(ExpiredChallengeError);
  });
});
