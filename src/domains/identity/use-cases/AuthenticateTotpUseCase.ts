import { IUnitOfWork } from '../../../application/ports/output/IUnitOfWork';
import { ISecurityAuditPort } from '../../../application/ports/output/ISecurityAuditPort';
import { Result } from '../../../shared/kernel/Result';
import { AuthenticateTotpDTO } from '../../../application/dto/identity/AuthenticateTotpDTO';
import { authenticator } from 'otplib';

export class AuthenticateTotpUseCase {
  constructor(
    private readonly uow: IUnitOfWork,
    private readonly auditPort?: ISecurityAuditPort
  ) {}

  async execute(dto: AuthenticateTotpDTO): Promise<Result<{ verified: boolean; aal: number }>> {
    if (!dto.userId || !dto.code) {
      return Result.fail<{ verified: boolean; aal: number }>('Código 2FA e ID de usuário são obrigatórios.');
    }

    return await this.uow.execute(async (factory) => {
      const authRepo = factory.getAuthenticationRepository();
      const totpRecord = await authRepo.findTotpCredentialByUserId(dto.userId);

      if (!totpRecord) {
        return Result.fail<{ verified: boolean; aal: number }>('Segredo 2FA não configurado.');
      }

      const isValid = authenticator.verify({
        token: dto.code.trim(),
        secret: totpRecord.encryptedTotpSecret,
      });

      if (!isValid) {
        if (this.auditPort) {
          await this.auditPort.logEvent({
            event: 'totp_verification_failed',
            userId: dto.userId,
            metadata: { reason: 'Invalid OTP token' },
          });
        }
        return Result.fail<{ verified: boolean; aal: number }>('Código 2FA inválido.');
      }

      if (!totpRecord.verified) {
        await authRepo.verifyTotpAuthenticator(totpRecord.authenticatorId);
      }

      if (this.auditPort) {
        await this.auditPort.logEvent({
          event: 'totp_verification_succeeded',
          userId: dto.userId,
          metadata: { aal: 2 },
        });
      }

      return Result.ok<{ verified: boolean; aal: number }>({
        verified: true,
        aal: 2,
      });
    });
  }
}
