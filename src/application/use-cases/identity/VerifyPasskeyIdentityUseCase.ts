import { IIdentityResolverPort } from '../../../application/ports/output/IIdentityResolverPort';
import { ISecurityAuditPort } from '../../../application/ports/output/ISecurityAuditPort';
import { IUnitOfWork } from '../../../application/ports/output/IUnitOfWork';
import { VerifyPasskeyIdentityInputDTO, VerifyPasskeyIdentityOutputDTO } from '../../../application/dto/identity/VerifyPasskeyIdentityDTO';
import { Result } from '../../../shared/kernel/Result';
import { verifyAuthenticationResponse } from '@simplewebauthn/server';

export class VerifyPasskeyIdentityUseCase {
  constructor(
    private readonly uow: IUnitOfWork,
    private readonly identityResolver: IIdentityResolverPort,
    private readonly securityAuditPort?: ISecurityAuditPort
  ) {}

  async execute(input: VerifyPasskeyIdentityInputDTO): Promise<Result<VerifyPasskeyIdentityOutputDTO>> {
    if (!input.challengeId || !input.responseJSON || !input.expectedOrigin || !input.expectedRPID) {
      return Result.fail<VerifyPasskeyIdentityOutputDTO>('Parâmetros de autenticação Passkey ausentes.');
    }

    return await this.uow.execute(async (factory) => {
      const authTxRepo = factory.getAuthTransactionRepository();
      const authRepo = factory.getAuthenticationRepository();

      const challenge = await authTxRepo.getChallengeById(input.challengeId);
      if (!challenge || !challenge.isValid()) {
        return Result.fail<VerifyPasskeyIdentityOutputDTO>('Challenge inválido, expirado ou já utilizado.');
      }

      if (challenge.context !== 'login') {
        return Result.fail<VerifyPasskeyIdentityOutputDTO>('Contexto do challenge não permite login via Passkey.');
      }

      const expectedChallenge = challenge.challengeHash;


      const passkeyRecord = await authRepo.findWebAuthnCredentialById(input.responseJSON.id);
      if (!passkeyRecord) {
        if (this.securityAuditPort) {
          await this.securityAuditPort.logEvent({
            event: 'authentication_failed',
            metadata: { provider: 'webauthn', credentialId: input.responseJSON.id, reason: 'Passkey record not found in DB' },
          });
        }
        return Result.fail<VerifyPasskeyIdentityOutputDTO>('Passkey não encontrada no sistema.');
      }

      const credentialID = Uint8Array.from(atob(passkeyRecord.credentialId), c => c.charCodeAt(0));
      const credentialPublicKey = Uint8Array.from(atob(passkeyRecord.publicKeyCose), c => c.charCodeAt(0));

      let verification;
      try {
        verification = await verifyAuthenticationResponse({
          response: input.responseJSON,
          expectedChallenge,
          expectedOrigin: input.expectedOrigin,
          expectedRPID: input.expectedRPID,
          credential: {
            id: passkeyRecord.credentialId,
            publicKey: credentialPublicKey,
            counter: passkeyRecord.signCount,
          },
          requireUserVerification: true, // as required for high assurance (AAL2)
        } as any);
      } catch (error: any) {
        return Result.fail<VerifyPasskeyIdentityOutputDTO>(`Falha na verificação da passkey: ${error.message}`);
      }

      if (!verification.verified || !verification.authenticationInfo) {
        return Result.fail<VerifyPasskeyIdentityOutputDTO>('Assinatura do Passkey não verificada.');
      }

      // Atomic challenge consumption AFTER successful verification
      const consumed = await authTxRepo.consumeChallengeAtomically(challenge.id);
      if (!consumed) {
        return Result.fail<VerifyPasskeyIdentityOutputDTO>('Falha de concorrência ou challenge expirado (replay attack).');
      }

      // Update signCount to prevent counter regression attacks
      await authRepo.updateWebAuthnSignCount(passkeyRecord.credentialId, verification.authenticationInfo.newCounter);


      // 1. Resolver a identidade via CanonicalIdentityResolver (AF-013)
      const resolution = await this.identityResolver.resolve({
        type: 'passkey',
        provider: 'webauthn',
        subjectId: passkeyRecord.credentialId,
        verifiedAt: new Date(),
      });

      // 2. Aplicar regra anti-shadow account (AF-009 & AF-012)
      if (resolution.status !== 'resolved') {
        if (this.securityAuditPort) {
          await this.securityAuditPort.logEvent({
            event: 'authentication_failed',
            metadata: { provider: 'webauthn', credentialId: passkeyRecord.credentialId, reason: 'Passkey not linked' },
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
          userId: resolution.userId || 0,
          metadata: { provider: 'webauthn', credentialId: passkeyRecord.credentialId },
        });
      }

      return Result.ok<VerifyPasskeyIdentityOutputDTO>({
        userId: resolution.userId || 0,
        credentialId: passkeyRecord.credentialId,
        bindingType: 'passkey',
      });
    });
  }
}
