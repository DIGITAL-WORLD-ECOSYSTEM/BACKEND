import { IUnitOfWork } from '../../../application/ports/output/IUnitOfWork';
import { ISecurityAuditPort } from '../../../application/ports/output/ISecurityAuditPort';
import { Result } from '../../../shared/kernel/Result';
import { AuthenticateTotpDTO } from '../../../application/dto/identity/AuthenticateTotpDTO';
import { authenticator } from 'otplib';
import { CryptoVault } from '../../../infrastructure/security/crypto/crypto';

export class AuthenticateTotpUseCase {
  constructor(
    private readonly uow: IUnitOfWork,
    private readonly auditPort?: ISecurityAuditPort
  ) {}

  async execute(dto: AuthenticateTotpDTO): Promise<Result<{ verified: boolean; aal: number }>> {
    if (!dto.transactionId || !dto.code || !dto.encryptionKey) {
      return Result.fail<{ verified: boolean; aal: number }>('Transação, chave e código são obrigatórios.');
    }

    return await this.uow.execute(async (factory) => {
      const authTxRepo = factory.getAuthTransactionRepository();
      const transaction = await authTxRepo.getTransactionById(dto.transactionId);
      
      if (!transaction || !transaction.isValid(transaction.authEpochAtStart)) {
        return Result.fail<{ verified: boolean; aal: number }>('Transação inválida ou expirada.');
      }

      if (transaction.context !== 'login' && transaction.context !== 'mfa_setup' && transaction.context !== 'sensitive_operation') {
        return Result.fail<{ verified: boolean; aal: number }>('Transação não permite TOTP verification neste contexto.');
      }

      const authRepo = factory.getAuthenticationRepository();
      const totpRecord = await authRepo.findTotpCredentialByUserId(transaction.userId);

      if (!totpRecord) {
        return Result.fail<{ verified: boolean; aal: number }>('Segredo 2FA não configurado.');
      }

      let secret = '';
      try {
        secret = await CryptoVault.decrypt(totpRecord.encryptedTotpSecret, dto.encryptionKey);
      } catch (e) {
        return Result.fail<{ verified: boolean; aal: number }>('Falha ao descriptografar TOTP Secret.');
      }

      const isValid = authenticator.verify({
        token: dto.code.trim(),
        secret,
      });

      if (!isValid) {
        transaction.recordFailure();
        await authTxRepo.updateTransaction(transaction);

        if (this.auditPort) {
          await this.auditPort.logEvent({
            event: 'totp_verification_failed',
            userId: transaction.userId,
            metadata: { reason: 'Invalid OTP token', transactionId: transaction.id },
          });
        }
        return Result.fail<{ verified: boolean; aal: number }>(transaction.status === 'locked' ? 'Transação bloqueada por excesso de tentativas.' : 'Código 2FA inválido.');
      }

      if (!totpRecord.verified) {
        await authRepo.verifyTotpAuthenticator(totpRecord.authenticatorId);
      }

      transaction.verifyFactor('totp', 2);
      await authTxRepo.updateTransaction(transaction);

      if (this.auditPort) {
        await this.auditPort.logEvent({
          event: 'totp_verification_succeeded',
          userId: transaction.userId,
          metadata: { aal: 2, transactionId: transaction.id },
        });
      }

      return Result.ok<{ verified: boolean; aal: number }>({
        verified: true,
        aal: 2,
      });
    });
  }
}

