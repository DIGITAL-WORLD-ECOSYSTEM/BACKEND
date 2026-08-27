import { ICredentialSigner, CredentialProof } from '../../../application/ports/security/ICredentialSigner';

export class LocalIssuerSigner implements ICredentialSigner {
  constructor(private readonly privateKeyBytes: Uint8Array) {}

  private base58Encode(buffer: Uint8Array): string {
    const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    let digits = [0];
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
    return digits.reverse().map(function(digit) { return ALPHABET[digit]; }).join('');
  }

  private base58Decode(string: string): Uint8Array {
    const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    const ALPHABET_MAP: Record<string, number> = {};
    for (let i = 0; i < ALPHABET.length; i++) {
      ALPHABET_MAP[ALPHABET.charAt(i)] = i;
    }
    if (string.length === 0) return new Uint8Array();
    let bytes = [0];
    for (let i = 0; i < string.length; i++) {
      let c = string[i];
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

  async signCredential(document: any, issuerDid: string, keyId?: string): Promise<CredentialProof> {
    const docCopy = { ...document };
    delete docCopy.proof;

    // A real implementation would use Canonicalize JSON (JCS) or similar.
    // We stringify the document stably for the signature.
    const sortedDoc = this.sortKeys(docCopy);
    const dataToSign = new TextEncoder().encode(JSON.stringify(sortedDoc));
    
    // In a WebCrypto Ed25519 environment (or subtle), we would use crypto.subtle.sign.
    // For this demonstration with a raw key, assuming we have a polyfill or subtle support.
    // WebCrypto supports Ed25519 in modern runtimes (Node 19+, Cloudflare Workers).
    const key = await crypto.subtle.importKey(
      'raw',
      this.privateKeyBytes,
      { name: 'Ed25519' },
      false,
      ['sign']
    );

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
    if (!document.proof || !document.proof.proofValue || !document.proof.verificationMethod) {
      return false;
    }

    const docCopy = { ...document };
    const proof = docCopy.proof;
    delete docCopy.proof;

    const sortedDoc = this.sortKeys(docCopy);
    const dataToVerify = new TextEncoder().encode(JSON.stringify(sortedDoc));

    const signatureBytes = this.base58Decode(proof.proofValue);

    // In a real verifier, the public key is resolved via DID resolution using proof.verificationMethod.
    // Since this is just the Signer implementation, we return false here as Verification
    // should ideally be handled by a dedicated VerifyUseCase that resolves the DID document.
    // But for completeness in the interface, we'll throw an error indicating DID resolution is required.
    throw new Error('DID Resolution is required to get the public key for verification.');
  }

  private sortKeys(obj: any): any {
    if (typeof obj !== 'object' || obj === null) return obj;
    if (Array.isArray(obj)) return obj.map((i) => this.sortKeys(i));
    
    const sorted: any = {};
    Object.keys(obj).sort().forEach(key => {
      sorted[key] = this.sortKeys(obj[key]);
    });
    return sorted;
  }
}
