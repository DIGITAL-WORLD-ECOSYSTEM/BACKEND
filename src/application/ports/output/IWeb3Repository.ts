export interface WalletRecord {
  id: number;
  userId: number;
  provenance: 'internal' | 'external';
  networkId: number;
  walletType: 'eoa' | 'smart_contract';
  controlMode: 'platform_key' | 'external_user' | 'contract_controller';
  address: string;
  addressNormalized: string;
  label: string | null;
  status: 'pending' | 'active' | 'suspended' | 'revoked' | 'unlinked';
  verificationStatus: 'pending' | 'verified' | 'rejected';
  isPrimary: boolean;
  linkedAt: Date;
}

export interface LinkWalletData {
  userId: number;
  address: string;
  provenance?: 'internal' | 'external';
  networkId?: number;
  walletType?: 'eoa' | 'smart_contract';
  controlMode?: 'platform_key' | 'external_user' | 'contract_controller';
  label?: string;
}

export interface IWeb3Repository {
  findByAddress(address: string): Promise<WalletRecord | null>;
  findByUserId(userId: number): Promise<WalletRecord[]>;
  findActiveByUserId(userId: number): Promise<WalletRecord | null>;
  linkExternalWallet(data: LinkWalletData): Promise<WalletRecord>;
}
