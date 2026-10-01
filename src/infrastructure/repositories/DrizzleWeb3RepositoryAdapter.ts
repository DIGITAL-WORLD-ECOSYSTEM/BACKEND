import { eq, and, sql } from 'drizzle-orm';
import { wallets } from '../../db/web3/tables';
import { secureVaults } from '../../db/ssi/tables';
import {
  IWeb3Repository,
  WalletRecord,
  LinkWalletData,
  CreateInternalWalletWithVaultParams,
} from '../../application/ports/output/IWeb3Repository';
import { WalletAlreadyLinkedError } from '../../domains/web3/errors/Web3Errors';


export type { WalletRecord, LinkWalletData, CreateInternalWalletWithVaultParams };

export class DrizzleWeb3RepositoryAdapter implements IWeb3Repository {
  constructor(private readonly db: any) {}

  async findByAddress(address: string): Promise<WalletRecord | null> {
    const normalized = address.toLowerCase().trim();
    const [row] = await this.db
      .select()
      .from(wallets)
      .where(eq(wallets.addressNormalized, normalized))
      .limit(1);

    if (!row) return null;
    return this.mapToRecord(row);
  }

  async findByUserId(userId: number): Promise<WalletRecord[]> {
    const rows = await this.db
      .select()
      .from(wallets)
      .where(eq(wallets.userId, userId));

    return rows.map((r: any) => this.mapToRecord(r));
  }

  async findActiveByUserId(userId: number): Promise<WalletRecord | null> {
    const [row] = await this.db
      .select()
      .from(wallets)
      .where(and(eq(wallets.userId, userId), eq(wallets.status, 'active')))
      .limit(1);

    if (!row) return null;
    return this.mapToRecord(row);
  }

  async linkExternalWallet(data: LinkWalletData): Promise<WalletRecord> {
    const addressNormalized = data.address.toLowerCase().trim();
    const existing = await this.findByAddress(addressNormalized);

    if (existing) {
      if (existing.userId !== data.userId) {
        throw new WalletAlreadyLinkedError(data.address);
      }

      // Se a carteira já pertence ao mesmo usuário e estava unlinked/revoked, reativa
      if (existing.status !== 'active') {
        const [reactivated] = await this.db
          .update(wallets)
          .set({
            status: 'active',
            verificationStatus: 'verified',
            verificationMethod: data.verificationMethod || 'siwe',
            verifiedAt: new Date(),
            lastOwnershipVerifiedAt: new Date(),
            label: data.label || existing.label,
            isPrimary: data.isPrimary ?? existing.isPrimary,
            updatedAt: new Date(),
            version: sql`${wallets.version} + 1`,
          })
          .where(eq(wallets.id, existing.id))
          .returning();

        return this.mapToRecord(reactivated);
      }

      return existing;
    }

    const [newWallet] = await this.db
      .insert(wallets)
      .values({
        userId: data.userId,
        provenance: data.provenance || 'external',
        networkId: data.networkId || 1, // Default mainnet network
        walletType: data.walletType || 'eoa',
        controlMode: data.controlMode || 'external_user',
        address: data.address,
        addressNormalized,
        label: data.label || 'Web3 Wallet',
        status: 'active',
        verificationStatus: 'verified',
        verificationMethod: data.verificationMethod || 'siwe',
        verifiedAt: new Date(),
        lastOwnershipVerifiedAt: new Date(),
        isPrimary: Boolean(data.isPrimary),
        version: 1,
      })
      .returning();

    return this.mapToRecord(newWallet);
  }


  async createInternalWallet(walletData: any): Promise<WalletRecord> {
    const [newWallet] = await this.db
      .insert(wallets)
      .values({
        ...walletData,
        version: 1,
      })
      .returning();

    return this.mapToRecord(newWallet);
  }

  async createInternalWalletWithVault(
    params: CreateInternalWalletWithVaultParams
  ): Promise<{ wallet: WalletRecord; vaultId: number }> {
    // 1. Suporte atômico nativo Cloudflare D1 via db.batch()
    if (typeof (this.db as any).batch === 'function') {
      const vaultQuery = this.db
        .insert(secureVaults)
        .values({
          userId: params.vault.userId,
          purpose: params.vault.purpose,
          ciphertext: params.vault.ciphertext,
          nonce: params.vault.nonce,
          authTag: params.vault.authTag,
          encryptionAlgorithm: params.vault.encryptionAlgorithm || 'AES-256-GCM',
          keyVersion: params.vault.keyVersion || 1,
          keyReference: params.vault.keyReference,
          version: 1,
        })
        .returning({ id: secureVaults.id });

      const walletQuery = this.db
        .insert(wallets)
        .values({
          ...params.wallet,
          version: 1,
        })
        .returning();

      const [vaultRes, walletRes] = await (this.db as any).batch([vaultQuery, walletQuery]);
      const createdVault = vaultRes[0];
      const createdWallet = walletRes[0];

      return {
        vaultId: createdVault.id,
        wallet: this.mapToRecord(createdWallet),
      };
    }

    // 2. Suporte transacional interativo SQLite local / test
    const executeTx = async (txDb: any) => {
      const [createdVault] = await txDb
        .insert(secureVaults)
        .values({
          userId: params.vault.userId,
          purpose: params.vault.purpose,
          ciphertext: params.vault.ciphertext,
          nonce: params.vault.nonce,
          authTag: params.vault.authTag,
          encryptionAlgorithm: params.vault.encryptionAlgorithm || 'AES-256-GCM',
          keyVersion: params.vault.keyVersion || 1,
          keyReference: params.vault.keyReference,
          version: 1,
        })
        .returning({ id: secureVaults.id });

      const [createdWallet] = await txDb
        .insert(wallets)
        .values({
          ...params.wallet,
          version: 1,
        })
        .returning();

      return {
        vaultId: createdVault.id,
        wallet: this.mapToRecord(createdWallet),
      };
    };

    if (typeof (this.db as any).transaction === 'function') {
      return (this.db as any).transaction(executeTx);
    }

    return executeTx(this.db);
  }

  async updateWallet(wallet: WalletRecord): Promise<WalletRecord> {
    const currentVersion = wallet.version ?? 1;

    const result = await this.db
      .update(wallets)
      .set({
        isPrimary: wallet.isPrimary,
        status: wallet.status,
        verificationStatus: wallet.verificationStatus,
        label: wallet.label,
        updatedAt: new Date(),
        version: sql`${wallets.version} + 1`,
      })
      .where(
        and(
          eq(wallets.id, wallet.id),
          eq(wallets.version, currentVersion)
        )
      )
      .returning();

    if (!result || result.length === 0) {
      throw new Error('CONCURRENT_MODIFICATION_ERROR: Wallet was updated by another process');
    }

    return this.mapToRecord(result[0]);
  }

  async revokeWallet(userId: number, address: string): Promise<boolean> {
    const addressNormalized = address.toLowerCase().trim();
    
    // Revocação atômica (AF-012)
    const result = await this.db
      .update(wallets)
      .set({ 
        status: 'revoked',
        isPrimary: false,
        updatedAt: new Date()
      })
      .where(
        and(
          eq(wallets.userId, userId),
          eq(wallets.addressNormalized, addressNormalized),
          eq(wallets.status, 'active') // Só revoga se estiver ativa
        )
      )
      .returning();
      
    return result.length > 0;
  }

  async unlinkWallet(userId: number, address: string): Promise<boolean> {
    const addressNormalized = address.toLowerCase().trim();

    const result = await this.db
      .update(wallets)
      .set({
        status: 'unlinked',
        isPrimary: false,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(wallets.userId, userId),
          eq(wallets.addressNormalized, addressNormalized),
          eq(wallets.status, 'active')
        )
      )
      .returning();

    return result.length > 0;
  }

  async setPrimaryWallet(userId: number, address: string): Promise<boolean> {
    const addressNormalized = address.toLowerCase().trim();

    // 1. Verifica se a carteira alvo existe, pertence ao usuário e está ativa
    const targetWallet = await this.db
      .select()
      .from(wallets)
      .where(
        and(
          eq(wallets.userId, userId),
          eq(wallets.addressNormalized, addressNormalized),
          eq(wallets.status, 'active')
        )
      )
      .limit(1);

    if (!targetWallet || targetWallet.length === 0) {
      return false;
    }

    // 2. Operação atômica D1 batch ou SQLite transaction
    if (typeof (this.db as any).batch === 'function') {
      const resetQuery = this.db
        .update(wallets)
        .set({ isPrimary: false, updatedAt: new Date() })
        .where(eq(wallets.userId, userId));

      const setQuery = this.db
        .update(wallets)
        .set({ isPrimary: true, updatedAt: new Date() })
        .where(
          and(
            eq(wallets.userId, userId),
            eq(wallets.addressNormalized, addressNormalized)
          )
        );

      await (this.db as any).batch([resetQuery, setQuery]);
      return true;
    }

    const executeTx = async (txDb: any) => {
      await txDb
        .update(wallets)
        .set({ isPrimary: false, updatedAt: new Date() })
        .where(eq(wallets.userId, userId));

      await txDb
        .update(wallets)
        .set({ isPrimary: true, updatedAt: new Date() })
        .where(
          and(
            eq(wallets.userId, userId),
            eq(wallets.addressNormalized, addressNormalized)
          )
        );

      return true;
    };

    if (typeof (this.db as any).transaction === 'function') {
      return (this.db as any).transaction(executeTx);
    }

    return executeTx(this.db);
  }


  private mapToRecord(raw: any): WalletRecord {
    return {
      id: raw.id,
      userId: raw.userId,
      provenance: raw.provenance,
      networkId: raw.networkId,
      walletType: raw.walletType,
      controlMode: raw.controlMode,
      address: raw.address,
      addressNormalized: raw.addressNormalized,
      label: raw.label || null,
      status: raw.status,
      verificationStatus: raw.verificationStatus,
      isPrimary: Boolean(raw.isPrimary),
      linkedAt: raw.linkedAt instanceof Date ? raw.linkedAt : new Date(raw.linkedAt || Date.now()),
      version: raw.version || 1,
    };
  }
}

