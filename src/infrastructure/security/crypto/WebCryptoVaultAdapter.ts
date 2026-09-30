import { ICryptoVaultPort } from '../../../application/ports/security/ICryptoVaultPort';
import { CryptoVault } from './crypto';

/**
 * WebCryptoVaultAdapter
 * Adapts the static CryptoVault to the ICryptoVaultPort interface.
 * Uses native Web Crypto API (AES-GCM 256-bit) compatible with Cloudflare Workers.
 */
export class WebCryptoVaultAdapter implements ICryptoVaultPort {
  async encrypt(text: string, secretKey: string): Promise<string> {
    return CryptoVault.encrypt(text, secretKey);
  }

  async decrypt(ciphertext: string, secretKey: string): Promise<string> {
    return CryptoVault.decrypt(ciphertext, secretKey);
  }
}
