import { IUnitOfWork } from '../../../application/ports/output/IUnitOfWork';
import { Result } from '../../../shared/kernel/Result';

export interface RevokeCredentialDTO {
  credentialId: string;
  /** ID do usuário que está solicitando a revogação (actorId). 
   *  Deve ser o holder da credencial para evitar IDOR. */
  actorUserId: number;
}

export class RevokeCredentialUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(dto: RevokeCredentialDTO): Promise<Result<void>> {
    if (!dto.credentialId) {
      return Result.fail<void>('CredentialId é obrigatório para revogação.');
    }
    if (!dto.actorUserId) {
      return Result.fail<void>('ActorUserId é obrigatório para revogação.');
    }

    return await this.uow.execute(async (factory) => {
      const ssiRepo = factory.getSsiRepository();
      const vcRes = await ssiRepo.findVerifiableCredentialById(dto.credentialId);

      if (vcRes.isFailure) {
        return Result.fail<void>('Credencial Verificável não encontrada.');
      }

      const vc = vcRes.getValue();

      // IDOR Protection: only the holder of the credential may revoke it.
      // An actor with ssi.credential.revoke permission alone is not sufficient.
      if (vc.holderUserId !== dto.actorUserId) {
        return Result.fail<void>('Acesso negado: você não é o titular desta credencial.');
      }

      return await ssiRepo.revokeVerifiableCredential(dto.credentialId);
    });
  }
}
