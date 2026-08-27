import { IUnitOfWork } from '../../../application/ports/output/IUnitOfWork';
import { IPasswordHasher } from '../../../application/ports/security/IPasswordHasher';
import { ISecurityAuditPort } from '../../../application/ports/output/ISecurityAuditPort';
import { Result } from '../../../shared/kernel/Result';
import { ConfirmPasswordResetDTO } from '../../../application/dto/identity/ConfirmPasswordResetDTO';

export class ConfirmPasswordResetUseCase {
  constructor(
    private readonly uow: IUnitOfWork,
    private readonly hasher: IPasswordHasher,
    private readonly auditPort?: ISecurityAuditPort
  ) {}

  async execute(dto: ConfirmPasswordResetDTO): Promise<Result<void>> {
    if (!dto.token || !dto.newPassword) {
      return Result.fail<void>('Token e nova senha são obrigatórios.');
    }

    if (dto.newPassword.length < 8) {
      return Result.fail<void>('A senha deve ter no mínimo 8 caracteres.');
    }

    // Compute hash of provided raw token
    const tokenHashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(dto.token.trim()));
    const tokenHash = Array.from(new Uint8Array(tokenHashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');

    return await this.uow.execute(async (factory) => {
      const resetRepo = factory.getPasswordResetRepository();
      const authRepo = factory.getAuthenticationRepository();
      const userRepo = factory.getUserRepository();
      const sessionRepo = factory.getSessionRepository();

      // Atomic consume: updates usedAt if it's null, preventing race conditions
      const resetResult = await resetRepo.consumeToken(tokenHash);
      if (resetResult.isFailure || !resetResult.getValue()) {
        return Result.fail<void>('Token de redefinição inválido, expirado ou já utilizado.');
      }

      const resetRecord = resetResult.getValue();
      if (new Date(resetRecord.expiresAt) < new Date()) {
        return Result.fail<void>('Token de redefinição expirado.');
      }

      const newPasswordHash = await this.hasher.hash(dto.newPassword);
      await authRepo.savePasswordCredential(resetRecord.userId, newPasswordHash);

      // AF-008: Increment authEpoch to revoke all active user sessions globally
      if (typeof userRepo.incrementAuthEpoch === 'function') {
        await userRepo.incrementAuthEpoch(resetRecord.userId);
      }
      await sessionRepo.revokeAllUserSessions(resetRecord.userId);

      if (this.auditPort) {
        await this.auditPort.logEvent({
          event: 'password_reset_confirmed',
          userId: resetRecord.userId,
          metadata: { revokedAllSessions: true },
        });
      }

      return Result.ok();
    });
  }
}
