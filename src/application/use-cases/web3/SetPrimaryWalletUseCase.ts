import { IWeb3Repository } from '../../../application/ports/output/IWeb3Repository';
import {
  WalletNotFoundError,
  WalletOwnershipError,
  WalletSuspendedError,
  Web3DomainError,
} from '../../../domains/web3/errors/Web3Errors';

export interface SetPrimaryWalletInputDTO {
  userId: number;
  address: string;
}

export interface SetPrimaryWalletOutputDTO {
  success: boolean;
  address: string;
  isPrimary: boolean;
}

/**
 * Caso de Uso: SetPrimaryWalletUseCase
 * Permite que o usuário defina uma carteira ativa específica como sua carteira primária.
 * Desmarca as outras carteiras do usuário de forma atômica.
 */
export class SetPrimaryWalletUseCase {
  constructor(private readonly web3Repo: IWeb3Repository) {}

  async execute(input: SetPrimaryWalletInputDTO): Promise<SetPrimaryWalletOutputDTO> {
    const normalized = input.address.toLowerCase().trim();

    const wallet = await this.web3Repo.findByAddress(normalized);
    if (!wallet) {
      throw new WalletNotFoundError(input.address);
    }

    if (wallet.userId !== input.userId) {
      throw new WalletOwnershipError(input.address);
    }

    if (wallet.status !== 'active') {
      throw new WalletSuspendedError(wallet.id);
    }

    const success = await this.web3Repo.setPrimaryWallet(input.userId, normalized);
    if (!success) {
      throw new Web3DomainError('Não foi possível definir a carteira como primária.');
    }

    return {
      success: true,
      address: normalized,
      isPrimary: true,
    };
  }
}
