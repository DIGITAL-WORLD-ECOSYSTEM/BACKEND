import { IUnitOfWork } from '../../../application/ports/output/IUnitOfWork';
import { Result } from '../../../shared/kernel/Result';

export interface RevokeCredentialDTO {
  credentialId: string;
}

export class RevokeCredentialUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(dto: RevokeCredentialDTO): Promise<Result<void>> {
    if (!dto.credentialId) {
      return Result.fail<void>('CredentialId é obrigatório para revogação.');
    }

    return await this.uow.execute(async (factory) => {
      const ssiRepo = factory.getSsiRepository();
      const vcRes = await ssiRepo.findVerifiableCredentialById(dto.credentialId);

      if (vcRes.isFailure) {
        return Result.fail<void>('Credencial Verificável não encontrada.');
      }

      return await ssiRepo.revokeVerifiableCredential(dto.credentialId);
    });
  }
}
