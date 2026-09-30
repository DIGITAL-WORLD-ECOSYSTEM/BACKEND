import { IUnitOfWork } from '../../ports/output/IUnitOfWork';
import { Result } from '../../../shared/kernel/Result';
import { ISsiRepository, DidIdentityRecord } from '../../ports/output/ISsiRepository';
import { encodeDidKey, exportEd25519PrivateKeyMultibase } from '../../../shared/kernel/ssi_crypto';

export interface CreateDidDTO {
  userId: number;
  method?: 'key' | 'ion' | 'polygonid' | 'web' | 'cheqd' | 'pkh';
  isPrimary?: boolean;
}

export class CreateDidUseCase {
  constructor(private readonly repoOrUow: ISsiRepository | IUnitOfWork) {}

  async execute(dto: CreateDidDTO): Promise<Result<DidIdentityRecord>> {
    if (!dto.userId) {
      return Result.fail<DidIdentityRecord>('ID do usuário é obrigatório para geração de DID.');
    }

    const method = dto.method || 'key';

    const run = async (ssiRepo: ISsiRepository): Promise<Result<DidIdentityRecord>> => {
      const existingRes = await ssiRepo.findDidByUserId(dto.userId);

      if (existingRes.isSuccess) {
        return existingRes;
      }

      const id = crypto.randomUUID();
      let did: string;
      let privateKeyMultibase: string | undefined;
      let privateKeyHex: string | undefined;

      if (method === 'key') {
        // Generate real W3C Ed25519 key pair and multicodec multibase DID
        const keyPair = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
        const rawPublicKey = new Uint8Array(await crypto.subtle.exportKey('raw', keyPair.publicKey));
        did = encodeDidKey(rawPublicKey);

        // Export holder private key for self-sovereignty & Proof-of-Possession
        const pkcs8Buf = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey);
        const pkcs8Bytes = new Uint8Array(pkcs8Buf);
        const exportedKeys = exportEd25519PrivateKeyMultibase(pkcs8Bytes);
        privateKeyMultibase = exportedKeys.privateKeyMultibase;
        privateKeyHex = exportedKeys.privateKeyHex;
      } else {
        did = `did:${method}:${id}`;
      }

      const record: DidIdentityRecord & { isPrimary?: boolean } = {
        id,
        userId: dto.userId,
        did,
        method,
        controller: did,
        status: 'active',
        isPrimary: dto.isPrimary ?? true, // Set as primary DID by default
        version: 1,
        ...(privateKeyMultibase ? { privateKeyMultibase } : {}),
        ...(privateKeyHex ? { privateKeyHex } : {}),
      };

      return await ssiRepo.saveDid(record);
    };

    if ('execute' in this.repoOrUow && typeof this.repoOrUow.execute === 'function') {
      return await this.repoOrUow.execute(async (factory) => {
        return run(factory.getSsiRepository());
      });
    }

    return await run(this.repoOrUow as ISsiRepository);
  }
}
