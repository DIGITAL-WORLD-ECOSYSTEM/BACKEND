import { IUnitOfWork } from '../../../application/ports/output/IUnitOfWork';
import { Result } from '../../../shared/kernel/Result';
import { VerifiableCredentialRecord } from '../../../application/ports/output/ISsiRepository';
import { ICredentialSigner } from '../../../application/ports/security/ICredentialSigner';

export interface IssueVerifiableCredentialDTO {
  holderUserId: number;
  credentialType: 'CivicIdentityCredential' | 'MembershipCredential' | 'KycVerificationCredential' | 'ReputationCredential';
  claims: Record<string, any>;
  expirationDays?: number;
}

export class IssueVerifiableCredentialUseCase {
  constructor(
    private readonly uow: IUnitOfWork,
    private readonly signer: ICredentialSigner
  ) {}

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
      const issuanceDate = new Date();
      const expirationDate = dto.expirationDays
        ? new Date(Date.now() + dto.expirationDays * 86400 * 1000)
        : null;

      const unsignedCredential = {
        '@context': ['https://www.w3.org/2018/credentials/v1'],
        id: `urn:uuid:${id}`,
        type: ['VerifiableCredential', dto.credentialType],
        issuer: issuerDid,
        issuanceDate: issuanceDate.toISOString(),
        expirationDate: expirationDate ? expirationDate.toISOString() : undefined,
        credentialSubject: {
          id: subjectDid,
          ...dto.claims
        }
      };

      const proof = await this.signer.signCredential(unsignedCredential, issuerDid);
      
      const claimsStr = JSON.stringify(dto.claims);
      const proofStr = JSON.stringify(proof);
      
      // CredentialHash is now a hash of the signed document
      const encoder = new TextEncoder();
      const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(JSON.stringify({...unsignedCredential, proof})));
      const credentialHash = Array.from(new Uint8Array(hashBuffer))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');

      const record: VerifiableCredentialRecord = {
        id,
        holderUserId: dto.holderUserId,
        issuerDid,
        subjectDid,
        credentialType: dto.credentialType,
        credentialHash,
        encryptedClaims: `enc_${claimsStr}`, // Simulação KMS / Vault
        proofType: proof.type as 'Ed25519Signature2020' | 'BbsBlsSignature2020' | 'JsonWebSignature2020',
        status: 'active',
        issuanceDate,
        expirationDate,
        version: 1,
      };

      return await ssiRepo.saveVerifiableCredential(record);
    });
  }
}
