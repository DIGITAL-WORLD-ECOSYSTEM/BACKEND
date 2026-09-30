import { IUnitOfWork } from '../../ports/output/IUnitOfWork';
import { Result } from '../../../shared/kernel/Result';
import { CitizenRecord, ICivilIdentityRepository } from '../../ports/output/ICivilIdentityRepository';

export interface RegisterCitizenDTO {
  userId: number;
  legalFirstName: string;
  legalLastName: string;
  nationalityCode?: string;
  birthDate?: string;
  maritalStatus?: 'single' | 'married' | 'divorced' | 'widowed' | 'stable_union' | 'separated';
}

export class RegisterCitizenUseCase {
  constructor(private readonly repoOrUow: ICivilIdentityRepository | IUnitOfWork) {}

  async execute(dto: RegisterCitizenDTO): Promise<Result<CitizenRecord>> {
    if (!dto.userId || !dto.legalFirstName || !dto.legalLastName) {
      return Result.fail<CitizenRecord>('ID do usuário, nome e sobrenome legal são obrigatórios.');
    }

    const run = async (civilRepo: ICivilIdentityRepository): Promise<Result<CitizenRecord>> => {
      const existing = await civilRepo.findCitizenByUserId(dto.userId);

      if (existing) {
        return Result.ok<CitizenRecord>(existing);
      }

      const createdRes = await civilRepo.createCitizen({
        userId: dto.userId,
        legalFirstName: dto.legalFirstName,
        legalLastName: dto.legalLastName,
        nationalityCode: dto.nationalityCode || 'BR',
        birthDate: dto.birthDate,
        maritalStatus: dto.maritalStatus,
        civilStatus: 'pending',
      });

      if (createdRes.isFailure) {
        return Result.fail<CitizenRecord>(createdRes.error || 'Falha ao registrar cidadão.');
      }

      return Result.ok<CitizenRecord>(createdRes.getValue());
    };

    if ('execute' in this.repoOrUow && typeof this.repoOrUow.execute === 'function') {
      return await this.repoOrUow.execute(async (factory) => {
        return run(factory.getCivilIdentityRepository());
      });
    }

    return await run(this.repoOrUow as ICivilIdentityRepository);
  }
}

