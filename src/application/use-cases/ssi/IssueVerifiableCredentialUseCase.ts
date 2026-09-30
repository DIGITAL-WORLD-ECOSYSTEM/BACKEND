import { IUnitOfWork } from '../../ports/output/IUnitOfWork';
import { Result } from '../../../shared/kernel/Result';
import { ISsiRepository, VerifiableCredentialRecord } from '../../ports/output/ISsiRepository';
import { ICredentialSigner } from '../../ports/security/ICredentialSigner';
import { ICryptoVaultPort } from '../../ports/security/ICryptoVaultPort';

export interface IssueVerifiableCredentialDTO {
  holderUserId: number;
  credentialType: 'CivicIdentityCredential' | 'MembershipCredential' | 'KycVerificationCredential' | 'ReputationCredential';
  claims: Record<string, any>;
  expirationDays?: number;
  encryptionKey?: string;
  issuerDid?: string;
}

export class IssueVerifiableCredentialUseCase {
  constructor(
    private readonly repoOrUow: ISsiRepository | IUnitOfWork,
    private readonly signer: ICredentialSigner,
    private readonly cryptoVault?: ICryptoVaultPort,
    private readonly defaultSecretKey: string = 'asppibra_ssi_claims_vault_secret'
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

  async execute(dto: IssueVerifiableCredentialDTO): Promise<Result<VerifiableCredentialRecord & { document?: any }>> {
    if (!dto.holderUserId || !dto.credentialType) {
      return Result.fail<VerifiableCredentialRecord>('HolderUserId e credentialType são obrigatórios.');
    }

    const run = async (ssiRepo: ISsiRepository): Promise<Result<VerifiableCredentialRecord & { document?: any }>> => {
      const didRes = await ssiRepo.findDidByUserId(dto.holderUserId);

      if (didRes.isFailure) {
        return Result.fail<VerifiableCredentialRecord>('DID não encontrado para o cidadão informado. Crie o DID primeiro.');
      }

      const subjectDid = didRes.getValue().did;
      const issuerDid = dto.issuerDid || 'did:key:asppibra-dao-root-issuer';
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
          ...(dto.claims || {}),
        },
      };

      const proof = await this.signer.signCredential(unsignedCredential, issuerDid);
      const signedDocument = { ...unsignedCredential, proof };

      const claimsStr = JSON.stringify(dto.claims || {});
      const secretKey = dto.encryptionKey || this.defaultSecretKey;
      const encryptedClaims = await this.encryptSecret(claimsStr, secretKey);

      // CredentialHash is a SHA-256 hash of the signed document
      const encoder = new TextEncoder();
      const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(JSON.stringify(signedDocument)));
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
        encryptedClaims,
        proofType: proof.type as 'Ed25519Signature2020' | 'BbsBlsSignature2020' | 'JsonWebSignature2020',
        status: 'active',
        issuanceDate,
        expirationDate,
        version: 1,
      };

      const saveRes = await ssiRepo.saveVerifiableCredential(record);
      if (saveRes.isFailure) {
        return Result.fail<VerifiableCredentialRecord>(saveRes.error || 'Falha ao salvar credencial.');
      }

      return Result.ok({
        ...saveRes.getValue(),
        document: signedDocument,
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

