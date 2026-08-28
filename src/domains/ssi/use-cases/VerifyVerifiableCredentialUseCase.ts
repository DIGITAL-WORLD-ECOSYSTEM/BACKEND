import { IUnitOfWork } from '../../../application/ports/output/IUnitOfWork';
import { Result } from '../../../shared/kernel/Result';
import { ICredentialSigner } from '../../../application/ports/security/ICredentialSigner';

export interface VerifyVerifiableCredentialDTO {
  credentialDocument: any;
}

export class VerifyVerifiableCredentialUseCase {
  constructor(
    private readonly uow: IUnitOfWork,
    private readonly signer: ICredentialSigner
  ) {}

  async execute(dto: VerifyVerifiableCredentialDTO): Promise<Result<{ isValid: boolean, subjectId: string, claims: any }>> {
    if (!dto.credentialDocument) {
      return Result.fail('Documento de credencial não fornecido.');
    }

    const doc = dto.credentialDocument;
    
    // 1. Verify Cryptographic Proof
    const isSignatureValid = await this.signer.verifyProof(doc);
    if (!isSignatureValid) {
      return Result.fail('Assinatura criptográfica da credencial inválida.');
    }

    // 2. Validate Expiration
    if (doc.expirationDate) {
      const expiration = new Date(doc.expirationDate);
      if (expiration < new Date()) {
        return Result.fail('A credencial está expirada.');
      }
    }

    // 3. Verify Revocation Status against the blockchain / database
    // For this implementation, we query our own SSI repository to see if it was revoked.
    // In a real decentralized scenario, this would query a Revocation Registry on chain.
    const credentialIdStr = doc.id?.split('urn:uuid:')[1];
    if (credentialIdStr) {
      return await this.uow.execute(async (factory) => {
        const ssiRepo = factory.getSsiRepository();
        const recordResult = await ssiRepo.findVerifiableCredentialById(credentialIdStr);
        const record = recordResult.isSuccess ? recordResult.getValue() : null;
        
        if (record && record.status === 'revoked') {
          return Result.fail('A credencial foi revogada pelo emissor.');
        }

        return Result.ok({
          isValid: true,
          subjectId: doc.credentialSubject?.id,
          claims: doc.credentialSubject
        });
      });
    }

    return Result.ok({
      isValid: true,
      subjectId: doc.credentialSubject?.id,
      claims: doc.credentialSubject
    });
  }
}
