import { IJwtService } from '../../../application/ports/security/IJwtService';

export class JwtService implements IJwtService {
  private base64UrlEncode(arr: Uint8Array): string {
    const binString = String.fromCharCode(...arr);
    return btoa(binString).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }

  private base64UrlDecode(str: string): Uint8Array {
    let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4) {
      base64 += '=';
    }
    const binString = atob(base64);
    const bytes = new Uint8Array(binString.length);
    for (let i = 0; i < binString.length; i++) {
      bytes[i] = binString.charCodeAt(i);
    }
    return bytes;
  }

  private async getSigningKey(secretKey: string): Promise<CryptoKey> {
    const enc = new TextEncoder();
    const masterKey = await crypto.subtle.importKey(
      'raw',
      enc.encode(secretKey),
      { name: 'HKDF' },
      false,
      ['deriveKey']
    );

    return await crypto.subtle.deriveKey(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: enc.encode('ASPPIBRA-JWT'),
        info: enc.encode('JWT-SIGNING'),
      },
      masterKey,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign', 'verify']
    );
  }

  async sign(payload: any, secret: string, kid: string = 'v1'): Promise<string> {
    const key = await this.getSigningKey(secret);
    const header = { alg: 'HS256', typ: 'JWT', kid };
    const enc = new TextEncoder();
    const encodedHeader = this.base64UrlEncode(enc.encode(JSON.stringify(header)));
    const encodedPayload = this.base64UrlEncode(enc.encode(JSON.stringify(payload)));

    const signingInput = `${encodedHeader}.${encodedPayload}`;
    const signatureBuffer = await crypto.subtle.sign({ name: 'HMAC' }, key, enc.encode(signingInput));

    const encodedSignature = this.base64UrlEncode(new Uint8Array(signatureBuffer));
    return `${signingInput}.${encodedSignature}`;
  }

  async verify(token: string, secret: string): Promise<any> {
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new Error('Token JWT malformatado.');
    }
    const [headerB64, payloadB64, signatureB64] = parts;

    const key = await this.getSigningKey(secret);
    const enc = new TextEncoder();
    const signingInput = `${headerB64}.${payloadB64}`;
    const signatureBytes = this.base64UrlDecode(signatureB64);

    const isValid = await crypto.subtle.verify(
      { name: 'HMAC' },
      key,
      signatureBytes,
      enc.encode(signingInput)
    );

    if (!isValid) {
      throw new Error('Assinatura JWT inválida.');
    }

    const payloadStr = new TextDecoder().decode(this.base64UrlDecode(payloadB64));
    return JSON.parse(payloadStr);
  }
}
