import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RegisterCitizenUseCase } from '@/application/use-cases/civil-identity/RegisterCitizenUseCase';
import { Result } from '@/shared/kernel/Result';
import { RepositoryError } from '@/shared/kernel/RepositoryError';
import { CitizenRecord } from '@/application/ports/output/ICivilIdentityRepository';

describe('RegisterCitizenUseCase', () => {
  let civilRepo: any;
  let mockUow: any;

  const sampleCitizen: CitizenRecord = {
    userId: 42,
    username: 'citizen_42',
    legalFirstName: 'Carlos',
    legalLastName: 'Mendes',
    nationalityCode: 'BR',
    birthDate: '1990-05-15',
    maritalStatus: 'single',
    civilStatus: 'pending',
    version: 1,
  };

  beforeEach(() => {
    civilRepo = {
      findCitizenByUserId: vi.fn(),
      createCitizen: vi.fn(),
    };

    mockUow = {
      execute: vi.fn(async (callback) => {
        return callback({
          getCivilIdentityRepository: () => civilRepo,
        });
      }),
    };
  });

  it('fails when userId, legalFirstName or legalLastName are missing', async () => {
    const useCase = new RegisterCitizenUseCase(civilRepo);

    const res1 = await useCase.execute({
      userId: 0,
      legalFirstName: 'Carlos',
      legalLastName: 'Mendes',
    });
    expect(res1.isFailure).toBe(true);
    expect(res1.error).toContain('obrigatórios');

    const res2 = await useCase.execute({
      userId: 42,
      legalFirstName: '',
      legalLastName: 'Mendes',
    });
    expect(res2.isFailure).toBe(true);

    const res3 = await useCase.execute({
      userId: 42,
      legalFirstName: 'Carlos',
      legalLastName: '',
    });
    expect(res3.isFailure).toBe(true);
  });

  it('returns existing citizen if already registered without creating a duplicate', async () => {
    civilRepo.findCitizenByUserId.mockResolvedValue(sampleCitizen);
    const useCase = new RegisterCitizenUseCase(civilRepo);

    const result = await useCase.execute({
      userId: 42,
      legalFirstName: 'Carlos',
      legalLastName: 'Mendes',
    });

    expect(result.isSuccess).toBe(true);
    expect(result.getValue()).toEqual(sampleCitizen);
    expect(civilRepo.createCitizen).not.toHaveBeenCalled();
  });

  it('successfully creates a new citizen when not existing (Repository Direct / D1 mode)', async () => {
    civilRepo.findCitizenByUserId.mockResolvedValue(null);
    civilRepo.createCitizen.mockResolvedValue(Result.ok(sampleCitizen));

    const useCase = new RegisterCitizenUseCase(civilRepo);
    const result = await useCase.execute({
      userId: 42,
      legalFirstName: 'Carlos',
      legalLastName: 'Mendes',
      nationalityCode: 'BR',
      birthDate: '1990-05-15',
      maritalStatus: 'single',
    });

    expect(result.isSuccess).toBe(true);
    expect(result.getValue().civilStatus).toBe('pending');
    expect(civilRepo.createCitizen).toHaveBeenCalledWith({
      userId: 42,
      legalFirstName: 'Carlos',
      legalLastName: 'Mendes',
      nationalityCode: 'BR',
      birthDate: '1990-05-15',
      maritalStatus: 'single',
      civilStatus: 'pending',
    });
  });

  it('successfully creates a new citizen through IUnitOfWork', async () => {
    civilRepo.findCitizenByUserId.mockResolvedValue(null);
    civilRepo.createCitizen.mockResolvedValue(Result.ok(sampleCitizen));

    const useCase = new RegisterCitizenUseCase(mockUow);
    const result = await useCase.execute({
      userId: 42,
      legalFirstName: 'Carlos',
      legalLastName: 'Mendes',
    });

    expect(result.isSuccess).toBe(true);
    expect(mockUow.execute).toHaveBeenCalled();
    expect(result.getValue().legalFirstName).toBe('Carlos');
  });

  it('returns failure when repository fails to insert citizen', async () => {
    civilRepo.findCitizenByUserId.mockResolvedValue(null);
    civilRepo.createCitizen.mockResolvedValue(
      Result.err(RepositoryError.conflict('Citizen already exists for userId 42'))
    );

    const useCase = new RegisterCitizenUseCase(civilRepo);
    const result = await useCase.execute({
      userId: 42,
      legalFirstName: 'Carlos',
      legalLastName: 'Mendes',
    });

    expect(result.isFailure).toBe(true);
    expect(result.error).toContain('Citizen already exists');
  });
});
