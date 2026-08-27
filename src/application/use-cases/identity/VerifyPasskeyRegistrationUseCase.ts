import { IUnitOfWork } from '../../../application/ports/output/IUnitOfWork';
import { Result } from '../../../shared/kernel/Result';
import { verifyRegistrationResponse } from '@simplewebauthn/server';
import type { RegistrationResponseJSON } from '@simplewebauthn/types';

export interface VerifyPasskeyRegistrationDTO {
  challengeId: string;
  responseJSON: RegistrationResponseJSON;
  expectedOrigin: string;
  expectedRPID: string;
}

export class VerifyPasskeyRegistrationUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(dto: VerifyPasskeyRegistrationDTO): Promise<Result<{ authenticatorId: string }>> {
    return await this.uow.execute(async (factory) => {
      const authTxRepo = factory.getAuthTransactionRepository();
      const authRepo = factory.getAuthenticationRepository();

      const challenge = await authTxRepo.getChallengeById(dto.challengeId);
      if (!challenge || !challenge.isValid()) {
        return Result.fail<{ authenticatorId: string }>('Challenge inválido, expirado ou já utilizado.');
      }

      if (challenge.context !== 'credential_link') {
        return Result.fail<{ authenticatorId: string }>('Contexto do challenge não permite registro de Passkey.');
      }

      if (!challenge.userId) {
        return Result.fail<{ authenticatorId: string }>('Challenge não está associado a um usuário.');
      }

      const expectedChallenge = challenge.challengeHash;

      challenge.markAsUsed();
      await authTxRepo.updateChallenge(challenge);

      let verification;
      try {
        verification = await verifyRegistrationResponse({
          response: dto.responseJSON,
          expectedChallenge,
          expectedOrigin: dto.expectedOrigin,
          expectedRPID: dto.expectedRPID,
        });
      } catch (error: any) {
        return Result.fail<{ authenticatorId: string }>(`Falha na verificação da passkey: ${error.message}`);
      }

      const { verified, registrationInfo } = verification;

      if (!verified || !registrationInfo) {
        return Result.fail<{ authenticatorId: string }>('Registro de Passkey não verificado.');
      }

      const { credentialID, credentialPublicKey } = registrationInfo;

      const credentialIdStr = btoa(String.fromCharCode(...credentialID));
      const publicKeyStr = btoa(String.fromCharCode(...credentialPublicKey));

      const authenticatorId = await authRepo.saveWebAuthnCredential(
        challenge.userId,
        credentialIdStr,
        publicKeyStr,
        dto.expectedRPID
      );

      return Result.ok({
        authenticatorId,
      });
    });
  }
}
