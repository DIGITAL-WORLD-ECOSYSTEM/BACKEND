import { IUnitOfWork } from '../../../application/ports/output/IUnitOfWork';
import { Result } from '../../../shared/kernel/Result';
import { SetupTotpDTO, SetupTotpResult } from '../../../application/dto/identity/SetupTotpDTO';
import { authenticator } from 'otplib';
import { CryptoVault } from '../../../infrastructure/security/crypto/crypto';
import { AuthenticationChallenge } from '../../../domains/identity/entities/AuthenticationChallenge';

export class SetupTotpUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(dto: SetupTotpDTO): Promise<Result<SetupTotpResult>> {
    if (!dto.transactionId || !dto.encryptionKey) {
      return Result.fail<SetupTotpResult>('ID da transação e chave de encriptação são obrigatórios.');
    }

    return await this.uow.execute(async (factory) => {
      const authTxRepo = factory.getAuthTransactionRepository();
      const transaction = await authTxRepo.getTransactionById(dto.transactionId);
      const userRepo = factory.getUserRepository();
      const user = await userRepo.findById(transaction.userId);
      if (!user) {
        return Result.fail<SetupTotpResult>('Usuário não encontrado.');
      }
      
      if (!transaction || !transaction.isValid(user.authEpoch || 1)) {
        return Result.fail<SetupTotpResult>('Transação inválida ou expirada (Epoch revogado).');
      }

      if (transaction.context !== 'mfa_setup') {
        return Result.fail<SetupTotpResult>('Transação não é de setup de MFA.');
      }

      const authRepo = factory.getAuthenticationRepository();

      // Verifica se já tem TOTP
      const existingTotp = await authRepo.findTotpCredentialByUserId(user.id);
      if (existingTotp) {
        // Se já tiver e estiver verificado, não deixa configurar outro direto sem remover.
        if (existingTotp.verified) {
          return Result.fail<SetupTotpResult>('Usuário já possui TOTP ativo.');
        }
      }

      const secret = authenticator.generateSecret();
      const otpauthUrl = authenticator.keyuri(user.email || 'unknown', 'ASPPIBRA DAO', secret);

      // Criptografa o secret em repouso
      const encryptedSecret = await CryptoVault.encrypt(secret, dto.encryptionKey);

      await authRepo.saveTotpSecret(user.id, encryptedSecret);

      return Result.ok<SetupTotpResult>({
        secret,
        otpauthUrl,
      });
    });
  }
}

