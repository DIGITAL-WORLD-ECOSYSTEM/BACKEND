import { IUnitOfWork } from '../../../application/ports/output/IUnitOfWork';
import { Result } from '../../../shared/kernel/Result';
import { SetupTotpDTO, SetupTotpResult } from '../../../application/dto/identity/SetupTotpDTO';
import { authenticator } from 'otplib';
import { ICryptoVaultPort } from '../../../application/ports/security/ICryptoVaultPort';

export class SetupTotpUseCase {
  constructor(
    private readonly uow: IUnitOfWork,
    private readonly cryptoVault?: ICryptoVaultPort
  ) {}

  private async encryptSecret(text: string, secretKey: string): Promise<string> {
    if (this.cryptoVault) {
      return this.cryptoVault.encrypt(text, secretKey);
    }
    const encoder = new TextEncoder();
    const keyData = encoder.encode(secretKey.padEnd(32, '0').slice(0, 32));
    const key = await crypto.subtle.importKey('raw', keyData, { name: 'AES-GCM' }, false, ['encrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(text));
    const buffer = new Uint8Array(iv.length + encrypted.byteLength);
    buffer.set(iv, 0);
    buffer.set(new Uint8Array(encrypted), iv.length);
    return btoa(String.fromCharCode(...buffer));
  }

  async execute(dto: SetupTotpDTO): Promise<Result<SetupTotpResult>> {
    if (!dto.transactionId || !dto.encryptionKey) {
      return Result.fail<SetupTotpResult>('ID da transação e chave de encriptação são obrigatórios.');
    }

    return await this.uow.execute(async (factory) => {
      const authTxRepo = factory.getAuthTransactionRepository();
      const transaction = await authTxRepo.getTransactionById(dto.transactionId);
      if (!transaction) {
        return Result.fail<SetupTotpResult>('Transação não encontrada.');
      }
      const userRepo = factory.getUserRepository();
      const user = await userRepo.findById(transaction.userId);
      if (!user) {
        return Result.fail<SetupTotpResult>('Usuário não encontrado.');
      }
      
      if (!transaction.isValid(user.authEpoch || 1)) {
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
      const encryptedSecret = await this.encryptSecret(secret, dto.encryptionKey);

      await authRepo.saveTotpSecret(user.id, encryptedSecret);

      return Result.ok<SetupTotpResult>({
        secret,
        otpauthUrl,
      });
    });
  }
}

