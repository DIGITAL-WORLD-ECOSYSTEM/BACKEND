import { Hono } from 'hono';
import { Bindings, Variables } from '../../../../types/bindings';
import { DrizzleUnitOfWork } from '../../../../infrastructure/repositories/DrizzleUnitOfWork';
import { PBKDF2PasswordHasher } from '../../../../infrastructure/security/crypto/PBKDF2PasswordHasher';
import { JwtService } from '../../../../infrastructure/security/jwt/JwtService';
import { SecurityAuditAdapter } from '../../../../infrastructure/security/SecurityAuditAdapter';
import { DrizzleSessionRepository } from '../../../../infrastructure/repositories/DrizzleSessionRepository';
import { DrizzleIdentityResolverAdapter } from '../../../../infrastructure/repositories/DrizzleIdentityResolverAdapter';
import { Eip4361Verifier } from '../../../../infrastructure/security/crypto/Eip4361Verifier';

import { AuthenticateAccountUseCase } from '../../../../domains/identity/use-cases/AuthenticateAccountUseCase';
import { RegisterAccountUseCase } from '../../../../domains/identity/use-cases/RegisterAccountUseCase';
import { VerifyWalletIdentityUseCase } from '../../../../domains/identity/use-cases/VerifyWalletIdentityUseCase';
import { VerifyPasskeyIdentityUseCase } from '../../../../domains/identity/use-cases/VerifyPasskeyIdentityUseCase';
import { LinkExternalIdentityUseCase } from '../../../../domains/identity/use-cases/LinkExternalIdentityUseCase';
import { UnlinkExternalIdentityUseCase } from '../../../../domains/identity/use-cases/UnlinkExternalIdentityUseCase';

import { SetupTotpUseCase } from '../../../../domains/identity/use-cases/SetupTotpUseCase';
import { AuthenticateTotpUseCase } from '../../../../domains/identity/use-cases/AuthenticateTotpUseCase';
import { RequestPasswordResetUseCase } from '../../../../domains/identity/use-cases/RequestPasswordResetUseCase';
import { ConfirmPasswordResetUseCase } from '../../../../domains/identity/use-cases/ConfirmPasswordResetUseCase';
import { RefreshTokenUseCase } from '../../../../domains/identity/use-cases/RefreshTokenUseCase';

import { IdentityController } from '../../controllers/identity/IdentityController';
import { ExternalIdentityController } from '../../controllers/identity/ExternalIdentityController';
import { AuthAuxiliaryController } from '../../controllers/identity/AuthAuxiliaryController';
import { rateLimit } from '../../middlewares/rate_limit';
import { sessionGuard } from '../../middlewares/session_guard';

type AppType = {
  Bindings: Bindings;
  Variables: Variables;
};

const identityRouter = new Hono<AppType>();

// ----------------------------------------------------------------------------
// 1. CANONICAL REGISTER & LOGIN (LOCAL, WEB3 SIWE, PASSKEY, LOGOUT)
// ----------------------------------------------------------------------------
identityRouter.post('/logout', sessionGuard, async (c) => {
  const db = c.get('db');
  const sessionRepo = new DrizzleSessionRepository(db);
  const jwtService = new JwtService();
  const controller = new IdentityController(undefined as any, jwtService, sessionRepo);
  return controller.logout(c);
});

identityRouter.post('/logout-all', sessionGuard, async (c) => {
  const db = c.get('db');
  const sessionRepo = new DrizzleSessionRepository(db);
  const jwtService = new JwtService();
  const controller = new IdentityController(undefined as any, jwtService, sessionRepo);
  return controller.logoutAll(c);
});

identityRouter.post(
  '/register',
  rateLimit({ windowMs: 60 * 1000, maxRequests: 5 }),
  async (c) => {
    const db = c.get('db');
    const uow = new DrizzleUnitOfWork(db);
    const hasher = new PBKDF2PasswordHasher();
    const jwtService = new JwtService();
    const auditAdapter = new SecurityAuditAdapter(db);
    const sessionRepo = new DrizzleSessionRepository(db);

    const authenticateUseCase = new AuthenticateAccountUseCase(uow, hasher, auditAdapter);
    const registerUseCase = new RegisterAccountUseCase(uow, hasher, auditAdapter);
    const controller = new IdentityController(authenticateUseCase, jwtService, sessionRepo, registerUseCase);

    return controller.register(c);
  }
);

identityRouter.post(
  '/login/local',
  rateLimit({ windowMs: 60 * 1000, maxRequests: 10 }),
  async (c) => {
    const db = c.get('db');
    const uow = new DrizzleUnitOfWork(db);
    const hasher = new PBKDF2PasswordHasher();
    const jwtService = new JwtService();
    const auditAdapter = new SecurityAuditAdapter(db);
    const sessionRepo = new DrizzleSessionRepository(db);

    const authenticateUseCase = new AuthenticateAccountUseCase(uow, hasher, auditAdapter);
    const controller = new IdentityController(authenticateUseCase, jwtService, sessionRepo);

    return controller.loginLocal(c);
  }
);

identityRouter.post(
  '/login/web3',
  rateLimit({ windowMs: 60 * 1000, maxRequests: 10 }),
  async (c) => {
    const db = c.get('db');
    const uow = new DrizzleUnitOfWork(db);
    const hasher = new PBKDF2PasswordHasher();
    const jwtService = new JwtService();
    const auditAdapter = new SecurityAuditAdapter(db);
    const sessionRepo = new DrizzleSessionRepository(db);
    const resolverAdapter = new DrizzleIdentityResolverAdapter(db);
    const siweVerifier = new Eip4361Verifier();

    const authenticateUseCase = new AuthenticateAccountUseCase(uow, hasher, auditAdapter);
    const verifyWalletUseCase = new VerifyWalletIdentityUseCase(siweVerifier, resolverAdapter, auditAdapter);
    const controller = new IdentityController(
      authenticateUseCase,
      jwtService,
      sessionRepo,
      undefined,
      verifyWalletUseCase
    );

    return controller.loginWeb3(c);
  }
);

identityRouter.post(
  '/login/passkey',
  rateLimit({ windowMs: 60 * 1000, maxRequests: 10 }),
  async (c) => {
    const db = c.get('db');
    const uow = new DrizzleUnitOfWork(db);
    const hasher = new PBKDF2PasswordHasher();
    const jwtService = new JwtService();
    const auditAdapter = new SecurityAuditAdapter(db);
    const sessionRepo = new DrizzleSessionRepository(db);
    const resolverAdapter = new DrizzleIdentityResolverAdapter(db);

    const authenticateUseCase = new AuthenticateAccountUseCase(uow, hasher, auditAdapter);
    const verifyPasskeyUseCase = new VerifyPasskeyIdentityUseCase(resolverAdapter, auditAdapter);
    const controller = new IdentityController(
      authenticateUseCase,
      jwtService,
      sessionRepo,
      undefined,
      undefined,
      verifyPasskeyUseCase
    );

    return controller.loginPasskey(c);
  }
);

// ----------------------------------------------------------------------------
// 2. AUXILIARY AUTHENTICATION (2FA / TOTP, PASSWORD RESET, REFRESH SESSION)
// ----------------------------------------------------------------------------
identityRouter.post('/totp/setup', async (c) => {
  const db = c.get('db');
  const uow = new DrizzleUnitOfWork(db);
  const setupTotpUseCase = new SetupTotpUseCase(uow);
  const controller = new AuthAuxiliaryController(setupTotpUseCase);
  return controller.setupTotp(c);
});

identityRouter.post('/totp/verify', rateLimit({ windowMs: 60 * 1000, maxRequests: 5 }), async (c) => {
  const db = c.get('db');
  const uow = new DrizzleUnitOfWork(db);
  const auditAdapter = new SecurityAuditAdapter(db);
  const authTotpUseCase = new AuthenticateTotpUseCase(uow, auditAdapter);
  const controller = new AuthAuxiliaryController(undefined, authTotpUseCase);
  return controller.verifyTotp(c);
});

identityRouter.post('/password-reset/request', rateLimit({ windowMs: 60 * 1000, maxRequests: 3 }), async (c) => {
  const db = c.get('db');
  const uow = new DrizzleUnitOfWork(db);
  const auditAdapter = new SecurityAuditAdapter(db);
  const requestResetUseCase = new RequestPasswordResetUseCase(uow, auditAdapter);
  const controller = new AuthAuxiliaryController(undefined, undefined, requestResetUseCase);
  return controller.requestPasswordReset(c);
});

identityRouter.post('/password-reset/confirm', rateLimit({ windowMs: 60 * 1000, maxRequests: 5 }), async (c) => {
  const db = c.get('db');
  const uow = new DrizzleUnitOfWork(db);
  const hasher = new PBKDF2PasswordHasher();
  const auditAdapter = new SecurityAuditAdapter(db);
  const confirmResetUseCase = new ConfirmPasswordResetUseCase(uow, hasher, auditAdapter);
  const controller = new AuthAuxiliaryController(undefined, undefined, undefined, confirmResetUseCase);
  return controller.confirmPasswordReset(c);
});

identityRouter.post('/refresh', rateLimit({ windowMs: 60 * 1000, maxRequests: 20 }), async (c) => {
  const db = c.get('db');
  const uow = new DrizzleUnitOfWork(db);
  const jwtService = new JwtService();
  const auditAdapter = new SecurityAuditAdapter(db);

  const tokenService = {
    generateAccessToken: async (payload: { userId: number; email: string; authEpoch: number }) => {
      const secret = c.env?.JWT_SECRET || 'asppibra-secret-key-change-in-production';
      return await jwtService.sign(
        { sub: String(payload.userId), userId: payload.userId, email: payload.email, authEpoch: payload.authEpoch },
        secret
      );
    },
    generateRefreshToken: async () => crypto.randomUUID(),
  };

  const refreshUseCase = new RefreshTokenUseCase(uow, tokenService, auditAdapter);
  const controller = new AuthAuxiliaryController(undefined, undefined, undefined, undefined, refreshUseCase);
  return controller.refreshSession(c);
});

// ----------------------------------------------------------------------------
// 3. EXTERNAL IDENTITIES (GET, POST /link, POST /unlink)
// ----------------------------------------------------------------------------
identityRouter.get('/external-identities', async (c) => {
  const db = c.get('db');
  const uow = new DrizzleUnitOfWork(db);
  const auditAdapter = new SecurityAuditAdapter(db);

  const linkUseCase = new LinkExternalIdentityUseCase(uow, auditAdapter);
  const unlinkUseCase = new UnlinkExternalIdentityUseCase(uow, auditAdapter);
  const controller = new ExternalIdentityController(linkUseCase, unlinkUseCase);

  return controller.list(c);
});

identityRouter.post('/external-identities/link', async (c) => {
  const db = c.get('db');
  const uow = new DrizzleUnitOfWork(db);
  const auditAdapter = new SecurityAuditAdapter(db);

  const linkUseCase = new LinkExternalIdentityUseCase(uow, auditAdapter);
  const unlinkUseCase = new UnlinkExternalIdentityUseCase(uow, auditAdapter);
  const controller = new ExternalIdentityController(linkUseCase, unlinkUseCase);

  return controller.link(c);
});

identityRouter.post('/external-identities/unlink', async (c) => {
  const db = c.get('db');
  const uow = new DrizzleUnitOfWork(db);
  const auditAdapter = new SecurityAuditAdapter(db);

  const linkUseCase = new LinkExternalIdentityUseCase(uow, auditAdapter);
  const unlinkUseCase = new UnlinkExternalIdentityUseCase(uow, auditAdapter);
  const controller = new ExternalIdentityController(linkUseCase, unlinkUseCase);

  return controller.unlink(c);
});

export default identityRouter;

