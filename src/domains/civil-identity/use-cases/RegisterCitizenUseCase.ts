import { IUnitOfWork } from '../../../application/ports/output/IUnitOfWork';
import { Result } from '../../../shared/kernel/Result';
import { CitizenRecord } from '../../../application/ports/output/ICivilIdentityRepository';

export interface RegisterCitizenDTO {
  userId: number;
  legalFirstName: string;
  legalLastName: string;
  nationalityCode?: string;
  birthDate?: string;
  maritalStatus?: 'single' | 'married' | 'divorced' | 'widowed' | 'stable_union' | 'separated';
}

export class RegisterCitizenUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(dto: RegisterCitizenDTO): Promise<Result<CitizenRecord>> {
    if (!dto.userId || !dto.legalFirstName || !dto.legalLastName) {
      return Result.fail<CitizenRecord>('ID do usuário, nome e sobrenome legal são obrigatórios.');
    }

    return await this.uow.execute(async (factory) => {
      const civilRepo = factory.getCivilIdentityRepository();
      const existing = await civilRepo.findCitizenByUserId(dto.userId);

      if (existing) {
        return Result.ok<CitizenRecord>(existing);
      }

      const created = await civilRepo.createCitizen({
        userId: dto.userId,
        legalFirstName: dto.legalFirstName,
        legalLastName: dto.legalLastName,
        nationalityCode: dto.nationalityCode || 'BR',
        birthDate: dto.birthDate,
        maritalStatus: dto.maritalStatus,
        civilStatus: 'pending',
      });

      return Result.ok<CitizenRecord>(created);
    });
  }
}
