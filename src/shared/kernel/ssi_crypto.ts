/**
 * ============================================================================
 * SSI CRYPTO & CANONICALIZATION SHARED UTILITIES
 * ============================================================================
 * Pure functions for W3C did:key encoding/decoding and deterministic JSON sorting.
 * Zero external dependencies; strictly follows Clean Architecture / Shared Kernel purity.
 */

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function base58Encode(buffer: Uint8Array): string {
  const digits = [0];
  for (let i = 0; i < buffer.length; i++) {
    for (let j = 0; j < digits.length; j++) digits[j] <<= 8;
    digits[0] += buffer[i];
    let carry = 0;
    for (let j = 0; j < digits.length; ++j) {
      digits[j] += carry;
      carry = (digits[j] / 58) | 0;
      digits[j] %= 58;
    }
    while (carry) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  for (let i = 0; buffer[i] === 0 && i < buffer.length - 1; i++) digits.push(0);
  return digits
    .reverse()
    .map((digit) => BASE58_ALPHABET[digit])
    .join('');
}

export function base58Decode(string: string): Uint8Array {
  const ALPHABET_MAP: Record<string, number> = {};
  for (let i = 0; i < BASE58_ALPHABET.length; i++) {
    ALPHABET_MAP[BASE58_ALPHABET.charAt(i)] = i;
  }
  if (string.length === 0) return new Uint8Array();
  const bytes = [0];
  for (let i = 0; i < string.length; i++) {
    const c = string[i];
    if (!(c in ALPHABET_MAP)) throw new Error('Non-base58 character');
    for (let j = 0; j < bytes.length; j++) bytes[j] *= 58;
    bytes[0] += ALPHABET_MAP[c];
    let carry = 0;
    for (let j = 0; j < bytes.length; ++j) {
      bytes[j] += carry;
      carry = bytes[j] >> 8;
      bytes[j] &= 0xff;
    }
    while (carry) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (let i = 0; string[i] === '1' && i < string.length - 1; i++) bytes.push(0);
  return new Uint8Array(bytes.reverse());
}

/**
 * Deterministically sorts object keys recursively at all levels (RFC 8785 JSON Canonicalization Scheme compatible subset).
 */
export function canonicalizeJson(obj: any): any {
  if (typeof obj !== 'object' || obj === null) return obj;
  if (Array.isArray(obj)) return obj.map((i) => canonicalizeJson(i));

  const sorted: any = {};
  Object.keys(obj)
    .sort()
    .forEach((key) => {
      sorted[key] = canonicalizeJson(obj[key]);
    });
  return sorted;
}

/**
 * Encodes a 32-byte Ed25519 raw public key into standard W3C multicodec multibase format (did:key:z6Mk...)
 */
export function encodeDidKey(rawPublicKey: Uint8Array): string {
  if (rawPublicKey.length !== 32) {
    throw new Error('Ed25519 raw public key must be exactly 32 bytes.');
  }
  // Prefix 0xed, 0x01 (varint multicodec for ed25519-pub)
  const multicodec = new Uint8Array(34);
  multicodec[0] = 0xed;
  multicodec[1] = 0x01;
  multicodec.set(rawPublicKey, 2);
  return `did:key:z${base58Encode(multicodec)}`;
}

/**
 * Decodes a standard W3C did:key:z6Mk... into a 32-byte Ed25519 raw public key.
 */
export function decodeDidKey(didKey: string): Uint8Array | null {
  try {
    const match = didKey.match(/^did:key:(z[1-9A-HJ-NP-Za-km-z]+)/);
    if (!match) return null;
    const multibaseStr = match[1].substring(1); // remove 'z'
    const decoded = base58Decode(multibaseStr);
    if (decoded.length === 34 && decoded[0] === 0xed && decoded[1] === 0x01) {
      return decoded.slice(2);
    }
    if (decoded.length === 32) {
      return decoded;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Extracts and encodes an Ed25519 private key from PKCS#8 DER bytes into multibase and hex format.
 */
export function exportEd25519PrivateKeyMultibase(pkcs8Bytes: Uint8Array): {
  privateKeyMultibase: string;
  privateKeyHex: string;
} {
  const seed = pkcs8Bytes.length >= 48 ? pkcs8Bytes.slice(pkcs8Bytes.length - 32) : pkcs8Bytes;
  const privateKeyHex = Array.from(seed)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const privateKeyMultibase = `z${base58Encode(seed)}`;
  return { privateKeyMultibase, privateKeyHex };
}

