import { describe, it, expect, vi } from 'vitest';
import { SetupTotpUseCase } from './SetupTotpUseCase';
import { AuthenticateTotpUseCase } from './AuthenticateTotpUseCase';
import { RequestPasswordResetUseCase } from './RequestPasswordResetUseCase';
import { ConfirmPasswordResetUseCase } from './ConfirmPasswordResetUseCase';
import { RefreshTokenUseCase } from './RefreshTokenUseCase';
import { authenticator } from 'otplib';
import { Result } from '../../../shared/kernel/Result';
import { CryptoVault } from '../../../infrastructure/security/crypto/crypto';
import { AuthenticateAccountUseCase } from './AuthenticateAccountUseCase';

describe('Auxiliary Authentication Use Cases Suite', () => {
  describe('AuthenticateAccountUseCase Lockout Protection', () => {
    it('should lock account after 5 consecutive invalid password attempts', async () => {
      const mockUserRepo = {
        findByEmail: vi.fn().mockResolvedValue({ id: 99, email: 'brute@asppibra.com', status: 'active', subjectType: 'human', failedLoginAttempts: 0 }),
        incrementFailedLoginAttempts: vi.fn().mockResolvedValue(undefined),
        updateStatus: vi.fn().mockResolvedValue(undefined),
      };
      const mockAuthRepo = {
        findPasswordCredentialByUserId: vi.fn().mockResolvedValue({ userId: 99, passwordHash: 'hash' }),
      };
      const mockHasher = {
        verify: vi.fn().mockResolvedValue(false), // Always invalid
      };
      const mockUow = {
        execute: vi.fn().mockImplementation(async (cb) =>
          cb({
            getUserRepository: () => mockUserRepo,
            getAuthenticationRepository: () => mockAuthRepo,
          })
        ),
      };

      const useCase = new AuthenticateAccountUseCase(mockUow as any, mockHasher as any);

      // Attempt 1 to 4
      for (let i = 0; i < 4; i++) {
        const res = await useCase.execute({ email: 'brute@asppibra.com', password: 'wrong' });
        expect(res.isFailure).toBe(true);
        expect(res.error).toContain('Não foi possível autenticar com as credenciais fornecidas');
      }

      // Attempt 5 should trigger lockout!
      const res5 = await useCase.execute({ email: 'brute@asppibra.com', password: 'wrong' });
      expect(res5.isFailure).toBe(true);
      expect(res5.error).toContain('Não foi possível autenticar com as credenciais fornecidas');
      expect(mockUserRepo.incrementFailedLoginAttempts).toHaveBeenCalledWith(99, 5);
    });
  });

  describe('SetupTotpUseCase', () => {
    it('should generate valid secret and otpauthUrl for existing user', async () => {
      const mockUserRepo = {
        findById: vi.fn().mockResolvedValue({ id: 1, email: 'user@asppibra.com', authEpoch: 1 }),
      };
      const mockAuthRepo = {
        findTotpCredentialByUserId: vi.fn().mockResolvedValue(null),
        saveTotpSecret: vi.fn().mockResolvedValue('auth_123'),
      };
      const mockAuthTxRepo = {
        getTransactionById: vi.fn().mockResolvedValue({
          id: 'tx_123',
          userId: 1,
          context: 'mfa_setup',
          isValid: () => true,
        }),
      };
      const mockUow = {
        execute: vi.fn().mockImplementation(async (cb) =>
          cb({
            getUserRepository: () => mockUserRepo,
            getAuthenticationRepository: () => mockAuthRepo,
            getAuthTransactionRepository: () => mockAuthTxRepo,
          })
        ),
      };

      const useCase = new SetupTotpUseCase(mockUow as any);
      const result = await useCase.execute({
        transactionId: 'tx_123',
        encryptionKey: 'test_encryption_key_32_bytes_long',
      });

      expect(result.isSuccess).toBe(true);
      expect(result.getValue().secret).toBeDefined();
      expect(result.getValue().otpauthUrl).toContain('otpauth://totp/ASPPIBRA');
    });
  });

  describe('AuthenticateTotpUseCase', () => {
    it('should verify valid 2FA TOTP code', async () => {
      const secret = authenticator.generateSecret();
      const code = authenticator.generate(secret);
      const encryptionKey = 'test_encryption_key_32_bytes_long';
      const encryptedSecret = await CryptoVault.encrypt(secret, encryptionKey);

      const mockUserRepo = {
        findById: vi.fn().mockResolvedValue({ id: 1, email: 'user@asppibra.com', authEpoch: 1 }),
      };
      const mockAuthRepo = {
        findTotpCredentialByUserId: vi.fn().mockResolvedValue({
          authenticatorId: 'auth_123',
          userId: 1,
          encryptedTotpSecret: encryptedSecret,
          verified: false,
        }),
        verifyTotpAuthenticator: vi.fn().mockResolvedValue(undefined),
      };
      const mockAuthTxRepo = {
        getTransactionById: vi.fn().mockResolvedValue({
          id: 'tx_123',
          userId: 1,
          context: 'mfa_setup',
          authEpochAtStart: 1,
          isValid: () => true,
        }),
        recordFailedAttemptAtomically: vi.fn().mockResolvedValue(true),
        completeFactorAtomically: vi.fn().mockResolvedValue(true),
      };
      const mockUow = {
        execute: vi.fn().mockImplementation(async (cb) =>
          cb({
            getUserRepository: () => mockUserRepo,
            getAuthenticationRepository: () => mockAuthRepo,
            getAuthTransactionRepository: () => mockAuthTxRepo,
          })
        ),
      };

      const useCase = new AuthenticateTotpUseCase(mockUow as any);
      const result = await useCase.execute({
        transactionId: 'tx_123',
        code,
        encryptionKey,
      });

      expect(result.isSuccess).toBe(true);
      expect(result.getValue().verified).toBe(true);
      expect(result.getValue().aal).toBe(2);
      expect(mockAuthRepo.verifyTotpAuthenticator).toHaveBeenCalledWith('auth_123');
    });

    it('should reject invalid 2FA TOTP code', async () => {
      const secret = authenticator.generateSecret();
      const encryptionKey = 'test_encryption_key_32_bytes_long';
      const encryptedSecret = await CryptoVault.encrypt(secret, encryptionKey);

      const mockUserRepo = {
        findById: vi.fn().mockResolvedValue({ id: 1, email: 'user@asppibra.com', authEpoch: 1 }),
      };
      const mockAuthRepo = {
        findTotpCredentialByUserId: vi.fn().mockResolvedValue({
          authenticatorId: 'auth_123',
          userId: 1,
          encryptedTotpSecret: encryptedSecret,
          verified: true,
        }),
      };
      const mockAuthTxRepo = {
        getTransactionById: vi.fn().mockResolvedValue({
          id: 'tx_123',
          userId: 1,
          context: 'mfa_setup',
          authEpochAtStart: 1,
          isValid: () => true,
        }),
        recordFailedAttemptAtomically: vi.fn().mockResolvedValue(true),
      };
      const mockUow = {
        execute: vi.fn().mockImplementation(async (cb) =>
          cb({
            getUserRepository: () => mockUserRepo,
            getAuthenticationRepository: () => mockAuthRepo,
            getAuthTransactionRepository: () => mockAuthTxRepo,
          })
        ),
      };

      const useCase = new AuthenticateTotpUseCase(mockUow as any);
      const result = await useCase.execute({
        transactionId: 'tx_123',
        code: '000000',
        encryptionKey,
      });

      expect(result.isFailure).toBe(true);
      expect(result.error).toContain('Código 2FA inválido');
    });
  });

  describe('RequestPasswordResetUseCase', () => {
    it('should create password reset record and save event in outbox', async () => {
      const mockUserRepo = {
        findByEmail: vi.fn().mockResolvedValue({ id: 1, email: 'user@asppibra.com' }),
      };
      const mockResetRepo = {
        create: vi.fn().mockResolvedValue({ isSuccess: true }),
      };
      const mockOutboxRepo = {
        saveEvent: vi.fn().mockResolvedValue({ isSuccess: true }),
      };
      const mockQueuePort = {
        dispatchPasswordReset: vi.fn().mockResolvedValue(undefined),
      };
      const mockUow = {
        execute: vi.fn().mockImplementation(async (cb) =>
          cb({
            getUserRepository: () => mockUserRepo,
            getPasswordResetRepository: () => mockResetRepo,
            getOutboxRepository: () => mockOutboxRepo,
          })
        ),
      };

      const useCase = new RequestPasswordResetUseCase(mockUow as any, mockQueuePort as any);
      const result = await useCase.execute({ email: 'user@asppibra.com' });

      expect(result.isSuccess).toBe(true);
      expect(mockResetRepo.create).toHaveBeenCalled();
      expect(mockOutboxRepo.saveEvent).toHaveBeenCalled();
    });
  });

  describe('ConfirmPasswordResetUseCase', () => {
    it('should update password and revoke user sessions globally via authEpoch', async () => {
      const token = 'valid-reset-token-123';
      const tokenHashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
      const tokenHash = Array.from(new Uint8Array(tokenHashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');

      const mockResetRepo = {
        consumeToken: vi.fn().mockResolvedValue(
          Result.ok({ id: 10, userId: 1, tokenHash, expiresAt: new Date(Date.now() + 3600000), usedAt: null })
        ),
      };
      const mockAuthRepo = {
        savePasswordCredential: vi.fn().mockResolvedValue('auth_pw_1'),
      };
      const mockUserRepo = {
        incrementAuthEpoch: vi.fn().mockResolvedValue(2),
      };
      const mockSessionRepo = {
        revokeAllUserSessions: vi.fn().mockResolvedValue(undefined),
      };
      const mockHasher = {
        hash: vi.fn().mockResolvedValue('$argon2id$v=19$newhash'),
      };
      const mockUow = {
        execute: vi.fn().mockImplementation(async (cb) =>
          cb({
            getPasswordResetRepository: () => mockResetRepo,
            getAuthenticationRepository: () => mockAuthRepo,
            getUserRepository: () => mockUserRepo,
            getSessionRepository: () => mockSessionRepo,
          })
        ),
      };

      const useCase = new ConfirmPasswordResetUseCase(mockUow as any, mockHasher as any);
      const result = await useCase.execute({ token, newPassword: 'newSecurePassword123!' });

      expect(result.isSuccess).toBe(true);
      expect(mockAuthRepo.savePasswordCredential).toHaveBeenCalledWith(1, '$argon2id$v=19$newhash');
      expect(mockUserRepo.incrementAuthEpoch).toHaveBeenCalledWith(1);
      expect(mockSessionRepo.revokeAllUserSessions).toHaveBeenCalledWith(1);
    });
  });

  describe('RefreshTokenUseCase', () => {
    it('should detect malicious refresh token reuse and revoke all user sessions', async () => {
      const refreshToken = 'reused-refresh-token';
      const tokenHashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(refreshToken));
      const tokenHash = Array.from(new Uint8Array(tokenHashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');

      const mockSessionRepo = {
        getSessionByRefreshTokenHash: vi.fn().mockResolvedValue({
          id: tokenHash,
          userId: 1,
          revokedAt: new Date(), // Already revoked session!
          expiresAt: new Date(Date.now() + 3600000),
        }),
        revokeAllUserSessions: vi.fn().mockResolvedValue(undefined),
      };
      const mockUserRepo = {
        incrementAuthEpoch: vi.fn().mockResolvedValue(3),
      };
      const mockUow = {
        execute: vi.fn().mockImplementation(async (cb) =>
          cb({
            getSessionRepository: () => mockSessionRepo,
            getUserRepository: () => mockUserRepo,
          })
        ),
      };
      const mockTokenService = {
        generateAccessToken: vi.fn(),
        generateRefreshToken: vi.fn(),
      };

      const useCase = new RefreshTokenUseCase(mockUow as any, mockTokenService as any);
      const result = await useCase.execute({ refreshToken });

      expect(result.isFailure).toBe(true);
      expect(result.error).toContain('Refresh token reutilizado');
      expect(mockUserRepo.incrementAuthEpoch).toHaveBeenCalledWith(1);
      expect(mockSessionRepo.revokeAllUserSessions).toHaveBeenCalledWith(1);
    });
  });
});
