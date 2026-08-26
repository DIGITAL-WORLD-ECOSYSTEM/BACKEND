import { IIdentityResolverPort } from '../../../application/ports/output/IIdentityResolverPort';
import { ISecurityAuditPort } from '../../../application/ports/output/ISecurityAuditPort';
import { VerifyPasskeyIdentityInputDTO, VerifyPasskeyIdentityOutputDTO } from '../../../application/dto/identity/VerifyPasskeyIdentityDTO';
import { Result } from '../../../shared/kernel/Result';

export class VerifyPasskeyIdentityUseCase {
  constructor(
    private readonly identityResolver: IIdentityResolverPort,
    private readonly securityAuditPort?: ISecurityAuditPort
  ) {}

  async execute(input: VerifyPasskeyIdentityInputDTO): Promise<Result<VerifyPasskeyIdentityOutputDTO>> {
    if (!input.credentialId) {
      return Result.fail<VerifyPasskeyIdentityOutputDTO>('ID de credencial Passkey obrigatório.');
    }

    // 1. Resolver a identidade via CanonicalIdentityResolver (AF-013)
    const resolution = await this.identityResolver.resolve({
      type: 'passkey',
      provider: 'webauthn',
      subjectId: input.credentialId,
      verifiedAt: new Date(),
    });

    // 2. Aplicar regra anti-shadow account (AF-009 & AF-012)
    if (resolution.status === 'not_linked') {
      if (this.securityAuditPort) {
        await this.securityAuditPort.logEvent({
          event: 'authentication_failed',
          metadata: { provider: 'webauthn', credentialId: input.credentialId, reason: 'Passkey not linked' },
        });
      }
      return Result.fail<VerifyPasskeyIdentityOutputDTO>(
        'Passkey não vinculada a nenhuma conta existente. Efetue login e vincule a passkey nas configurações.'
      );
    }

    // 3. Auditoria de sucesso
    if (this.securityAuditPort) {
      await this.securityAuditPort.logEvent({
        event: 'authentication_succeeded',
        userId: resolution.userId,
        metadata: { provider: 'webauthn', credentialId: input.credentialId },
      });
    }

    return Result.ok<VerifyPasskeyIdentityOutputDTO>({
      userId: resolution.userId,
      credentialId: input.credentialId,
      bindingType: 'passkey',
    });
  }
}
