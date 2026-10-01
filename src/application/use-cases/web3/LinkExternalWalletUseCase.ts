import { IWeb3Repository, WalletRecord } from '../../../application/ports/output/IWeb3Repository';
import { IAuthTransactionRepository } from '../../../application/ports/output/IAuthTransactionRepository';
import { ISiweVerifierPort } from '../../../application/ports/security/ISiweVerifierPort';
import { IDomainEventPublisher } from '../../../shared/kernel/DomainEvent';
import { WalletLinkedDomainEvent } from '../../../domains/web3/events/WalletLinkedDomainEvent';
import {
  WalletAlreadyLinkedError,
  ExpiredChallengeError,
  InvalidSiweSignatureError,
} from '../../../domains/web3/errors/Web3Errors';

export interface LinkExternalWalletInputDTO {
  userId: number;
  challengeId: string;
  message: string;
  signature: string;
  expectedDomain: string;
  label?: string;
  isPrimary?: boolean;
}

export interface LinkExternalWalletOutputDTO {
  wallet: WalletRecord;
  address: string;
  chainId: number;
  isReactivation: boolean;
}

/**
 * Caso de Uso: LinkExternalWalletUseCase
 * Valida a assinatura criptográfica EIP-4361 (SIWE), consome o challenge de forma atômica,
 * assegura que a carteira não pertença a outro usuário e persiste no repositório Web3.
 */
export class LinkExternalWalletUseCase {
  constructor(
    private readonly web3Repo: IWeb3Repository,
    private readonly authTxRepo: IAuthTransactionRepository,
    private readonly siweVerifier: ISiweVerifierPort,
    private readonly eventPublisher?: IDomainEventPublisher
  ) {}

  async execute(input: LinkExternalWalletInputDTO): Promise<LinkExternalWalletOutputDTO> {
    if (!input.challengeId || !input.message || !input.signature) {
      throw new InvalidSiweSignatureError('Challenge ID, mensagem e assinatura são obrigatórios.');
    }

    // 1. Recupera o Desafio no Repositório de Autenticação
    const challenge = await this.authTxRepo.getChallengeById(input.challengeId);
    if (!challenge || !challenge.isValid()) {
      throw new ExpiredChallengeError();
    }

    // 2. Valida a Assinatura Criptográfica via Porta SIWE
    const verifiedData = await this.siweVerifier.verify({
      message: input.message,
      signature: input.signature,
      expectedNonce: challenge.challengeHash,
      expectedDomain: input.expectedDomain,
    });

    // 3. Consumo Atômico do Desafio (Prevenção rigorosa de Replay Attacks)
    const consumed = await this.authTxRepo.consumeChallengeAtomically(challenge.id);
    if (!consumed) {
      throw new ExpiredChallengeError();
    }

    // 4. Verificação de Posse e Conflito Anti-Colisão (Anti-Shadow Accounts)
    const existing = await this.web3Repo.findByAddress(verifiedData.address);
    let isReactivation = false;

    if (existing) {
      if (existing.userId !== input.userId) {
        throw new WalletAlreadyLinkedError(verifiedData.address);
      }
      if (existing.status !== 'active') {
        isReactivation = true;
      }
    }

    // 5. Persistência da Carteira Externa (auto-custódia, sem segredos em cofre)
    const wallet = await this.web3Repo.linkExternalWallet({
      userId: input.userId,
      address: verifiedData.address,
      provenance: 'external',
      networkId: verifiedData.chainId || 56,
      walletType: 'eoa',
      controlMode: 'external_user',
      verificationMethod: 'siwe',
      label: input.label || 'Minha Carteira Web3',
      isPrimary: input.isPrimary,
    });

    // 6. Disparo do Evento de Domínio
    if (this.eventPublisher) {
      await this.eventPublisher.publish(
        new WalletLinkedDomainEvent({
          walletId: wallet.id,
          userId: wallet.userId,
          address: wallet.address,
          networkId: wallet.networkId,
          verificationMethod: 'siwe',
          linkedAt: wallet.linkedAt,
        })
      );
    }


    return {
      wallet,
      address: verifiedData.address,
      chainId: verifiedData.chainId,
      isReactivation,
    };
  }
}
