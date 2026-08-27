import { IJwtService } from '../../../application/ports/security/IJwtService';

const DEFAULT_EXPIRES_IN_SECONDS = 86400; // 24h

export class JwtService implements IJwtService {
  private base64UrlEncode(arr: Uint8Array): string {
    return Buffer.from(arr).toString('base64url');
  }

  private base64UrlDecode(str: string): Uint8Array {
    return new Uint8Array(Buffer.from(str, 'base64url'));
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

  /**
   * Assina o payload. Se `exp`/`iat` não forem fornecidos explicitamente,
   * são preenchidos automaticamente (iat = agora, exp = agora + expiresInSeconds).
   * Isso evita a emissão silenciosa de tokens perenes (sem expiração).
   */
  async sign(
    payload: Record<string, any>,
    secret: string,
    kid: string = 'v1',
    expiresInSeconds: number = DEFAULT_EXPIRES_IN_SECONDS
  ): Promise<string> {
    if (!secret) {
      throw new Error('JWT secret ausente: assinatura recusada.');
    }

    const key = await this.getSigningKey(secret);
    const header = { alg: 'HS256', typ: 'JWT', kid };
    const enc = new TextEncoder();

    const nowSeconds = Math.floor(Date.now() / 1000);
    const fullPayload = {
      iss: 'asppibra-identity',
      aud: 'asppibra-ecosystem',
      ...payload,
      iat: typeof payload.iat === 'number' ? payload.iat : nowSeconds,
      nbf: typeof payload.nbf === 'number' ? payload.nbf : nowSeconds,
      exp: typeof payload.exp === 'number' ? payload.exp : nowSeconds + expiresInSeconds,
    };

    const encodedHeader = this.base64UrlEncode(enc.encode(JSON.stringify(header)));
    const encodedPayload = this.base64UrlEncode(enc.encode(JSON.stringify(fullPayload)));

    const signingInput = `${encodedHeader}.${encodedPayload}`;
    const signatureBuffer = await crypto.subtle.sign({ name: 'HMAC' }, key, enc.encode(signingInput));

    const encodedSignature = this.base64UrlEncode(new Uint8Array(signatureBuffer));
    return `${signingInput}.${encodedSignature}`;
  }

  /**
   * Verifica assinatura HMAC E claims temporais (exp obrigatório, nbf opcional).
   * Tokens sem `exp` são rejeitados — não é permitido emitir/aceitar tokens perenes.
   */
  async verify(token: string, secret: string): Promise<any> {
    if (!secret) {
      throw new Error('JWT secret ausente: verificação recusada.');
    }

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
    const payload = JSON.parse(payloadStr);

    const nowSeconds = Math.floor(Date.now() / 1000);

    // Bloqueia tokens perenes: exp é obrigatório.
    if (typeof payload.exp !== 'number') {
      throw new Error('Token sem claim de expiração (exp). Rejeitado.');
    }
    if (payload.exp < nowSeconds) {
      throw new Error('Token expirado.');
    }
    if (typeof payload.nbf === 'number' && payload.nbf > nowSeconds) {
      throw new Error('Token ainda não é válido (nbf).');
    }
    if (payload.iss !== 'asppibra-identity') {
      throw new Error('Token emitido por origem desconhecida (iss).');
    }
    if (payload.aud !== 'asppibra-ecosystem') {
      throw new Error('Token não destinado a este ecosistema (aud).');
    }

    return payload;
  }
}
