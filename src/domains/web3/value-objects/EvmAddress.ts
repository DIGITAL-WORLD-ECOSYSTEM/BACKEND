import { getAddress } from 'viem';
import { InvalidEvmAddressError } from '../errors/Web3Errors';

const EVM_ADDRESS_REGEX = /^0x[0-9a-fA-F]{40}$/;

/**
 * Value Object: EvmAddress
 * Encapsula validação estrita de formato de endereço EVM (Ethereum / BSC),
 * garante formatação canônica EIP-55 (checksummed) e consistência de normalização (lowercase).
 */
export class EvmAddress {
  private readonly _checksummedAddress: string;
  private readonly _normalizedAddress: string;

  private constructor(address: string) {
    if (!address || !EVM_ADDRESS_REGEX.test(address)) {
      throw new InvalidEvmAddressError(address);
    }
    this._checksummedAddress = getAddress(address);
    this._normalizedAddress = address.toLowerCase();
  }

  public static create(address: string): EvmAddress {
    return new EvmAddress(address);
  }

  public static isValid(address: string): boolean {
    return typeof address === 'string' && EVM_ADDRESS_REGEX.test(address);
  }

  public get value(): string {
    return this._checksummedAddress;
  }

  public get normalized(): string {
    return this._normalizedAddress;
  }

  public equals(other: EvmAddress | string): boolean {
    const otherNormalized = typeof other === 'string' ? other.toLowerCase() : other.normalized;
    return this._normalizedAddress === otherNormalized;
  }

  public toString(): string {
    return this._checksummedAddress;
  }
}
