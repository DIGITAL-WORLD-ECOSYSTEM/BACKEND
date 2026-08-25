import { describe, it, expect, vi } from 'vitest';
import { SetupTotpUseCase } from './SetupTotpUseCase';
import { AuthenticateTotpUseCase } from './AuthenticateTotpUseCase';
import { RequestPasswordResetUseCase } from './RequestPasswordResetUseCase';
import { ConfirmPasswordResetUseCase } from './ConfirmPasswordResetUseCase';
import { RefreshTokenUseCase } from './RefreshTokenUseCase';
import { authenticator } from 'otplib';

describe('Auxiliary Authentication Use Cases Suite', () => {
  describe('SetupTotpUseCase', () => {
    it('should generate valid secret and otpauthUrl for existing user', async () => {
      const mockUserRepo = {
        findById: vi.fn().mockResolvedValue({ id: 1, email: 'user@asppibra.com' }),
      };
      const mockAuthRepo = {
        saveTotpSecret: vi.fn().mockResolvedValue('auth_123'),
      };
      const mockUow = {
        execute: vi.fn().mockImplementation(async (cb) =>
          cb({
            getUserRepository: () => mockUserRepo,
            getAuthenticationRepository: () => mockAuthRepo,
          })
        ),
      };

      const useCase = new SetupTotpUseCase(mockUow as any);
      const result = await useCase.execute({ userId: 1 });

      expect(result.isSuccess).toBe(true);
      expect(result.getValue().secret).toBeDefined();
      expect(result.getValue().otpauthUrl).toContain('otpauth://totp/ASPPIBRA');
    });
  });

  describe('AuthenticateTotpUseCase', () => {
    it('should verify valid 2FA TOTP code', async () => {
      const secret = authenticator.generateSecret();
      const code = authenticator.generate(secret);

      const mockAuthRepo = {
        findTotpCredentialByUserId: vi.fn().mockResolvedValue({
          authenticatorId: 'auth_123',
          userId: 1,
          encryptedTotpSecret: secret,
          verified: false,
        }),
        verifyTotpAuthenticator: vi.fn().mockResolvedValue(undefined),
      };
      const mockUow = {
        execute: vi.fn().mockImplementation(async (cb) =>
          cb({
            getAuthenticationRepository: () => mockAuthRepo,
          })
        ),
      };

      const useCase = new AuthenticateTotpUseCase(mockUow as any);
      const result = await useCase.execute({ userId: 1, code });

      expect(result.isSuccess).toBe(true);
      expect(result.getValue().verified).toBe(true);
      expect(result.getValue().aal).toBe(2);
      expect(mockAuthRepo.verifyTotpAuthenticator).toHaveBeenCalledWith('auth_123');
    });

    it('should reject invalid 2FA TOTP code', async () => {
      const secret = authenticator.generateSecret();
      const mockAuthRepo = {
        findTotpCredentialByUserId: vi.fn().mockResolvedValue({
          authenticatorId: 'auth_123',
          userId: 1,
          encryptedTotpSecret: secret,
          verified: true,
        }),
      };
      const mockUow = {
        execute: vi.fn().mockImplementation(async (cb) =>
          cb({
            getAuthenticationRepository: () => mockAuthRepo,
          })
        ),
      };

      const useCase = new AuthenticateTotpUseCase(mockUow as any);
      const result = await useCase.execute({ userId: 1, code: '000000' });

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
      const mockUow = {
        execute: vi.fn().mockImplementation(async (cb) =>
          cb({
            getUserRepository: () => mockUserRepo,
            getPasswordResetRepository: () => mockResetRepo,
            getOutboxRepository: () => mockOutboxRepo,
          })
        ),
      };

      const useCase = new RequestPasswordResetUseCase(mockUow as any);
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
        findByToken: vi.fn().mockResolvedValue({
          isFailure: false,
          getValue: () => ({ id: 10, userId: 1, tokenHash, expiresAt: new Date(Date.now() + 3600000), usedAt: null }),
        }),
        invalidate: vi.fn().mockResolvedValue({ isSuccess: true }),
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
        getSessionById: vi.fn().mockResolvedValue({
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
