import { IUnitOfWork } from '../../../application/ports/output/IUnitOfWork';
import { Result } from '../../../shared/kernel/Result';
import { KycVerificationRecord } from '../../../application/ports/output/ICivilIdentityRepository';

export interface SubmitKycVerificationDTO {
  userId: number;
  verificationLevel: 'basic' | 'enhanced' | 'institutional';
  documentType: 'cpf' | 'rg' | 'passport' | 'cnh';
  documentNumber: string;
  provider?: string;
}

export class SubmitKycVerificationUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(dto: SubmitKycVerificationDTO): Promise<Result<KycVerificationRecord>> {
    if (!dto.userId || !dto.documentNumber) {
      return Result.fail<KycVerificationRecord>('UserId e número do documento são obrigatórios para KYC.');
    }

    return await this.uow.execute(async (factory) => {
      const civilRepo = factory.getCivilIdentityRepository();

      // Computa hashes para proteção de PII (HMAC / SHA256 simulado)
      const encoder = new TextEncoder();
      const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(dto.documentNumber));
      const numberLookupHash = Array.from(new Uint8Array(hashBuffer))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      const last4 = dto.documentNumber.slice(-4);

      // 1. Salva registro de documento de identidade
      const docRes = await civilRepo.createIdentityDocument({
        userId: dto.userId,
        documentType: dto.documentType,
        countryCode: 'BR',
        numberLookupHash,
        encryptedNumber: `enc_${dto.documentNumber}`, // Em produção: chave KMS
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
    });
  }
}
