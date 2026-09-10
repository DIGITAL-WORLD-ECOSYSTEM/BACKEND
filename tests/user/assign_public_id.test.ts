import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Result } from '../../src/shared/kernel/Result';
import { fromTrustedUserId } from '../../src/shared/kernel/ids/UserId';
import { AssignUserPublicIdUseCase } from '../../src/application/user/use-cases/AssignUserPublicIdUseCase';
import { IUnitOfWork, IRepositoryFactory } from '../../src/application/ports/output/IUnitOfWork';

describe('AssignUserPublicIdUseCase Production Hardening & Invariants', () => {
  const mockUserRepo = {
    findById: vi.fn(),
    updatePublicId: vi.fn(),
  };

  const mockCivilRepo = {
    findCitizenByUserId: vi.fn(),
    getLatestKycByUserId: vi.fn(),
  };

  const mockWeb3Repo = {
    findByUserId: vi.fn(),
  };

  const mockFactory = {
    getUserRepository: () => mockUserRepo,
    getCivilIdentityRepository: () => mockCivilRepo,
    getWeb3Repository: () => mockWeb3Repo,
  } as unknown as IRepositoryFactory;

  const mockUow: IUnitOfWork = {
    execute: vi.fn(async (work) => await work(mockFactory)),
  };

  const useCase = new AssignUserPublicIdUseCase(mockUow);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('successfully assigns PublicId when all KYC (Fail-Closed) and internal wallet invariants are met', async () => {
    const userId = fromTrustedUserId(10);
    const walletAddress = '0x1111111111111111111111111111111111111111';

    mockUserRepo.findById.mockResolvedValueOnce({
      id: userId,
      publicId: null,
      deletedAt: null,
      status: 'active',
      updatedAt: new Date(),
    });

    mockCivilRepo.getLatestKycByUserId.mockResolvedValueOnce({
      status: 'approved',
    });
    mockCivilRepo.findCitizenByUserId.mockResolvedValueOnce({
      civilStatus: 'verified',
    });

    mockWeb3Repo.findByUserId.mockResolvedValueOnce([
      {
        provenance: 'internal',
        status: 'active',
        isPrimary: true,
        address: walletAddress,
      },
    ]);

    mockUserRepo.updatePublicId.mockResolvedValueOnce(Result.ok());

    const result = await useCase.execute({ userId });

    expect(result.isOk()).toBe(true);
    const res = result.getValue();
    expect(res.userId).toBe(userId);
    expect(res.publicId).toBe(walletAddress.toLowerCase());
    expect(mockUserRepo.updatePublicId).toHaveBeenCalledWith(userId, walletAddress.toLowerCase());
  });

  it('rejects if account is suspended, locked, or pending_setup even if KYC is approved', async () => {
    const userId = fromTrustedUserId(20);

    mockUserRepo.findById.mockResolvedValueOnce({
      id: userId,
      publicId: null,
      deletedAt: null,
      status: 'suspended', // Suspended account!
    });

    const result = await useCase.execute({ userId });

    expect(result.isErr()).toBe(true);
    expect(result.error).toContain('exige que a conta esteja no estado "active"');
  });

  it('rejects with Fail-Closed logic when citizen is verified but latest KYC is rejected', async () => {
    const userId = fromTrustedUserId(21);

    mockUserRepo.findById.mockResolvedValueOnce({
      id: userId,
      publicId: null,
      deletedAt: null,
      status: 'active',
    });

    mockCivilRepo.findCitizenByUserId.mockResolvedValueOnce({
      civilStatus: 'verified',
    });
    mockCivilRepo.getLatestKycByUserId.mockResolvedValueOnce({
      status: 'rejected', // KYC was rejected!
    });

    const result = await useCase.execute({ userId });

    expect(result.isErr()).toBe(true);
    expect(result.error).toContain('não possui processo KYC aprovado');
  });

  it('rejects if multiple active internal wallets exist without a primary wallet defined', async () => {
    const userId = fromTrustedUserId(22);

    mockUserRepo.findById.mockResolvedValueOnce({
      id: userId,
      publicId: null,
      deletedAt: null,
      status: 'active',
    });

    mockCivilRepo.getLatestKycByUserId.mockResolvedValueOnce({
      status: 'approved',
    });
    mockCivilRepo.findCitizenByUserId.mockResolvedValueOnce({
      civilStatus: 'verified',
    });

    mockWeb3Repo.findByUserId.mockResolvedValueOnce([
      {
        provenance: 'internal',
        status: 'active',
        isPrimary: false,
        address: '0x1111111111111111111111111111111111111111',
      },
      {
        provenance: 'internal',
        status: 'active',
        isPrimary: false,
        address: '0x2222222222222222222222222222222222222222',
      },
    ]);

    const result = await useCase.execute({ userId });

    expect(result.isErr()).toBe(true);
    expect(result.error).toContain('Múltiplas carteiras internas ativas encontradas');
  });

  it('selects the primary wallet when multiple active internal wallets exist', async () => {
    const userId = fromTrustedUserId(23);
    const primaryAddress = '0x2222222222222222222222222222222222222222';

    mockUserRepo.findById.mockResolvedValueOnce({
      id: userId,
      publicId: null,
      deletedAt: null,
      status: 'active',
      updatedAt: new Date(),
    });

    mockCivilRepo.getLatestKycByUserId.mockResolvedValueOnce({
      status: 'approved',
    });
    mockCivilRepo.findCitizenByUserId.mockResolvedValueOnce({
      civilStatus: 'verified',
    });

    mockWeb3Repo.findByUserId.mockResolvedValueOnce([
      {
        provenance: 'internal',
        status: 'active',
        isPrimary: false,
        address: '0x1111111111111111111111111111111111111111',
      },
      {
        provenance: 'internal',
        status: 'active',
        isPrimary: true, // Primary selected!
        address: primaryAddress,
      },
    ]);

    mockUserRepo.updatePublicId.mockResolvedValueOnce(Result.ok());

    const result = await useCase.execute({ userId });

    expect(result.isOk()).toBe(true);
    expect(result.getValue().publicId).toBe(primaryAddress.toLowerCase());
    expect(mockUserRepo.updatePublicId).toHaveBeenCalledWith(userId, primaryAddress.toLowerCase());
  });
});
