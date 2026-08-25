import { eq } from 'drizzle-orm';
import { wallets } from '../../db/web3/tables';
import { Result } from '../../shared/kernel/Result';

export interface WalletRecord {
  id?: number;
  userId: number;
  provenance?: 'internal' | 'external';
  networkId: string | number;
  walletType?: 'eoa' | 'smart_account' | 'multisig';
  controlMode?: 'external_user' | 'platform_key' | 'custodial' | 'mpc';
  address: string;
  addressNormalized?: string;
  isPrimary?: boolean;
  status?: 'active' | 'suspended' | 'revoked';
  verificationStatus?: 'unverified' | 'verified';
}

export class DrizzleWalletRepository {
  constructor(private db: any) {}

  async findByAddress(address: string): Promise<Result<WalletRecord>> {
    try {
      const normalized = address.toLowerCase();
      const result = await this.db
        .select()
        .from(wallets)
        .where(eq(wallets.addressNormalized, normalized))
        .limit(1);

      if (!result || result.length === 0) {
        return Result.fail('Wallet not found');
      }

      return Result.ok(result[0]);
    } catch (error: any) {
      return Result.fail(error.message);
    }
  }

  async findByUserId(userId: number): Promise<Result<WalletRecord[]>> {
    try {
      const result = await this.db
        .select()
        .from(wallets)
        .where(eq(wallets.userId, userId));

      return Result.ok(result || []);
    } catch (error: any) {
      return Result.fail(error.message);
    }
  }

  async save(wallet: WalletRecord): Promise<Result<WalletRecord>> {
    try {
      const provenance = wallet.provenance || 'external';
      const walletType = wallet.walletType || 'eoa';
      const controlMode =
        wallet.controlMode ||
        (provenance === 'internal' ? 'platform_key' : 'external_user');
      const addressNormalized = wallet.addressNormalized || wallet.address.toLowerCase();

      if (wallet.id) {
        await this.db
          .update(wallets)
          .set({
            isPrimary: wallet.isPrimary,
            status: wallet.status,
            verificationStatus: wallet.verificationStatus,
            updatedAt: new Date(),
          })
          .where(eq(wallets.id, wallet.id));
      } else {
        const [inserted] = await this.db
          .insert(wallets)
          .values({
            userId: wallet.userId,
            provenance,
            networkId: String(wallet.networkId),
            walletType,
            controlMode,
            address: wallet.address,
            addressNormalized,
            isPrimary: wallet.isPrimary || false,
            status: wallet.status || 'active',
            verificationStatus: wallet.verificationStatus || 'verified',
            linkedAt: new Date(),
            updatedAt: new Date(),
          })
          .returning();

        wallet.id = inserted.id;
      }
      return Result.ok(wallet);
    } catch (error: any) {
      return Result.fail(error.message);
    }
  }
}
