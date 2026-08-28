import { IUnitOfWork } from '../../../application/ports/output/IUnitOfWork';
import { Result } from '../../../shared/kernel/Result';
import { verifyRegistrationResponse } from '@simplewebauthn/server';

export interface VerifyPasskeyRegistrationDTO {
  challengeId: string;
  responseJSON: any;
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

      // Atomic challenge consumption AFTER successful verification
      const consumed = await authTxRepo.consumeChallengeAtomically(challenge.id);
      if (!consumed) {
        return Result.fail<{ authenticatorId: string }>('Falha de concorrência ou challenge expirado (replay attack).');
      }

      const reg: any = registrationInfo;
      const credentialID = reg.credentialID || reg.credential?.id;
      const credentialPublicKey = reg.credentialPublicKey || reg.credential?.publicKey;
      const credentialBackedUp = reg.credentialBackedUp;
      const credentialDeviceType = reg.credentialDeviceType;
      const aaguid = reg.aaguid;
      const attestationObject = reg.attestationObject;

      const credentialIdStr = btoa(String.fromCharCode(...credentialID));
      const publicKeyStr = btoa(String.fromCharCode(...credentialPublicKey));
      
      // Extract attestation object if present
      let attestationObjectStr = undefined;
      let attestationFormatStr = undefined;
      if (attestationObject) {
        attestationObjectStr = btoa(String.fromCharCode(...attestationObject));
        attestationFormatStr = verification.registrationInfo?.fmt || 'none';
      }

      const authenticatorId = await authRepo.saveWebAuthnCredential(
        challenge.userId,
        credentialIdStr,
        publicKeyStr,
        dto.expectedRPID,
        true, // backupEligible is generally true for passkeys, or derived from flags
        credentialBackedUp, // backupState
        credentialDeviceType === 'singleDevice' ? false : true, // loosely inferring uvInitialized/device bounds
        aaguid,
        attestationFormatStr,
        attestationObjectStr
      );

      return Result.ok({
        authenticatorId,
      });
    });
  }
}
