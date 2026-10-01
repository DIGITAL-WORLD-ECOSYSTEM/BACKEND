import { EvmAddress } from '../value-objects/EvmAddress';
import { ChainNetwork } from '../value-objects/ChainNetwork';
import { WalletSuspendedError } from '../errors/Web3Errors';

export type WalletProvenance = 'internal' | 'external';
export type WalletType = 'eoa' | 'smart_contract';
export type WalletControlMode = 'platform_key' | 'external_user' | 'contract_controller';
export type WalletStatus = 'pending' | 'active' | 'suspended' | 'revoked' | 'unlinked';
export type WalletVerificationStatus = 'pending' | 'verified' | 'rejected';
export type WalletVerificationMethod = 'signature' | 'siwe' | 'micro_deposit' | 'system' | 'admin';
export type WalletKeyProvider = 'secure_vault' | 'hsm' | 'external_kms' | 'user_custody';

export interface WalletProps {
  id: number;
  userId: number;
  provenance: WalletProvenance;
  networkId: number;
  walletType: WalletType;
  controlMode: WalletControlMode;
  address: EvmAddress;
  label?: string | null;
  status: WalletStatus;
  verificationStatus: WalletVerificationStatus;
  verificationMethod?: WalletVerificationMethod | null;
  verifiedAt?: Date | null;
  lastOwnershipVerifiedAt?: Date | null;
  keyProvider?: WalletKeyProvider | null;
  keyReference?: string | null;
  isPrimary: boolean;
  linkedAt: Date;
  version: number;
}

/**
 * Entidade de Domínio: Wallet
 * Modela a carteira Web3 do ecossistema, garantindo regras de negócio,
 * invariantes de verificação e controle de ciclo de vida.
 */
export class Wallet {
  private props: WalletProps;

  constructor(props: WalletProps) {
    this.props = { ...props };
  }

  public get id(): number {
    return this.props.id;
  }

  public get userId(): number {
    return this.props.userId;
  }

  public get provenance(): WalletProvenance {
    return this.props.provenance;
  }

  public get networkId(): number {
    return this.props.networkId;
  }

  public get walletType(): WalletType {
    return this.props.walletType;
  }

  public get controlMode(): WalletControlMode {
    return this.props.controlMode;
  }

  public get address(): EvmAddress {
    return this.props.address;
  }

  public get label(): string | null {
    return this.props.label || null;
  }

  public get status(): WalletStatus {
    return this.props.status;
  }

  public get verificationStatus(): WalletVerificationStatus {
    return this.props.verificationStatus;
  }

  public get isPrimary(): boolean {
    return this.props.isPrimary;
  }

  public get keyReference(): string | null {
    return this.props.keyReference || null;
  }

  public get keyProvider(): WalletKeyProvider | null {
    return this.props.keyProvider || null;
  }

  public get linkedAt(): Date {
    return this.props.linkedAt;
  }

  public get version(): number {
    return this.props.version;
  }

  /**
   * Verifica se a carteira está apta para operar (transacionar/assinar).
   */
  public isUsable(): boolean {
    return this.props.status === 'active' && this.props.verificationStatus === 'verified';
  }

  public assertUsable(): void {
    if (!this.isUsable()) {
      throw new WalletSuspendedError(this.props.id);
    }
  }

  public activate(): void {
    this.props.status = 'active';
  }

  public suspend(): void {
    this.props.status = 'suspended';
  }

  public revoke(): void {
    this.props.status = 'revoked';
  }

  public unlink(): void {
    this.props.status = 'unlinked';
    this.props.isPrimary = false;
  }

  public setPrimary(isPrimary: boolean): void {
    this.props.isPrimary = isPrimary;
  }

  public setLabel(label: string): void {
    this.props.label = label;
  }

  /**
   * Factory method para instanciar carteiras externas validadas via SIWE / auto-custódia.
   */
  public static createExternal(params: {
    id: number;
    userId: number;
    address: EvmAddress;
    networkId?: number;
    label?: string | null;
    isPrimary?: boolean;
    linkedAt?: Date;
    version?: number;
  }): Wallet {
    return new Wallet({
      id: params.id,
      userId: params.userId,
      provenance: 'external',
      networkId: params.networkId ?? 1,
      walletType: 'eoa',
      controlMode: 'external_user',
      address: params.address,
      label: params.label ?? 'External Web3 Wallet',
      status: 'active',
      verificationStatus: 'verified',
      verificationMethod: 'siwe',
      verifiedAt: new Date(),
      lastOwnershipVerifiedAt: new Date(),
      keyProvider: null,
      keyReference: null,
      isPrimary: Boolean(params.isPrimary),
      linkedAt: params.linkedAt ?? new Date(),
      version: params.version ?? 1,
    });
  }
}

