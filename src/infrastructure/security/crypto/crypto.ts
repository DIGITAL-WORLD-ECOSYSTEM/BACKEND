/**
 * CryptoCore & CryptoVault
 * Web Crypto API utilities compatible with Cloudflare Workers.
 */
export class CryptoCore {
  static async verify(
    signature: Uint8Array,
    message: Uint8Array,
    publicKey: Uint8Array
  ): Promise<boolean> {
    try {
      const algorithm = { name: 'Ed25519' };
      const importedKey = await crypto.subtle.importKey('raw', publicKey, algorithm, false, [
        'verify',
      ]);
      return await crypto.subtle.verify(algorithm, importedKey, signature, message);
    } catch (e) {
      console.error('CryptoCore Error:', e);
      return false;
    }
  }
}

export class CryptoVault {
  /**
   * Deriva uma chave AES-GCM de 256 bits a partir do segredo mestre utilizando HKDF-SHA256.
   * Garante isolamento criptográfico e fail-closed para segredos vazios.
   */
  private static async deriveKey(secret: string): Promise<CryptoKey> {
    if (!secret || secret.trim().length === 0) {
      throw new Error('Chave mestra de criptografia ausente ou vazia (Fail-Closed).');
    }
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      'HKDF',
      false,
      ['deriveKey']
    );
    return await crypto.subtle.deriveKey(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: encoder.encode('asppibra-dao-web3-vault-v1'),
        info: encoder.encode('web3-custodial-wallet-aes-256-gcm'),
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  /**
   * Criptografa o texto plano e retorna o envelope segregado contendo ciphertext, nonce (IV) e authTag reais.
   */
  static async encryptEnvelope(
    text: string,
    secret: string
  ): Promise<{ ciphertext: string; nonce: string; authTag: string }> {
    const key = await this.deriveKey(secret);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoder = new TextEncoder();
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      encoder.encode(text)
    );
    const encryptedBytes = new Uint8Array(encrypted);
    const ciphertextBytes = encryptedBytes.slice(0, encryptedBytes.length - 16);
    const tagBytes = encryptedBytes.slice(encryptedBytes.length - 16);

    const toBase64 = (arr: Uint8Array) => btoa(String.fromCharCode(...arr));

    return {
      ciphertext: toBase64(ciphertextBytes),
      nonce: toBase64(iv),
      authTag: toBase64(tagBytes),
    };
  }

  /**
   * Decifra um envelope estruturado contendo ciphertext, nonce e authTag.
   */
  static async decryptEnvelope(
    envelope: { ciphertext: string; nonce: string; authTag: string },
    secret: string
  ): Promise<string> {
    const key = await this.deriveKey(secret);
    const fromBase64 = (b64: string) => {
      const bin = atob(b64);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      return arr;
    };

    const iv = fromBase64(envelope.nonce);
    const ciphertext = fromBase64(envelope.ciphertext);
    const authTag = fromBase64(envelope.authTag);

    const fullBuffer = new Uint8Array(ciphertext.length + authTag.length);
    fullBuffer.set(ciphertext, 0);
    fullBuffer.set(authTag, ciphertext.length);

    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      fullBuffer
    );
    return new TextDecoder().decode(decrypted);
  }

  static async encrypt(text: string, secret: string): Promise<string> {
    const encoder = new TextEncoder();
    const keyData = encoder.encode(secret.padEnd(32, '0').slice(0, 32));
    const key = await crypto.subtle.importKey('raw', keyData, { name: 'AES-GCM' }, false, ['encrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(text));
    const buffer = new Uint8Array(iv.length + encrypted.byteLength);
    buffer.set(iv, 0);
    buffer.set(new Uint8Array(encrypted), iv.length);
    return btoa(String.fromCharCode(...buffer));
  }

  static async decrypt(encryptedBase64: string, secret: string): Promise<string> {
    const binaryString = atob(encryptedBase64);
    const buffer = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      buffer[i] = binaryString.charCodeAt(i);
    }
    const iv = buffer.slice(0, 12);
    const data = buffer.slice(12);
    
    const encoder = new TextEncoder();
    const keyData = encoder.encode(secret.padEnd(32, '0').slice(0, 32));
    const key = await crypto.subtle.importKey('raw', keyData, { name: 'AES-GCM' }, false, ['decrypt']);
    
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
    return new TextDecoder().decode(decrypted);
  }

  static async generateEventHash(payload: any, prevHash = 'GENESIS'): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(JSON.stringify(payload) + prevHash);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
  }
}
