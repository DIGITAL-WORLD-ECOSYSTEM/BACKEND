import { IUnitOfWork } from '../../ports/output/IUnitOfWork';
import { Result } from '../../../shared/kernel/Result';
import { ISsiRepository } from '../../ports/output/ISsiRepository';
import { ICredentialSigner } from '../../ports/security/ICredentialSigner';
import { canonicalizeJson } from '../../../shared/kernel/ssi_crypto';

export interface VerifyVerifiableCredentialDTO {
  credentialDocument: any;
}

export interface VerifyVerifiableCredentialResult {
  isValid: boolean;
  subjectId: string;
  claims: any;
  credentialType?: string;
  issuer?: string;
}

export class VerifyVerifiableCredentialUseCase {
  constructor(
    private readonly repoOrUow: ISsiRepository | IUnitOfWork,
    private readonly signer: ICredentialSigner
  ) {}

  async execute(dto: VerifyVerifiableCredentialDTO): Promise<Result<VerifyVerifiableCredentialResult>> {
    if (!dto.credentialDocument) {
      return Result.fail('Documento de credencial não fornecido.');
    }

    const doc = dto.credentialDocument;

    // 1. Verify Cryptographic Proof
    if (!doc.proof) {
      return Result.fail('Documento não contém prova criptográfica (proof ausente).');
    }

    const isSignatureValid = await this.signer.verifyProof(doc);
    if (!isSignatureValid) {
      return Result.fail('Assinatura criptográfica da credencial inválida.');
    }

    // 2. Validate Expiration
    if (doc.expirationDate) {
      const expiration = new Date(doc.expirationDate);
      if (isNaN(expiration.getTime()) || expiration < new Date()) {
        return Result.fail('A credencial está expirada.');
      }
    }

    // 3. Extract Credential ID (UUID)
    const rawId = doc.id;
    if (!rawId || typeof rawId !== 'string') {
      return Result.fail('ID da credencial ausente ou em formato inválido.');
    }

    const uuidMatch = rawId.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
    const credentialIdStr = uuidMatch ? uuidMatch[1] : (rawId.startsWith('urn:uuid:') ? rawId.substring(9) : rawId);

    if (!credentialIdStr) {
      return Result.fail('ID da credencial não pôde ser resolvido para identificador canônico.');
    }

    // 4. Verify Revocation Status against the database (Strict Fail-Closed)
    const run = async (ssiRepo: ISsiRepository): Promise<Result<VerifyVerifiableCredentialResult>> => {
      const recordResult = await ssiRepo.findVerifiableCredentialById(credentialIdStr);

      if (recordResult.isFailure || !recordResult.getValue()) {
        return Result.fail('Credencial não encontrada no registro de emissão.');
      }

      const record = recordResult.getValue();

      if (record.status === 'revoked') {
        return Result.fail('A credencial foi revogada pelo emissor.');
      }

      if (record.status !== 'active') {
        return Result.fail(`Credencial não está ativa (status: ${record.status}).`);
      }

      // 5. Verify Hash Integrity against the stored hash
      if (record.credentialHash) {
        const encoder = new TextEncoder();
        const canonicalDoc = canonicalizeJson(doc);
        const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(JSON.stringify(canonicalDoc)));
        const computedHash = Array.from(new Uint8Array(hashBuffer))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');

        if (computedHash !== record.credentialHash) {
          return Result.fail('Adulteração detectada: o hash do documento apresentado não corresponde ao registro emitido.');
        }
      }

      return Result.ok({
        isValid: true,
        subjectId: doc.credentialSubject?.id || record.subjectDid,
        claims: doc.credentialSubject || {},
        credentialType: record.credentialType,
        issuer: doc.issuer || record.issuerDid,
      });
    };

    if ('execute' in this.repoOrUow && typeof this.repoOrUow.execute === 'function') {
      return await this.repoOrUow.execute(async (factory) => {
        return run(factory.getSsiRepository());
      });
    }

    return await run(this.repoOrUow as ISsiRepository);
  }
}

