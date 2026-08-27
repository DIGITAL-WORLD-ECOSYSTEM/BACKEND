import { IUnitOfWork } from '../../../application/ports/output/IUnitOfWork';
import { ISecurityAuditPort } from '../../../application/ports/output/ISecurityAuditPort';
import { UnlinkExternalIdentityInputDTO, UnlinkExternalIdentityOutputDTO } from '../../../application/dto/identity/UnlinkExternalIdentityDTO';
import { AntiLockoutViolationError } from '../../../domains/identity/errors/AntiLockoutViolationError';
import { Result } from '../../../shared/kernel/Result';

export class UnlinkExternalIdentityUseCase {
  constructor(
    private readonly uow: IUnitOfWork,
    private readonly securityAuditPort?: ISecurityAuditPort
  ) {}

  async execute(input: UnlinkExternalIdentityInputDTO): Promise<Result<UnlinkExternalIdentityOutputDTO>> {
    const { userId, provider, subjectId } = input;
    const now = new Date();

    return this.uow.execute(async (factory) => {
      const authRepo = factory.getAuthenticationRepository();
      const web3Repo = factory.getWeb3Repository();

      const passwordCredential = await authRepo.findPasswordCredentialByUserId(userId);
      const userWallets = await web3Repo.findByUserId(userId);

      const totalMethods = (passwordCredential ? 1 : 0) + userWallets.length;

      // Trava Anti-Lockout (AF-008)
      if (totalMethods <= 1) {
        return Result.fail<UnlinkExternalIdentityOutputDTO>(new AntiLockoutViolationError().message);
      }

      if (provider === 'web3_wallet') {
        const revoked = await web3Repo.revokeWallet(userId, subjectId);
        if (!revoked) {
          return Result.fail<UnlinkExternalIdentityOutputDTO>('Carteira não encontrada, já revogada ou indisponível.');
        }
      } else {
        return Result.fail<UnlinkExternalIdentityOutputDTO>(`Revogação não implementada para o provedor: ${provider}`);
      }

      if (this.securityAuditPort) {
        await this.securityAuditPort.logEvent({
          event: 'identity_unlinked',
          userId,
          metadata: { provider, subjectId, action: 'revoked' },
        });
      }

      return Result.ok<UnlinkExternalIdentityOutputDTO>({
        success: true,
        unlinkedAt: now,
      });
    });
  }
}
