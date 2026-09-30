import { IUnitOfWork } from '../../ports/output/IUnitOfWork';
import { Result } from '../../../shared/kernel/Result';
import { ICivilIdentityRepository, KycVerificationRecord } from '../../ports/output/ICivilIdentityRepository';
import { ICryptoVaultPort } from '../../ports/security/ICryptoVaultPort';

export interface SubmitKycVerificationDTO {
  userId: number;
  verificationLevel?: 'basic' | 'enhanced' | 'institutional';
  documentType: 'cpf' | 'rg' | 'passport' | 'cnh';
  documentNumber: string;
  provider?: string;
  encryptionKey?: string;
}

export class SubmitKycVerificationUseCase {
  constructor(
    private readonly repoOrUow: ICivilIdentityRepository | IUnitOfWork,
    private readonly cryptoVault?: ICryptoVaultPort,
    private readonly defaultSecretKey: string = 'asppibra_civil_kyc_default_vault_secret'
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

  async execute(dto: SubmitKycVerificationDTO): Promise<Result<KycVerificationRecord>> {
    if (!dto.userId || !dto.documentNumber) {
      return Result.fail<KycVerificationRecord>('UserId e número do documento são obrigatórios para KYC.');
    }

    const run = async (civilRepo: ICivilIdentityRepository): Promise<Result<KycVerificationRecord>> => {
      // Invariante de Domínio: Cidadão deve existir antes de submeter verificação KYC
      if (typeof civilRepo.findCitizenByUserId === 'function') {
        const citizen = await civilRepo.findCitizenByUserId(dto.userId);
        if (!citizen) {
          return Result.fail<KycVerificationRecord>(
            'Cidadão não encontrado. É necessário registrar os dados civis antes de submeter verificação KYC.'
          );
        }
      }

      // Computa hashes para proteção de PII (SHA-256)
      const encoder = new TextEncoder();
      const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(dto.documentNumber));
      const numberLookupHash = Array.from(new Uint8Array(hashBuffer))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      const last4 = dto.documentNumber.slice(-4);

      // Criptografia Real AES-GCM (Zero-Trust PII Protection)
      const secretKey = dto.encryptionKey || this.defaultSecretKey;
      const encryptedNumber = await this.encryptSecret(dto.documentNumber, secretKey);

      // 1. Salva registro de documento de identidade
      const docRes = await civilRepo.createIdentityDocument({
        userId: dto.userId,
        documentType: dto.documentType,
        countryCode: 'BR',
        numberLookupHash,
        encryptedNumber,
        last4,
        source: 'manual_upload',
        verificationStatus: 'pending',
      });
      if (docRes.isFailure) {
        return Result.fail<KycVerificationRecord>(docRes.error || 'Falha ao salvar documento de identidade.');
      }

      // 2. Registra o processo de verificação KYC
      const kycRes = await civilRepo.createKycVerification({
        userId: dto.userId,
        verificationLevel: dto.verificationLevel || 'basic',
        status: 'submitted',
        provider: dto.provider || 'asppibra_internal_kyc',
        startedAt: new Date(),
      });

      if (kycRes.isFailure) {
        return Result.fail<KycVerificationRecord>(kycRes.error || 'Falha ao registrar verificação KYC.');
      }

      return Result.ok<KycVerificationRecord>(kycRes.getValue());
    };

    if ('execute' in this.repoOrUow && typeof this.repoOrUow.execute === 'function') {
      return await this.repoOrUow.execute(async (factory) => {
        return run(factory.getCivilIdentityRepository());
      });
    }

    return await run(this.repoOrUow as ICivilIdentityRepository);
  }
}

