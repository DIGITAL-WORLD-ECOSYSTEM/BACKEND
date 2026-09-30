import { ICredentialSigner, CredentialProof } from '../../../application/ports/security/ICredentialSigner';

const PKCS8_ED25519_PREFIX = new Uint8Array([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
]);

function base64UrlToBytes(base64url: string): Uint8Array {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const pad = base64.length % 4;
  const padded = pad ? base64 + '='.repeat(4 - pad) : base64;
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export class LocalIssuerSigner implements ICredentialSigner {
  private cachedPrivateKey?: CryptoKey;
  private cachedPublicKeyBytes?: Uint8Array;

  constructor(
    private readonly privateKeyBytes: Uint8Array,
    publicKeyBytes?: Uint8Array
  ) {
    if (publicKeyBytes && publicKeyBytes.length === 32) {
      this.cachedPublicKeyBytes = publicKeyBytes;
    }
  }

  private base58Encode(buffer: Uint8Array): string {
    const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
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
      .map(function (digit) {
        return ALPHABET[digit];
      })
      .join('');
  }

  private base58Decode(string: string): Uint8Array {
    const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    const ALPHABET_MAP: Record<string, number> = {};
    for (let i = 0; i < ALPHABET.length; i++) {
      ALPHABET_MAP[ALPHABET.charAt(i)] = i;
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

  private async getPrivateKey(): Promise<CryptoKey> {
    if (!this.cachedPrivateKey) {
      const pkcs8 = new Uint8Array(PKCS8_ED25519_PREFIX.length + this.privateKeyBytes.length);
      pkcs8.set(PKCS8_ED25519_PREFIX, 0);
      pkcs8.set(this.privateKeyBytes, PKCS8_ED25519_PREFIX.length);

      this.cachedPrivateKey = await crypto.subtle.importKey(
        'pkcs8',
        pkcs8,
        { name: 'Ed25519' },
        true,
        ['sign']
      );

      if (!this.cachedPublicKeyBytes) {
        try {
          const jwk = await crypto.subtle.exportKey('jwk', this.cachedPrivateKey);
          if (jwk.x) {
            this.cachedPublicKeyBytes = base64UrlToBytes(jwk.x);
          }
        } catch {
          // Fallback if jwk export is not permitted
        }
      }
    }
    return this.cachedPrivateKey;
  }

  async getPublicKeyBytes(): Promise<Uint8Array | undefined> {
    if (!this.cachedPublicKeyBytes) {
      await this.getPrivateKey();
    }
    return this.cachedPublicKeyBytes;
  }

  async signCredential(document: any, issuerDid: string, keyId?: string): Promise<CredentialProof> {
    const docCopy = { ...document };
    delete docCopy.proof;

    const sortedDoc = this.sortKeys(docCopy);
    const dataToSign = new TextEncoder().encode(JSON.stringify(sortedDoc));

    const key = await this.getPrivateKey();

    const signatureBuffer = await crypto.subtle.sign(
      { name: 'Ed25519' },
      key,
      dataToSign
    );

    const proofValue = this.base58Encode(new Uint8Array(signatureBuffer));

    return {
      type: 'Ed25519Signature2020',
      created: new Date().toISOString(),
      verificationMethod: keyId || `${issuerDid}#keys-1`,
      proofPurpose: 'assertionMethod',
      proofValue,
    };
  }

  async verifyProof(document: any): Promise<boolean> {
    try {
      if (!document || !document.proof || !document.proof.proofValue || !document.proof.verificationMethod) {
        return false;
      }

      const docCopy = { ...document };
      const proof = docCopy.proof;
      delete docCopy.proof;

      const sortedDoc = this.sortKeys(docCopy);
      const dataToVerify = new TextEncoder().encode(JSON.stringify(sortedDoc));

      const signatureBytes = this.base58Decode(proof.proofValue);
      if (signatureBytes.length !== 64) {
        return false;
      }

      // Try to obtain the public key
      let pubKeyBytes = this.cachedPublicKeyBytes;

      if (!pubKeyBytes && this.privateKeyBytes) {
        pubKeyBytes = await this.getPublicKeyBytes();
      }

      // If verificationMethod is did:key:z6M..., extract multicodec key
      if (!pubKeyBytes && typeof proof.verificationMethod === 'string') {
        const didKeyMatch = proof.verificationMethod.match(/^did:key:(z[1-9A-HJ-NP-Za-km-z]+)/);
        if (didKeyMatch) {
          const multibaseStr = didKeyMatch[1].substring(1); // strip leading 'z'
          const decoded = this.base58Decode(multibaseStr);
          // Ed25519 multicodec prefix is 0xed, 0x01 (2 bytes) followed by 32 bytes public key
          if (decoded.length === 34 && decoded[0] === 0xed && decoded[1] === 0x01) {
            pubKeyBytes = decoded.slice(2);
          } else if (decoded.length === 32) {
            pubKeyBytes = decoded;
          }
        }
      }

      if (!pubKeyBytes || pubKeyBytes.length !== 32) {
        return false;
      }

      const verifyKey = await crypto.subtle.importKey(
        'raw',
        pubKeyBytes,
        { name: 'Ed25519' },
        false,
        ['verify']
      );

      return await crypto.subtle.verify(
        { name: 'Ed25519' },
        verifyKey,
        signatureBytes,
        dataToVerify
      );
    } catch {
      return false;
    }
  }

  private sortKeys(obj: any): any {
    if (typeof obj !== 'object' || obj === null) return obj;
    if (Array.isArray(obj)) return obj.map((i) => this.sortKeys(i));

    const sorted: any = {};
    Object.keys(obj)
      .sort()
      .forEach((key) => {
        sorted[key] = this.sortKeys(obj[key]);
      });
    return sorted;
  }
}
