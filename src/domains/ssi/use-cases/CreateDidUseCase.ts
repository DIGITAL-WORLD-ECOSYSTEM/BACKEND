import { IUnitOfWork } from '../../../application/ports/output/IUnitOfWork';
import { Result } from '../../../shared/kernel/Result';
import { DidIdentityRecord } from '../../../application/ports/output/ISsiRepository';

export interface CreateDidDTO {
  userId: number;
  method?: 'key' | 'ion' | 'polygonid' | 'web' | 'cheqd' | 'pkh';
}

export class CreateDidUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(dto: CreateDidDTO): Promise<Result<DidIdentityRecord>> {
    if (!dto.userId) {
      return Result.fail<DidIdentityRecord>('ID do usuário é obrigatório para geração de DID.');
    }

    const method = dto.method || 'key';

    return await this.uow.execute(async (factory) => {
      const ssiRepo = factory.getSsiRepository();
      const existingRes = await ssiRepo.findDidByUserId(dto.userId);

      if (existingRes.isSuccess) {
        return existingRes;
      }

      const id = crypto.randomUUID();
      const did = `did:${method}:${id}`;
      const record: DidIdentityRecord = {
        id,
        userId: dto.userId,
        did,
        method,
        controller: did,
        status: 'active',
        version: 1,
      };

      return await ssiRepo.saveDid(record);
    });
  }
}
