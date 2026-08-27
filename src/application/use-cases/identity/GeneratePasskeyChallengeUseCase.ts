import { IUnitOfWork } from '../../../application/ports/output/IUnitOfWork';
import { Result } from '../../../shared/kernel/Result';
import { AuthenticationChallenge } from '../../../domains/identity/entities/AuthenticationChallenge';
import { generateRegistrationOptions, generateAuthenticationOptions } from '@simplewebauthn/server';

export interface GeneratePasskeyChallengeDTO {
  context: 'login' | 'credential_link';
  transactionId?: string;
  userId?: number;
  userName?: string;
  rpID: string;
  rpName: string;
}

export class GeneratePasskeyChallengeUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(dto: GeneratePasskeyChallengeDTO): Promise<Result<{ challengeId: string; options: any }>> {
    return await this.uow.execute(async (factory) => {
      const authTxRepo = factory.getAuthTransactionRepository();

      let options: any;

      if (dto.context === 'credential_link') {
        if (!dto.userId || !dto.userName) {
          return Result.fail<{ challengeId: string; options: any }>('UserId e UserName são obrigatórios para credential_link');
        }

        const authRepo = factory.getAuthenticationRepository();
        const existingPasskeys = await authRepo.findAllWebAuthnCredentialsByUserId(dto.userId);

        options = await generateRegistrationOptions({
          rpName: dto.rpName,
          rpID: dto.rpID,
          userID: Uint8Array.from(dto.userId.toString(), c => c.charCodeAt(0)),
          userName: dto.userName,
          attestationType: 'none',
          excludeCredentials: existingPasskeys.map(key => ({
            id: Uint8Array.from(atob(key.credentialId), c => c.charCodeAt(0)),
            type: 'public-key',
            transports: ['internal', 'hybrid', 'usb', 'ble', 'nfc'],
          })),
          authenticatorSelection: {
            residentKey: 'required',
            userVerification: 'preferred',
          }
        });
      } else {
        options = await generateAuthenticationOptions({
          rpID: dto.rpID,
          userVerification: 'preferred',
        });
      }

      const challengeId = crypto.randomUUID();
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 5 * 60 * 1000); // 5 minutes

      const challenge = new AuthenticationChallenge({
        id: challengeId,
        transactionId: dto.transactionId || null,
        userId: dto.userId || null,
        challengeHash: options.challenge, // We store the plain challenge here for simplewebauthn
        challengeType: 'webauthn',
        context: dto.context,
        createdAt: now,
        expiresAt,
      });

      await authTxRepo.createChallenge(challenge);

      return Result.ok({
        challengeId,
        options,
      });
    });
  }
}
