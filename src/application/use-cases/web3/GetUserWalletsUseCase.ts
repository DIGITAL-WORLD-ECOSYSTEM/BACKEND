import { IWeb3Repository, WalletRecord } from '../../ports/output/IWeb3Repository';
import { Result } from '../../../shared/kernel/Result';

export interface GetUserWalletsInputDTO {
  userId: number;
}

export interface UserWalletOutputDTO {
  id: number;
  address: string;
  networkId: number;
  provenance: 'internal' | 'external';
  label: string | null;
  status: string;
  verificationStatus: string;
  isPrimary: boolean;
  linkedAt: Date;
}

/**
 * Caso de Uso: Listar Carteiras do Usuário Autenticado.
 * Retorna todas as carteiras vinculadas ou criadas para a conta.
 */
export class GetUserWalletsUseCase {
  constructor(private readonly web3Repo: IWeb3Repository) {}

  async execute(input: GetUserWalletsInputDTO): Promise<Result<UserWalletOutputDTO[]>> {
    try {
      if (!input.userId || input.userId <= 0) {
        return Result.fail('ID de usuário inválido.');
      }

      const wallets = await this.web3Repo.findByUserId(input.userId);

      const sanitized: UserWalletOutputDTO[] = wallets.map((w: WalletRecord) => ({
        id: w.id,
        address: w.address,
        networkId: w.networkId,
        provenance: w.provenance,
        label: w.label,
        status: w.status,
        verificationStatus: w.verificationStatus,
        isPrimary: w.isPrimary,
        linkedAt: w.linkedAt,
      }));

      return Result.ok(sanitized);
    } catch (error: any) {
      return Result.fail(`Falha ao buscar carteiras do usuário: ${error.message}`);
    }
  }
}
