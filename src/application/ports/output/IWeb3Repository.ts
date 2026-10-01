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
  verificationMethod?: 'signature' | 'siwe' | 'micro_deposit' | 'system' | 'admin';
  verifiedAt?: Date;
  lastOwnershipVerifiedAt?: Date;
  keyProvider?: 'secure_vault' | 'hsm' | 'external_kms' | 'user_custody';
  keyReference?: string;
  isPrimary: boolean;
  linkedAt: Date;
  version?: number;
}

export interface LinkWalletData {
  userId: number;
  address: string;
  provenance?: 'internal' | 'external';
  networkId?: number;
  walletType?: 'eoa' | 'smart_contract';
  controlMode?: 'platform_key' | 'external_user' | 'contract_controller';
  verificationMethod?: 'signature' | 'siwe' | 'micro_deposit' | 'system' | 'admin';
  label?: string;
  isPrimary?: boolean;
}

export interface CreateInternalWalletWithVaultParams {
  vault: {
    userId: number;
    purpose: 'private_key';
    ciphertext: string;
    nonce: string;
    authTag: string;
    keyReference: string;
    encryptionAlgorithm?: 'AES-256-GCM';
    keyVersion?: number;
  };
  wallet: {
    userId: number;
    networkId: number;
    provenance: 'internal';
    walletType: 'eoa';
    controlMode: 'platform_key';
    address: string;
    addressNormalized: string;
    label: string;
    isPrimary: boolean;
    keyProvider: 'secure_vault';
    keyReference: string;
    status: 'pending' | 'active';
    verificationStatus: 'verified';
    verificationMethod: 'system';
    verifiedAt: Date;
    lastOwnershipVerifiedAt: Date;
  };
}

export interface IWeb3Repository {
  findByAddress(address: string): Promise<WalletRecord | null>;
  findByUserId(userId: number): Promise<WalletRecord[]>;
  findActiveByUserId(userId: number): Promise<WalletRecord | null>;
  linkExternalWallet(data: LinkWalletData): Promise<WalletRecord>;
  createInternalWallet(wallet: Partial<WalletRecord>): Promise<WalletRecord>;
  createInternalWalletWithVault(params: CreateInternalWalletWithVaultParams): Promise<{ wallet: WalletRecord; vaultId: number }>;
  updateWallet(wallet: WalletRecord): Promise<WalletRecord>;
  revokeWallet(userId: number, address: string): Promise<boolean>;
  unlinkWallet(userId: number, address: string): Promise<boolean>;
  setPrimaryWallet(userId: number, address: string): Promise<boolean>;
}



