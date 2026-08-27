import { eq, and, sql } from 'drizzle-orm';
import { wallets } from '../../db/web3/tables';
import {
  IWeb3Repository,
  WalletRecord,
  LinkWalletData,
} from '../../application/ports/output/IWeb3Repository';

export type { WalletRecord, LinkWalletData };

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
    if (existing) return existing;

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
        isPrimary: false,
        version: 1,
      })
      .returning();

    return this.mapToRecord(newWallet);
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

