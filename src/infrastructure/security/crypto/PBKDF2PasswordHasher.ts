import { IPasswordHasher } from '../../../application/ports/security/IPasswordHasher';
import { timingSafeEqual } from './timing_safe';

export class PBKDF2PasswordHasher implements IPasswordHasher {
  async hash(password: string, existingSaltB64?: string): Promise<string> {
    const enc = new TextEncoder();
    let salt: Uint8Array;

    if (existingSaltB64) {
      const rawString = atob(existingSaltB64);
      salt = new Uint8Array(rawString.length);
      for (let i = 0; i < rawString.length; i++) {
        salt[i] = rawString.charCodeAt(i);
      }
    } else {
      salt = crypto.getRandomValues(new Uint8Array(16));
    }

    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      enc.encode(password),
      { name: 'PBKDF2' },
      false,
      ['deriveBits']
    );

    const derivedBits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
      keyMaterial,
      256
    );

    const hashArray = Array.from(new Uint8Array(derivedBits));
    const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');

    const finalSaltB64 = btoa(String.fromCharCode(...salt));
    return `${finalSaltB64}:${hashHex}`;
  }



  async verify(password: string, storedHashText: string): Promise<boolean> {
    const [saltB64, originalHex] = storedHashText.split(':');
    if (!saltB64 || !originalHex) return false;

    const newDigest = await this.hash(password, saltB64);
    return timingSafeEqual(newDigest, storedHashText);
  }
}
