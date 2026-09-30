import { describe, it, expect } from 'vitest';
import { CryptoVault } from '@/infrastructure/security/crypto/crypto';
import { WebCryptoVaultAdapter } from '@/infrastructure/security/crypto/WebCryptoVaultAdapter';

describe('CryptoVault & WebCryptoVaultAdapter (HKDF-SHA256 & Envelope Hardening)', () => {
  const masterSecret = 'super-secret-master-key-32bytes!';
  const plaintext = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';

  it('should encrypt and decrypt using structured envelope with real nonce and authTag', async () => {
    const envelope = await CryptoVault.encryptEnvelope(plaintext, masterSecret);

    expect(envelope.ciphertext).toBeDefined();
    expect(envelope.nonce).toBeDefined();
    expect(envelope.authTag).toBeDefined();

    // Nonce deve ter 12 bytes decodificados em Base64
    const nonceBytes = atob(envelope.nonce);
    expect(nonceBytes.length).toBe(12);

    // AuthTag deve ter 16 bytes (128 bits) decodificados em Base64
    const tagBytes = atob(envelope.authTag);
    expect(tagBytes.length).toBe(16);

    const decrypted = await CryptoVault.decryptEnvelope(envelope, masterSecret);
    expect(decrypted).toBe(plaintext);
  });

  it('should work seamlessly via WebCryptoVaultAdapter port', async () => {
    const adapter = new WebCryptoVaultAdapter();
    const envelope = await adapter.encryptEnvelope(plaintext, masterSecret);
    const decrypted = await adapter.decryptEnvelope(envelope, masterSecret);

    expect(decrypted).toBe(plaintext);
  });

  it('Tamper Resistance: should reject decryption if ciphertext is modified by 1 bit', async () => {
    const envelope = await CryptoVault.encryptEnvelope(plaintext, masterSecret);

    // Adulterar 1 caractere no ciphertext
    const tamperedCiphertext =
      envelope.ciphertext.substring(0, envelope.ciphertext.length - 2) + 'AA';

    await expect(
      CryptoVault.decryptEnvelope(
        { ...envelope, ciphertext: tamperedCiphertext },
        masterSecret
      )
    ).rejects.toThrow();
  });

  it('Tamper Resistance: should reject decryption if authTag is altered', async () => {
    const envelope = await CryptoVault.encryptEnvelope(plaintext, masterSecret);

    const tamperedTag =
      envelope.authTag.substring(0, envelope.authTag.length - 2) + 'ZZ';

    await expect(
      CryptoVault.decryptEnvelope(
        { ...envelope, authTag: tamperedTag },
        masterSecret
      )
    ).rejects.toThrow();
  });

  it('Fail-Closed: should reject encryption when secret is empty or whitespace', async () => {
    await expect(CryptoVault.encryptEnvelope(plaintext, '')).rejects.toThrow(
      /Chave mestra de criptografia ausente/
    );

    await expect(CryptoVault.encryptEnvelope(plaintext, '   ')).rejects.toThrow(
      /Chave mestra de criptografia ausente/
    );
  });

  it('Legacy compatibility: encrypt and decrypt methods still function', async () => {
    const combined = await CryptoVault.encrypt(plaintext, masterSecret);
    const decrypted = await CryptoVault.decrypt(combined, masterSecret);
    expect(decrypted).toBe(plaintext);
  });
});
