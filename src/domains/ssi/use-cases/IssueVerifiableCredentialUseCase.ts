import { IUnitOfWork } from '../../../application/ports/output/IUnitOfWork';
import { Result } from '../../../shared/kernel/Result';
import { VerifiableCredentialRecord } from '../../../application/ports/output/ISsiRepository';

export interface IssueVerifiableCredentialDTO {
  holderUserId: number;
  credentialType: 'CivicIdentityCredential' | 'MembershipCredential' | 'KycVerificationCredential' | 'ReputationCredential';
  claims: Record<string, any>;
  expirationDays?: number;
}

export class IssueVerifiableCredentialUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(dto: IssueVerifiableCredentialDTO): Promise<Result<VerifiableCredentialRecord>> {
    if (!dto.holderUserId || !dto.credentialType) {
      return Result.fail<VerifiableCredentialRecord>('HolderUserId e credentialType são obrigatórios.');
    }

    return await this.uow.execute(async (factory) => {
      const ssiRepo = factory.getSsiRepository();
      const didRes = await ssiRepo.findDidByUserId(dto.holderUserId);

      if (didRes.isFailure) {
        return Result.fail<VerifiableCredentialRecord>('DID não encontrado para o cidadão informado. Crie o DID primeiro.');
      }

      const subjectDid = didRes.getValue().did;
      const issuerDid = 'did:key:asppibra-dao-root-issuer';
      const id = crypto.randomUUID();
      const claimsStr = JSON.stringify(dto.claims);

      const encoder = new TextEncoder();
      const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(id + subjectDid + claimsStr));
      const credentialHash = Array.from(new Uint8Array(hashBuffer))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');

      const issuanceDate = new Date();
      const expirationDate = dto.expirationDays
        ? new Date(Date.now() + dto.expirationDays * 86400 * 1000)
        : null;

      const record: VerifiableCredentialRecord = {
        id,
        holderUserId: dto.holderUserId,
        issuerDid,
        subjectDid,
        credentialType: dto.credentialType,
        credentialHash,
        encryptedClaims: `enc_${claimsStr}`, // Simulação KMS / Vault
        proofType: 'Ed25519Signature2020',
        status: 'active',
        issuanceDate,
        expirationDate,
        version: 1,
      };

      return await ssiRepo.saveVerifiableCredential(record);
    });
  }
}
