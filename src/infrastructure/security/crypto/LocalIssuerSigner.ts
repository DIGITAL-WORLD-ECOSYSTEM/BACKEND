import { ICredentialSigner, CredentialProof } from '../../../application/ports/security/ICredentialSigner';
import {
  base58Encode,
  base58Decode,
  canonicalizeJson,
  encodeDidKey,
  decodeDidKey,
} from '../../../shared/kernel/ssi_crypto';

export { base58Encode, base58Decode, canonicalizeJson, encodeDidKey, decodeDidKey };

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

  /**
   * Encodes a 32-byte Ed25519 public key into W3C multicodec multibase format (did:key:z6Mk...)
   */
  static encodeDidKey(rawPublicKey: Uint8Array): string {
    return encodeDidKey(rawPublicKey);
  }

  /**
   * Decodes a W3C did:key:z6Mk... into a 32-byte Ed25519 raw public key.
   */
  static decodeDidKey(didKey: string): Uint8Array | null {
    return decodeDidKey(didKey);
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

  async getIssuerDid(): Promise<string> {
    const pubBytes = await this.getPublicKeyBytes();
    if (pubBytes && pubBytes.length === 32) {
      return encodeDidKey(pubBytes);
    }
    throw new Error('Unable to derive public key for issuer DID: key material unavailable or malformed.');
  }

  async signCredential(document: any, issuerDid?: string, keyId?: string): Promise<CredentialProof> {
    const effectiveIssuerDid = issuerDid || (await this.getIssuerDid());
    const docCopy = { ...document };
    delete docCopy.proof;

    const sortedDoc = canonicalizeJson(docCopy);
    const dataToSign = new TextEncoder().encode(JSON.stringify(sortedDoc));

    const key = await this.getPrivateKey();

    const signatureBuffer = await crypto.subtle.sign(
      { name: 'Ed25519' },
      key,
      dataToSign
    );

    const proofValue = base58Encode(new Uint8Array(signatureBuffer));

    return {
      type: 'Ed25519Signature2020',
      created: new Date().toISOString(),
      verificationMethod: keyId || `${effectiveIssuerDid}#keys-1`,
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

      const sortedDoc = canonicalizeJson(docCopy);
      const dataToVerify = new TextEncoder().encode(JSON.stringify(sortedDoc));

      const signatureBytes = base58Decode(proof.proofValue);
      if (signatureBytes.length !== 64) {
        return false;
      }

      let pubKeyBytes: Uint8Array | undefined = undefined;
      const verificationMethod = String(proof.verificationMethod || '');

      // 1. Resolve public key from proof.verificationMethod if it's a did:key (universal W3C verification)
      const didKeyMatch = verificationMethod.match(/did:key:(z[1-9A-HJ-NP-Za-km-z]+)/);
      if (didKeyMatch) {
        const resolved = decodeDidKey(`did:key:${didKeyMatch[1]}`);
        if (resolved && resolved.length === 32) {
          pubKeyBytes = resolved;
        }
      }

      // 2. If verificationMethod refers to the local issuer (key alias or local DID fragment)
      if (!pubKeyBytes) {
        const localIssuerDid = await this.getIssuerDid().catch(() => null);
        const isLocalMethod =
          (localIssuerDid && (verificationMethod.startsWith(localIssuerDid) || verificationMethod.startsWith('#'))) ||
          verificationMethod === 'did:key:asppibra-dao-root-issuer#keys-1';

        if (isLocalMethod) {
          pubKeyBytes = this.cachedPublicKeyBytes;
          if (!pubKeyBytes && this.privateKeyBytes) {
            pubKeyBytes = await this.getPublicKeyBytes();
          }
        }
      }

      // 3. If verificationMethod could not be resolved or is an unsupported/unknown DID method, fail-closed
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
}
