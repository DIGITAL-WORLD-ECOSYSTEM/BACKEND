import { IWeb3Repository, WalletRecord } from '../../ports/output/IWeb3Repository';
import { Result } from '../../../shared/kernel/Result';
import { UserWalletOutputDTO } from './GetUserWalletsUseCase';

export interface GetActiveWalletInputDTO {
  userId: number;
}

/**
 * Caso de Uso: Buscar Carteira Ativa / Principal do Usuário.
 */
export class GetActiveWalletUseCase {
  constructor(private readonly web3Repo: IWeb3Repository) {}

  async execute(input: GetActiveWalletInputDTO): Promise<Result<UserWalletOutputDTO | null>> {
    try {
      if (!input.userId || input.userId <= 0) {
        return Result.fail('ID de usuário inválido.');
      }

      const wallet = await this.web3Repo.findActiveByUserId(input.userId);

      if (!wallet) {
        return Result.ok(null);
      }

      const sanitized: UserWalletOutputDTO = {
        id: wallet.id,
        address: wallet.address,
        networkId: wallet.networkId,
        provenance: wallet.provenance,
        label: wallet.label,
        status: wallet.status,
        verificationStatus: wallet.verificationStatus,
        isPrimary: wallet.isPrimary,
        linkedAt: wallet.linkedAt,
      };

      return Result.ok(sanitized);
    } catch (error: any) {
      return Result.fail(`Falha ao buscar carteira ativa do usuário: ${error.message}`);
    }
  }
}
