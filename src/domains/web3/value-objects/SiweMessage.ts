import { EvmAddress } from './EvmAddress';
import { Web3DomainError } from '../errors/Web3Errors';

export interface SiweMessageParams {
  domain: string;
  address: string;
  statement?: string;
  uri?: string;
  version?: string;
  chainId?: number;
  nonce: string;
  issuedAt?: Date;
  expirationTime?: Date;
}

/**
 * Value Object: SiweMessage
 * Modela a mensagem canônica no padrão EIP-4361 (Sign-In with Ethereum).
 * Garante formatação imutável e validação das regras temporais e de formato.
 */
export class SiweMessage {
  public readonly domain: string;
  public readonly address: EvmAddress;
  public readonly statement: string;
  public readonly uri: string;
  public readonly version: string;
  public readonly chainId: number;
  public readonly nonce: string;
  public readonly issuedAt: Date;
  public readonly expirationTime?: Date;

  constructor(params: SiweMessageParams) {
    if (!params.domain || params.domain.trim().length === 0) {
      throw new Web3DomainError('Domínio EIP-4361 é obrigatório.');
    }
    if (!params.nonce || params.nonce.length < 8) {
      throw new Web3DomainError('Nonce EIP-4361 inválido (mínimo de 8 caracteres alfanuméricos).');
    }

    this.domain = params.domain.trim().toLowerCase();
    this.address = EvmAddress.create(params.address);
    this.statement = params.statement || 'Assine para autenticar ou vincular sua carteira ao ecossistema.';
    this.uri = params.uri || `https://${this.domain}`;
    this.version = params.version || '1';
    this.chainId = params.chainId ?? 56; // Padrão BSC Mainnet
    this.nonce = params.nonce;
    this.issuedAt = params.issuedAt ?? new Date();
    this.expirationTime = params.expirationTime;
  }

  /**
   * Verifica se o desafio expirou.
   */
  public isExpired(now: Date = new Date()): boolean {
    if (!this.expirationTime) return false;
    return now.getTime() > this.expirationTime.getTime();
  }

  /**
   * Formata a mensagem canônica rigorosamente em conformidade com o EIP-4361.
   */
  public toMessage(): string {
    const lines: string[] = [
      `${this.domain} wants you to sign in with your Ethereum account:`,
      this.address.value,
      '',
      this.statement,
      '',
      `URI: ${this.uri}`,
      `Version: ${this.version}`,
      `Chain ID: ${this.chainId}`,
      `Nonce: ${this.nonce}`,
      `Issued At: ${this.issuedAt.toISOString()}`,
    ];

    if (this.expirationTime) {
      lines.push(`Expiration Time: ${this.expirationTime.toISOString()}`);
    }

    return lines.join('\n');
  }
}
