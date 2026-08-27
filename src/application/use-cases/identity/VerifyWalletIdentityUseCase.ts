import { ISiweVerifierPort } from '../../../application/ports/security/ISiweVerifierPort';
import { IIdentityResolverPort } from '../../../application/ports/output/IIdentityResolverPort';
import { ISecurityAuditPort } from '../../../application/ports/output/ISecurityAuditPort';
import { IUnitOfWork } from '../../../application/ports/output/IUnitOfWork';
import { VerifyWalletIdentityInputDTO, VerifyWalletIdentityOutputDTO } from '../../../application/dto/identity/VerifyWalletIdentityDTO';
import { Result } from '../../../shared/kernel/Result';

export class VerifyWalletIdentityUseCase {
  constructor(
    private readonly uow: IUnitOfWork,
    private readonly siweVerifier: ISiweVerifierPort,
    private readonly identityResolver: IIdentityResolverPort,
    private readonly securityAuditPort?: ISecurityAuditPort
  ) {}

  async execute(input: VerifyWalletIdentityInputDTO): Promise<Result<VerifyWalletIdentityOutputDTO>> {
    try {
      if (!input.challengeId) {
        return Result.fail<VerifyWalletIdentityOutputDTO>('ID do Challenge é obrigatório.');
      }

      return await this.uow.execute(async (factory) => {
        const authTxRepo = factory.getAuthTransactionRepository();
        
        // Load Challenge
        const challenge = await authTxRepo.getChallengeById(input.challengeId);
        if (!challenge || !challenge.isValid()) {
          return Result.fail<VerifyWalletIdentityOutputDTO>('Challenge inválido, expirado ou já utilizado.');
        }

        if (challenge.context !== 'login' && challenge.context !== 'credential_link') {
          return Result.fail<VerifyWalletIdentityOutputDTO>('Contexto do challenge não permite autenticação SIWE aqui.');
        }

        // 1. Verificar a assinatura EIP-4361 usando o nonce atrelado ao challenge
        const verifiedData = await this.siweVerifier.verify({
          message: input.message,
          signature: input.signature,
          expectedNonce: challenge.challengeHash,
          expectedDomain: input.expectedDomain, // Este valor agora será o env do server
        });

        // Atomic challenge consumption AFTER successful verification
        const consumed = await authTxRepo.consumeChallengeAtomically(challenge.id);
        if (!consumed) {
          return Result.fail<VerifyWalletIdentityOutputDTO>('Falha de concorrência ou challenge expirado (replay attack).');
        }

        // 2. Resolver a identidade via CanonicalIdentityResolver (AF-013)
        const resolution = await this.identityResolver.resolve({
          type: 'web3_wallet',
          provider: 'evm',
          subjectId: verifiedData.address,
          networkId: verifiedData.chainId,
          verifiedAt: new Date(),
        });

        // 3. Aplicar regra anti-shadow account (AF-010 & AF-012)
        if (resolution.status === 'not_linked' && challenge.context === 'login') {
          if (this.securityAuditPort) {
            await this.securityAuditPort.logEvent({
              event: 'authentication_failed',
              metadata: { provider: 'evm', address: verifiedData.address, reason: 'Identity not linked' },
            });
          }
          return Result.fail<VerifyWalletIdentityOutputDTO>(
            'Carteira Web3 não vinculada a nenhuma conta existente. Efetue login e vincule a carteira nas configurações.'
          );
        }

        // 4. Auditoria de sucesso
        if (this.securityAuditPort) {
          await this.securityAuditPort.logEvent({
            event: 'authentication_succeeded',
            userId: resolution.userId || 0,
            metadata: { provider: 'evm', address: verifiedData.address },
          });
        }

        return Result.ok<VerifyWalletIdentityOutputDTO>({
          userId: resolution.userId || 0,
          address: verifiedData.address,
          chainId: verifiedData.chainId,
          bindingType: 'web3_wallet',
        });
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Falha ao autenticar carteira Web3.';
      return Result.fail<VerifyWalletIdentityOutputDTO>(message);
    }
  }
}

