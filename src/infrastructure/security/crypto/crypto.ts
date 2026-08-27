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
