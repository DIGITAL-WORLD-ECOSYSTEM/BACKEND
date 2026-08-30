import { describe, it, expect, vi } from 'vitest';
import { Result } from '../shared/kernel/Result';
import { RegisterCitizenUseCase } from './civil-identity/use-cases/RegisterCitizenUseCase';
import { SubmitKycVerificationUseCase } from './civil-identity/use-cases/SubmitKycVerificationUseCase';
import { CreateDidUseCase } from './ssi/use-cases/CreateDidUseCase';
import { IssueVerifiableCredentialUseCase } from './ssi/use-cases/IssueVerifiableCredentialUseCase';
import { RevokeCredentialUseCase } from './ssi/use-cases/RevokeCredentialUseCase';
import { GetTreasuryBalanceUseCase } from './finance/use-cases/GetTreasuryBalanceUseCase';
import { RecordTreasuryTransactionUseCase } from './finance/use-cases/RecordTreasuryTransactionUseCase';

describe('Phase 3 Ecosystem Modules Suite', () => {
  describe('Civil Identity Use Cases', () => {
    it('should register a new citizen civil identity', async () => {
      const mockCivilRepo = {
        findCitizenByUserId: vi.fn().mockResolvedValue(null),
        createCitizen: vi.fn().mockImplementation(async (data) => ({
          ...data,
          username: 'citizen_123',
          version: 1,
        })),
      };
      const mockUow = {
        execute: vi.fn().mockImplementation(async (cb) =>
          cb({
            getCivilIdentityRepository: () => mockCivilRepo,
          })
        ),
      };

      const useCase = new RegisterCitizenUseCase(mockUow as any);
      const result = await useCase.execute({
        userId: 10,
        legalFirstName: 'João',
        legalLastName: 'Silva',
        nationalityCode: 'BR',
      });

      expect(result.isSuccess).toBe(true);
      expect(result.getValue().legalFirstName).toBe('João');
      expect(mockCivilRepo.createCitizen).toHaveBeenCalled();
    });

    it('should submit KYC verification request and store identity document', async () => {
      const mockCivilRepo = {
        createIdentityDocument: vi.fn().mockResolvedValue({ id: 1, userId: 10 }),
        createKycVerification: vi.fn().mockResolvedValue({
          id: 5,
          userId: 10,
          status: 'submitted',
          verificationLevel: 'basic',
        }),
      };
      const mockUow = {
        execute: vi.fn().mockImplementation(async (cb) =>
          cb({
            getCivilIdentityRepository: () => mockCivilRepo,
          })
        ),
      };

      const useCase = new SubmitKycVerificationUseCase(mockUow as any);
      const result = await useCase.execute({
        userId: 10,
        verificationLevel: 'basic',
        documentType: 'cpf',
        documentNumber: '12345678901',
      });

      expect(result.isSuccess).toBe(true);
      expect(result.getValue().status).toBe('submitted');
      expect(mockCivilRepo.createIdentityDocument).toHaveBeenCalled();
      expect(mockCivilRepo.createKycVerification).toHaveBeenCalled();
    });
  });

  describe('SSI / DID Use Cases', () => {
    it('should create a W3C DID for a user', async () => {
      const mockSsiRepo = {
        findDidByUserId: vi.fn().mockResolvedValue(Result.fail('Not found')),
        saveDid: vi.fn().mockImplementation(async (record) => Result.ok(record)),
      };
      const mockUow = {
        execute: vi.fn().mockImplementation(async (cb) =>
          cb({
            getSsiRepository: () => mockSsiRepo,
          })
        ),
      };

      const useCase = new CreateDidUseCase(mockUow as any);
      const result = await useCase.execute({ userId: 10, method: 'key' });

      expect(result.isSuccess).toBe(true);
      expect(result.getValue().did).toContain('did:key:');
      expect(mockSsiRepo.saveDid).toHaveBeenCalled();
    });

    it('should issue a Verifiable Credential to DID holder', async () => {
      const mockSsiRepo = {
        findDidByUserId: vi.fn().mockResolvedValue(Result.ok({ did: 'did:key:holder-123' })),
        saveVerifiableCredential: vi.fn().mockImplementation(async (record) => Result.ok(record)),
      };
      const mockUow = {
        execute: vi.fn().mockImplementation(async (cb) =>
          cb({
            getSsiRepository: () => mockSsiRepo,
          })
        ),
      };

      const mockSigner = {
        signCredential: vi.fn().mockResolvedValue({ type: 'Ed25519Signature2020', proofValue: 'sig_123' }),
      };

      const useCase = new IssueVerifiableCredentialUseCase(mockUow as any, mockSigner as any);
      const result = await useCase.execute({
        holderUserId: 10,
        credentialType: 'CivicIdentityCredential',
        claims: { isCitizen: true },
      });

      expect(result.isSuccess).toBe(true);
      expect(result.getValue().subjectDid).toBe('did:key:holder-123');
      expect(mockSsiRepo.saveVerifiableCredential).toHaveBeenCalled();
    });

    it('should revoke an existing Verifiable Credential (with owner check)', async () => {
      const mockSsiRepo = {
        findVerifiableCredentialById: vi.fn().mockResolvedValue(Result.ok({ id: 'vc-uuid-123', holderUserId: 10 })),
        revokeVerifiableCredential: vi.fn().mockResolvedValue(Result.ok(undefined)),
      };
      const mockUow = {
        execute: vi.fn().mockImplementation(async (cb) =>
          cb({
            getSsiRepository: () => mockSsiRepo,
          })
        ),
      };

      const useCase = new RevokeCredentialUseCase(mockUow as any);
      const result = await useCase.execute({ credentialId: 'vc-uuid-123', actorUserId: 10 });

      expect(result.isSuccess).toBe(true);
      expect(mockSsiRepo.revokeVerifiableCredential).toHaveBeenCalledWith('vc-uuid-123');
    });

    it('should reject revocation if actor is not the credential holder (IDOR guard)', async () => {
      const mockSsiRepo = {
        findVerifiableCredentialById: vi.fn().mockResolvedValue(Result.ok({ id: 'vc-uuid-123', holderUserId: 99 })),
        revokeVerifiableCredential: vi.fn(),
      };
      const mockUow = {
        execute: vi.fn().mockImplementation(async (cb) =>
          cb({
            getSsiRepository: () => mockSsiRepo,
          })
        ),
      };

      const useCase = new RevokeCredentialUseCase(mockUow as any);
      const result = await useCase.execute({ credentialId: 'vc-uuid-123', actorUserId: 10 }); // Different actor

      expect(result.isFailure).toBe(true);
      expect(result.error).toContain('titular');
      expect(mockSsiRepo.revokeVerifiableCredential).not.toHaveBeenCalled();
    });
  });

  describe('Finance & Treasury Use Cases', () => {
    it('should query treasury balances', async () => {
      const mockFinanceRepo = {
        getTreasuryBalance: vi.fn().mockResolvedValue(
          Result.ok([{ id: 1, accountId: 1, assetId: 1, availableBaseUnits: '1000000', lockedBaseUnits: '0', version: 1 }])
        ),
      };
      const mockUow = {
        execute: vi.fn().mockImplementation(async (cb) =>
          cb({
            getFinanceRepository: () => mockFinanceRepo,
          })
        ),
      };

      const useCase = new GetTreasuryBalanceUseCase(mockUow as any);
      const result = await useCase.execute();

      expect(result.isSuccess).toBe(true);
      expect(result.getValue()[0].availableBaseUnits).toBe('1000000');
    });

    it('should record a treasury financial transaction', async () => {
      const mockFinanceRepo = {
        getTreasuryAccount: vi.fn().mockResolvedValue(Result.ok({ id: 1 })),
        getOrCreateUserAccount: vi.fn().mockResolvedValue(Result.ok({ id: 2 })),
        getOrCreateOperatingAccount: vi.fn().mockResolvedValue(Result.ok({ id: 3 })),
      };
      const mockUow = {
        execute: vi.fn().mockImplementation(async (cb) =>
          cb({
            getFinanceRepository: () => mockFinanceRepo,
          })
        ),
      };

      const mockLedgerService = {
        recordTransaction: vi.fn().mockResolvedValue(Result.ok({ transactionId: 10, isReplayed: false })),
      };

      const useCase = new RecordTreasuryTransactionUseCase(mockUow as any, mockLedgerService as any);
      const result = await useCase.execute({
        description: 'Depósito Inicial',
        amountBaseUnits: '50000',
        direction: 'INBOUND',
        type: 'deposit',
        assetId: 1,
        idempotencyKey: 'test-key-123',
        requestHash: 'hash-123'
      });

      expect(result.isSuccess).toBe(true);
      expect(mockLedgerService.recordTransaction).toHaveBeenCalled();
    });
  });
});
