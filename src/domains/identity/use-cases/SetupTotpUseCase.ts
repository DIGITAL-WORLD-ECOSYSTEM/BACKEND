import { IUnitOfWork } from '../../../application/ports/output/IUnitOfWork';
import { Result } from '../../../shared/kernel/Result';
import { SetupTotpDTO, SetupTotpResult } from '../../../application/dto/identity/SetupTotpDTO';
import { authenticator } from 'otplib';

export class SetupTotpUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(dto: SetupTotpDTO): Promise<Result<SetupTotpResult>> {
    if (!dto.userId) {
      return Result.fail<SetupTotpResult>('ID do usuário é obrigatório.');
    }

    return await this.uow.execute(async (factory) => {
      const userRepo = factory.getUserRepository();
      const authRepo = factory.getAuthenticationRepository();

      const user = await userRepo.findById(dto.userId);
      if (!user) {
        return Result.fail<SetupTotpResult>('Usuário não encontrado.');
      }

      const secret = authenticator.generateSecret();
      const otpauthUrl = authenticator.keyuri(user.email, 'ASPPIBRA DAO', secret);

      await authRepo.saveTotpSecret(user.id, secret);

      return Result.ok<SetupTotpResult>({
        secret,
        otpauthUrl,
      });
    });
  }
}
