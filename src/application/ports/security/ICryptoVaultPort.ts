export interface CryptoEnvelope {
  ciphertext: string;
  nonce: string;
  authTag: string;
}

export interface ICryptoVaultPort {
  encrypt(text: string, secretKey: string): Promise<string>;
  decrypt(ciphertext: string, secretKey: string): Promise<string>;
  encryptEnvelope(text: string, secretKey: string): Promise<CryptoEnvelope>;
  decryptEnvelope(envelope: CryptoEnvelope, secretKey: string): Promise<string>;
}

