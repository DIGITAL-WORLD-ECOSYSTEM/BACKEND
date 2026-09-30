import { IUnitOfWork } from '../../ports/output/IUnitOfWork';
import { Result } from '../../../shared/kernel/Result';
import { ISsiRepository } from '../../ports/output/ISsiRepository';

export interface RevokeCredentialDTO {
  credentialId: string;
  /** ID do usuário que está solicitando a revogação (actorId). 
   *  Deve ser o holder da credencial para evitar IDOR. */
  actorUserId: number;
}

export class RevokeCredentialUseCase {
  constructor(private readonly repoOrUow: ISsiRepository | IUnitOfWork) {}

  async execute(dto: RevokeCredentialDTO): Promise<Result<void>> {
    if (!dto.credentialId) {
      return Result.fail<void>('CredentialId é obrigatório para revogação.');
    }
    if (!dto.actorUserId) {
      return Result.fail<void>('ActorUserId é obrigatório para revogação.');
    }

    const run = async (ssiRepo: ISsiRepository): Promise<Result<void>> => {
      const vcRes = await ssiRepo.findVerifiableCredentialById(dto.credentialId);

      if (vcRes.isFailure) {
        return Result.fail<void>('Credencial Verificável não encontrada.');
      }

      const vc = vcRes.getValue();

      // IDOR Protection: only the holder of the credential may revoke it.
      if (vc.holderUserId !== dto.actorUserId) {
        return Result.fail<void>('Acesso negado: você não é o titular desta credencial.');
      }

      return await ssiRepo.revokeVerifiableCredential(dto.credentialId);
    };

    if ('execute' in this.repoOrUow && typeof this.repoOrUow.execute === 'function') {
      return await this.repoOrUow.execute(async (factory) => {
        return run(factory.getSsiRepository());
      });
    }

    return await run(this.repoOrUow as ISsiRepository);
  }
}

