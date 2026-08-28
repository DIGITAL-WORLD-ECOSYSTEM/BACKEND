export interface ICryptoVaultPort {
  encrypt(text: string, secretKey: string): Promise<string>;
  decrypt(ciphertext: string, secretKey: string): Promise<string>;
}
