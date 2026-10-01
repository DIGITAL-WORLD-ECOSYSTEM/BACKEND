import { IWeb3Repository } from '../../../application/ports/output/IWeb3Repository';
import { IAuthenticationRepository } from '../../../application/ports/output/IAuthenticationRepository';
import { IDomainEventPublisher } from '../../../shared/kernel/DomainEvent';
import { WalletUnlinkedDomainEvent } from '../../../domains/web3/events/WalletUnlinkedDomainEvent';
import {
  WalletNotFoundError,
  WalletOwnershipError,
  AntiLockoutViolationError,
  Web3DomainError,
} from '../../../domains/web3/errors/Web3Errors';

export interface UnlinkExternalWalletInputDTO {
  userId: number;
  address: string;
}

export interface UnlinkExternalWalletOutputDTO {
  success: boolean;
  address: string;
  unlinkedAt: Date;
}

/**
 * Caso de Uso: UnlinkExternalWalletUseCase
 * Desvincula com segurança a carteira externa do usuário autenticado.
 * Aplica a regra de segurança Anti-Lockout (impede desconectar a única credencial de login da conta).
 */
export class UnlinkExternalWalletUseCase {
  constructor(
    private readonly web3Repo: IWeb3Repository,
    private readonly authRepo?: IAuthenticationRepository,
    private readonly eventPublisher?: IDomainEventPublisher
  ) {}

  async execute(input: UnlinkExternalWalletInputDTO): Promise<UnlinkExternalWalletOutputDTO> {
    const normalized = input.address.toLowerCase().trim();

    // 1. Localiza a carteira e valida posse
    const wallet = await this.web3Repo.findByAddress(normalized);
    if (!wallet || wallet.status !== 'active') {
      throw new WalletNotFoundError(input.address);
    }

    if (wallet.userId !== input.userId) {
      throw new WalletOwnershipError(input.address);
    }

    // 2. Trava de Segurança Anti-Lockout (AF-008)
    if (this.authRepo) {
      const passwordCredential = await this.authRepo.findPasswordCredentialByUserId(input.userId);
      const userWallets = await this.web3Repo.findByUserId(input.userId);
      const webauthnCreds = await this.authRepo.findAllWebAuthnCredentialsByUserId(input.userId);

      const activeWallets = userWallets.filter((w) => w.status === 'active');
      const totalMethods = (passwordCredential ? 1 : 0) + activeWallets.length + webauthnCreds.length;

      if (totalMethods <= 1) {
        throw new AntiLockoutViolationError();
      }
    }

    // 3. Desvinculação atômica no repositório
    const unlinked = await this.web3Repo.unlinkWallet(input.userId, normalized);
    if (!unlinked) {
      throw new Web3DomainError('Falha ao desvincular a carteira especificada.');
    }

    const unlinkedAt = new Date();

    // 4. Disparo do Evento de Domínio
    if (this.eventPublisher) {
      await this.eventPublisher.publish(
        new WalletUnlinkedDomainEvent({
          userId: input.userId,
          address: normalized,
          unlinkedAt,
        })
      );
    }


    return {
      success: true,
      address: normalized,
      unlinkedAt,
    };
  }
}
