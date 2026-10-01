export interface SecureVaultRecord {
  id?: number;
  userId: number;
  purpose: 'wallet_mnemonic' | 'recovery_material' | 'private_key' | 'identity_seed';
  ciphertext: string;
  nonce?: string;
  authTag?: string;
  encryptionAlgorithm?: 'AES-256-GCM' | 'XChaCha20-Poly1305';
  keyVersion?: number;
  keyReference?: string;
  rotatedAt?: Date | null;
  revokedAt?: Date | null;
  createdAt?: Date;
}

export interface ISecureVaultRepository {
  /**
   * Guarda um novo segredo no cofre do usuário.
   * @param record Dados da cifra e finalidade.
   * @returns O ID do cofre recém-criado, que será usado como keyReference em tabelas públicas.
   */
  createVault(record: SecureVaultRecord): Promise<number>;

  /**
   * Recupera um cofre seguro pelo seu ID.
   * @param vaultId O ID do cofre.
   */
  getVaultById(vaultId: number): Promise<SecureVaultRecord | null>;

  /**
   * Recupera um cofre seguro pelo seu identificador único de referência (UUID).
   * @param keyReference A chave de referência única vinculada à carteira.
   */
  findByKeyReference(keyReference: string): Promise<SecureVaultRecord | null>;
}
