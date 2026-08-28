import { IUnitOfWork } from '../../../application/ports/output/IUnitOfWork';
import { ISecurityAuditPort } from '../../../application/ports/output/ISecurityAuditPort';
import { Result } from '../../../shared/kernel/Result';
import { AuthenticateTotpDTO } from '../../../application/dto/identity/AuthenticateTotpDTO';
import { authenticator } from 'otplib';
import { ICryptoVaultPort } from '../../../application/ports/security/ICryptoVaultPort';

export class AuthenticateTotpUseCase {
  constructor(
    private readonly uow: IUnitOfWork,
    private readonly auditPort?: ISecurityAuditPort,
    private readonly cryptoVault?: ICryptoVaultPort
  ) {}

  private async decryptSecret(ciphertext: string, secretKey: string): Promise<string> {
    if (this.cryptoVault) {
      return this.cryptoVault.decrypt(ciphertext, secretKey);
    }
    const binaryString = atob(ciphertext);
    const buffer = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      buffer[i] = binaryString.charCodeAt(i);
    }
    const iv = buffer.slice(0, 12);
    const data = buffer.slice(12);
    const encoder = new TextEncoder();
    const keyData = encoder.encode(secretKey.padEnd(32, '0').slice(0, 32));
    const key = await crypto.subtle.importKey('raw', keyData, { name: 'AES-GCM' }, false, ['decrypt']);
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
    return new TextDecoder().decode(decrypted);
  }

  async execute(dto: AuthenticateTotpDTO): Promise<Result<{ verified: boolean; aal: number }>> {
    if (!dto.transactionId || !dto.code || !dto.encryptionKey) {
      return Result.fail<{ verified: boolean; aal: number }>('Transação, chave e código são obrigatórios.');
    }

    return await this.uow.execute(async (factory) => {
      const authTxRepo = factory.getAuthTransactionRepository();
      const transaction = await authTxRepo.getTransactionById(dto.transactionId);
      const userRepo = factory.getUserRepository();
      const user = await userRepo.findById(transaction?.userId || 0);
      if (!user) {
        return Result.fail<{ verified: boolean; aal: number }>('Usuário não encontrado.');
      }
      
      if (!transaction || !transaction.isValid(user.authEpoch || 1)) {
        return Result.fail<{ verified: boolean; aal: number }>('Transação inválida ou expirada (Epoch revogado).');
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
        secret = await this.decryptSecret(totpRecord.encryptedTotpSecret, dto.encryptionKey);
      } catch (e) {
        return Result.fail<{ verified: boolean; aal: number }>('Falha ao descriptografar TOTP Secret.');
      }

      const isValid = authenticator.verify({
        token: dto.code.trim(),
        secret,
      });

      if (!isValid) {
        const recorded = await authTxRepo.recordFailedAttemptAtomically(transaction.id, 5);
        if (!recorded) {
          return Result.fail<{ verified: boolean; aal: number }>('Falha ao registrar tentativa (transação expirada ou finalizada).');
        }

        if (this.auditPort) {
          await this.auditPort.logEvent({
            event: 'totp_verification_failed',
            userId: transaction.userId,
            metadata: { reason: 'Invalid OTP token', transactionId: transaction.id },
          });
        }
        return Result.fail<{ verified: boolean; aal: number }>('Código 2FA inválido.');
      }

      if (!totpRecord.verified) {
        await authRepo.verifyTotpAuthenticator(totpRecord.authenticatorId);
      }

      const completed = await authTxRepo.completeFactorAtomically(transaction.id, 2, transaction.authEpochAtStart, 'totp');
      if (!completed) {
        return Result.fail<{ verified: boolean; aal: number }>('Falha de concorrência ou transação inválida no D1.');
      }

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

