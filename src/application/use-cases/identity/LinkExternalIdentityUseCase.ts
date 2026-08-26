import { IUnitOfWork } from '../../../application/ports/output/IUnitOfWork';
import { ISecurityAuditPort } from '../../../application/ports/output/ISecurityAuditPort';
import { LinkExternalIdentityInputDTO, LinkExternalIdentityOutputDTO } from '../../../application/dto/identity/LinkExternalIdentityDTO';
import { Result } from '../../../shared/kernel/Result';

export class LinkExternalIdentityUseCase {
  constructor(
    private readonly uow: IUnitOfWork,
    private readonly securityAuditPort?: ISecurityAuditPort
  ) {}

  async execute(input: LinkExternalIdentityInputDTO): Promise<Result<LinkExternalIdentityOutputDTO>> {
    // Exigência AAL2+ (AF-007)
    if (input.sessionAal < 2) {
      return Result.fail<LinkExternalIdentityOutputDTO>(
        'Nível de autenticação insuficiente (AAL2+ obrigatório para vincular credenciais).'
      );
    }

    const { assertion, userId } = input;
    const now = new Date();

    return this.uow.execute(async (factory) => {
      if (assertion.type === 'web3_wallet') {
        const web3Repo = factory.getWeb3Repository();
        const existing = await web3Repo.findByAddress(assertion.subjectId);

        if (existing) {
          if (existing.userId === userId) {
            return Result.ok<LinkExternalIdentityOutputDTO>({
              success: true,
              provider: 'evm',
              subjectId: assertion.subjectId,
              linkedAt: existing.linkedAt || now,
            });
          }
          return Result.fail<LinkExternalIdentityOutputDTO>('Esta carteira Web3 já está vinculada a outra conta.');
        }

        await web3Repo.linkExternalWallet({
          userId,
          address: assertion.subjectId,
          provenance: 'external',
          networkId: assertion.networkId || 1,
          walletType: 'eoa',
          controlMode: 'external_user',
        });
      }

      if (this.securityAuditPort) {
        await this.securityAuditPort.logEvent({
          event: 'identity_linked',
          userId,
          metadata: { type: assertion.type, provider: assertion.provider, subjectId: assertion.subjectId },
        });
      }

      return Result.ok<LinkExternalIdentityOutputDTO>({
        success: true,
        provider: assertion.provider,
        subjectId: assertion.subjectId,
        linkedAt: now,
      });
    });
  }
}
