import { ISecureVaultRepository, SecureVaultRecord } from '../../application/ports/output/ISecureVaultRepository';
import { secureVaults } from '../../db/ssi/tables';
import { eq } from 'drizzle-orm';

export class DrizzleSecureVaultRepositoryAdapter implements ISecureVaultRepository {
  constructor(private readonly db: any) {}

  async createVault(record: SecureVaultRecord): Promise<number> {
    const [newVault] = await this.db
      .insert(secureVaults)
      .values({
        userId: record.userId,
        purpose: record.purpose,
        ciphertext: record.ciphertext,
        nonce: record.nonce || 'default_nonce', // Ideally provided by crypto module
        authTag: record.authTag || 'default_tag', // Ideally provided by crypto module
        encryptionAlgorithm: record.encryptionAlgorithm || 'AES-256-GCM',
        keyVersion: record.keyVersion || 1,
        keyReference: record.keyReference || 'local',
        version: 1,
      })
      .returning({ id: secureVaults.id });

    return newVault.id;
  }

  async getVaultById(vaultId: number): Promise<SecureVaultRecord | null> {
    const [row] = await this.db
      .select()
      .from(secureVaults)
      .where(eq(secureVaults.id, vaultId))
      .limit(1);

    if (!row) return null;

    return {
      id: row.id,
      userId: row.userId,
      purpose: row.purpose as any,
      ciphertext: row.ciphertext,
      nonce: row.nonce,
      authTag: row.authTag,
      encryptionAlgorithm: row.encryptionAlgorithm as any,
      keyVersion: row.keyVersion,
      keyReference: row.keyReference,
      rotatedAt: row.rotatedAt,
      revokedAt: row.revokedAt,
      createdAt: row.createdAt,
    };
  }
}
