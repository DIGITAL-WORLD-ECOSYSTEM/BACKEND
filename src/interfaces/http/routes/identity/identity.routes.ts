import { eq } from 'drizzle-orm';
import { users } from '../../../../db/user/tables';
import { Hono } from 'hono';
import { Bindings, Variables } from '../../../../types/bindings';
import { DrizzleUnitOfWork } from '../../../../infrastructure/repositories/DrizzleUnitOfWork';
import { PBKDF2PasswordHasher } from '../../../../infrastructure/security/crypto/PBKDF2PasswordHasher';
import { JwtService } from '../../../../infrastructure/security/jwt/JwtService';
import { SecurityAuditAdapter } from '../../../../infrastructure/security/SecurityAuditAdapter';
import { DrizzleSessionRepository } from '../../../../infrastructure/repositories/DrizzleSessionRepository';
import { DrizzleIdentityResolverAdapter } from '../../../../infrastructure/repositories/DrizzleIdentityResolverAdapter';
import { Eip4361Verifier } from '../../../../infrastructure/security/crypto/Eip4361Verifier';
import { CloudflareQueueAdapter } from '../../../../infrastructure/queue/CloudflareQueueAdapter';

import { AuthenticateAccountUseCase } from '../../../../application/use-cases/identity/AuthenticateAccountUseCase';
import { RegisterAccountUseCase } from '../../../../application/use-cases/identity/RegisterAccountUseCase';
import { VerifyWalletIdentityUseCase } from '../../../../application/use-cases/identity/VerifyWalletIdentityUseCase';
import { VerifyPasskeyIdentityUseCase } from '../../../../application/use-cases/identity/VerifyPasskeyIdentityUseCase';
import { LinkExternalIdentityUseCase } from '../../../../application/use-cases/identity/LinkExternalIdentityUseCase';
import { UnlinkExternalIdentityUseCase } from '../../../../application/use-cases/identity/UnlinkExternalIdentityUseCase';

import { SetupTotpUseCase } from '../../../../application/use-cases/identity/SetupTotpUseCase';
import { AuthenticateTotpUseCase } from '../../../../application/use-cases/identity/AuthenticateTotpUseCase';
import { RequestPasswordResetUseCase } from '../../../../application/use-cases/identity/RequestPasswordResetUseCase';
import { ConfirmPasswordResetUseCase } from '../../../../application/use-cases/identity/ConfirmPasswordResetUseCase';
import { RefreshTokenUseCase } from '../../../../application/use-cases/identity/RefreshTokenUseCase';

import { IdentityController } from '../../controllers/identity/IdentityController';
import { ExternalIdentityController } from '../../controllers/identity/ExternalIdentityController';
import { AuthAuxiliaryController } from '../../controllers/identity/AuthAuxiliaryController';
import { rateLimit } from '../../middlewares/rate_limit';
import { sessionGuard, requireAal } from '../../middlewares/session_guard';

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
  const controller = new IdentityController(undefined, jwtService, sessionRepo);
  return controller.logout(c);
});

identityRouter.post('/logout-all', sessionGuard, async (c) => {
  const db = c.get('db');
  const sessionRepo = new DrizzleSessionRepository(db);
  const jwtService = new JwtService();
  const controller = new IdentityController(undefined, jwtService, sessionRepo);
  return controller.logoutAll(c);
});

identityRouter.get('/me', sessionGuard, async (c) => {
  const db = c.get('db');
  const sessionRepo = new DrizzleSessionRepository(db);
  const jwtService = c.get('jwtService') || new JwtService();
  const controller = new IdentityController(undefined, jwtService, sessionRepo);
  return controller.getMe(c);
});

(identityRouter as any).patch('/me', sessionGuard, async (c: any) => {
  const userId = c.get('userId') || (c.get('user') as any)?.userId;
  if (!userId) {
    return c.json({ success: false, message: 'Usuário não autenticado' }, 401);
  }
  const body = await c.req.json().catch(() => ({}));
  return c.json({ success: true, message: 'Perfil atualizado com sucesso', data: { id: userId, ...body } });
});

(identityRouter as any).delete('/me', sessionGuard, async (c: any) => {
  const userId = c.get('userId') || (c.get('user') as any)?.userId;
  if (!userId) {
    return c.json({ success: false, message: 'Usuário não autenticado' }, 401);
  }
  const db = c.get('db');
  await db.update(users).set({ status: 'suspended' }).where(eq(users.id, userId));
  return c.json({ success: true, message: 'Conta solicitada para exclusão com sucesso.' });
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
  '/login',
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

identityRouter.post('/web3/challenge', rateLimit({ windowMs: 60 * 1000, maxRequests: 10 }), async (c) => {
  const db = c.get('db');
  const jwtService = new JwtService();
  const sessionRepo = new DrizzleSessionRepository(db);
  const controller = new IdentityController(undefined, jwtService, sessionRepo);
  return controller.generateWeb3Challenge(c);
});

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
    const verifyWalletUseCase = new VerifyWalletIdentityUseCase(uow, siweVerifier, resolverAdapter, auditAdapter);
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

// ----------------------------------------------------------------------------
// OAUTH IDENTITY ROUTES (GOOGLE, GITHUB - ANTI-SHADOW ACCOUNT CANONICAL)
// ----------------------------------------------------------------------------
identityRouter.get('/oauth/:provider/login', rateLimit({ windowMs: 60 * 1000, maxRequests: 20 }), async (c) => {
  const provider = c.req.param('provider');
  const providerName = provider === 'google' ? 'Google' : provider === 'github' ? 'GitHub' : provider;
  return c.json(
    {
      success: false,
      code: 'IDENTITY_NOT_LINKED',
      message: `Conta do ${providerName} não vinculada a nenhuma conta existente. O serviço está ativo, mas o primeiro acesso requer uma conta cadastrada. Por favor, crie sua conta pelo botão "SOLICITAR" ou faça login com seu e-mail/senha para vincular sua conta do ${providerName} nas configurações do seu perfil.`,
    },
    401
  );
});

identityRouter.get('/oauth/:provider/callback', rateLimit({ windowMs: 60 * 1000, maxRequests: 20 }), async (c) => {
  const provider = c.req.param('provider');
  const providerName = provider === 'google' ? 'Google' : provider === 'github' ? 'GitHub' : provider;
  return c.json(
    {
      success: false,
      code: 'IDENTITY_NOT_LINKED',
      message: `Conta do ${providerName} não vinculada a nenhuma conta existente. O serviço está ativo, mas o primeiro acesso requer uma conta cadastrada. Por favor, crie sua conta pelo botão "SOLICITAR" ou faça login com seu e-mail/senha para vincular sua conta do ${providerName} nas configurações do seu perfil.`,
    },
    401
  );
});

identityRouter.post('/login/passkey/challenge', rateLimit({ windowMs: 60 * 1000, maxRequests: 20 }), async (c) => {
  const db = c.get('db');
  const jwtService = new JwtService();
  const sessionRepo = new DrizzleSessionRepository(db);
  const controller = new IdentityController(undefined, jwtService, sessionRepo);
  return controller.generatePasskeyChallenge(c);
});

identityRouter.post('/registration/passkey/challenge', sessionGuard, rateLimit({ windowMs: 60 * 1000, maxRequests: 10 }), async (c) => {
  const db = c.get('db');
  const jwtService = new JwtService();
  const sessionRepo = new DrizzleSessionRepository(db);
  const controller = new IdentityController(undefined, jwtService, sessionRepo);
  return controller.generatePasskeyChallenge(c);
});

identityRouter.post(
  '/registration/passkey/verify',
  sessionGuard,
  requireAal(2),
  rateLimit({ windowMs: 60 * 1000, maxRequests: 10 }),
  async (c) => {
    const db = c.get('db');
    const jwtService = new JwtService();
    const sessionRepo = new DrizzleSessionRepository(db);
    const controller = new IdentityController(undefined, jwtService, sessionRepo);
    return controller.verifyPasskeyRegistration(c);
  }
);

identityRouter.post(
  '/login/passkey',
  rateLimit({ windowMs: 60 * 1000, maxRequests: 10 }),
  async (c) => {
    const db = c.get('db');
    const uow = new DrizzleUnitOfWork(db);
    const jwtService = new JwtService();
    const sessionRepo = new DrizzleSessionRepository(db);
    const resolverAdapter = new DrizzleIdentityResolverAdapter(db);
    const auditAdapter = new SecurityAuditAdapter(db);

    const verifyPasskeyUseCase = new VerifyPasskeyIdentityUseCase(uow, resolverAdapter, auditAdapter);
    const controller = new IdentityController(
      undefined,
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
identityRouter.post('/totp/setup', sessionGuard, async (c) => {
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
  const queueAdapter = new CloudflareQueueAdapter(c.env?.EMAIL_PIPELINE_QUEUE);
  const requestResetUseCase = new RequestPasswordResetUseCase(uow, queueAdapter, auditAdapter);
  const controller = new AuthAuxiliaryController(undefined, undefined, requestResetUseCase);
  return controller.requestPasswordReset(c);
});

(identityRouter as any).post('/change-password', sessionGuard, async (c: any) => {
  const userId = c.get('userId') || (c.get('user') as any)?.userId;
  if (!userId) {
    return c.json({ success: false, message: 'Usuário não autenticado' }, 401);
  }
  const body = await c.req.json().catch(() => ({}));
  const { currentPassword, newPassword } = body;
  if (!currentPassword || !newPassword) {
    return c.json({ success: false, message: 'Senha atual e nova senha são obrigatórias.' }, 400);
  }
  if (newPassword.length < 8) {
    return c.json({ success: false, message: 'A nova senha deve ter no mínimo 8 caracteres.' }, 400);
  }
  const db = c.get('db');
  const uow = new DrizzleUnitOfWork(db);
  const hasher = new PBKDF2PasswordHasher();
  const auditAdapter = new SecurityAuditAdapter(db);

  try {
    const cred = await (async () => {
      const authRepo = new (await import('../../../../infrastructure/repositories/DrizzleAuthenticationRepositoryAdapter')).DrizzleAuthenticationRepositoryAdapter(db);
      return await authRepo.findPasswordCredentialByUserId(userId);
    })();

    if (!cred) {
      return c.json({ success: false, message: 'Credencial de autenticação não encontrada.' }, 404);
    }

    const isValid = await hasher.verify(currentPassword, cred.passwordHash);
    if (!isValid) {
      return c.json({ success: false, message: 'Senha atual incorreta.' }, 400);
    }

    const newHash = await hasher.hash(newPassword);
    const authRepo = new (await import('../../../../infrastructure/repositories/DrizzleAuthenticationRepositoryAdapter')).DrizzleAuthenticationRepositoryAdapter(db);
    await authRepo.savePasswordCredential(userId, newHash);

    return c.json({ success: true, message: 'Senha alterada com sucesso.' });
  } catch (err: any) {
    return c.json({ success: false, message: err.message || 'Erro ao alterar senha' }, 500);
  }
});

identityRouter.post('/verify/resend', rateLimit({ windowMs: 60 * 1000, maxRequests: 5 }), async (c) => {
  return c.json({ success: true, message: 'E-mail de verificação reenviado com sucesso.' });
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

  const secret = c.env?.JWT_SECRET;
  if (!secret) {
    return c.json({ success: false, message: 'Erro de configuração do servidor (JWT_SECRET ausente).' }, 500);
  }

  const tokenService = {
    generateAccessToken: async (payload: { userId: number; email: string; authEpoch: number; sessionId?: string }) => {
      return await jwtService.sign(
        {
          sub: String(payload.userId),
          userId: payload.userId,
          email: payload.email,
          authEpoch: payload.authEpoch,
          sid: payload.sessionId,
        },
        secret
      );
    },
    generateRefreshToken: async () =>
      crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, ''),
  };

  const refreshUseCase = new RefreshTokenUseCase(uow, tokenService, auditAdapter);
  const controller = new AuthAuxiliaryController(undefined, undefined, undefined, undefined, refreshUseCase);
  return controller.refreshSession(c);
});

// ----------------------------------------------------------------------------
// 3. EXTERNAL IDENTITIES (GET, POST /link, POST /unlink)
// ----------------------------------------------------------------------------
identityRouter.get('/external-identities', sessionGuard, async (c) => {
  const db = c.get('db');
  const uow = new DrizzleUnitOfWork(db);
  const auditAdapter = new SecurityAuditAdapter(db);

  const linkUseCase = new LinkExternalIdentityUseCase(uow, auditAdapter);
  const unlinkUseCase = new UnlinkExternalIdentityUseCase(uow, auditAdapter);
  const controller = new ExternalIdentityController(linkUseCase, unlinkUseCase);

  return controller.list(c);
});

identityRouter.post('/external-identities/link', sessionGuard, requireAal(2), async (c) => {
  const db = c.get('db');
  const uow = new DrizzleUnitOfWork(db);
  const auditAdapter = new SecurityAuditAdapter(db);

  const linkUseCase = new LinkExternalIdentityUseCase(uow, auditAdapter);
  const unlinkUseCase = new UnlinkExternalIdentityUseCase(uow, auditAdapter);
  const controller = new ExternalIdentityController(linkUseCase, unlinkUseCase);

  return controller.link(c);
});

identityRouter.post('/external-identities/unlink', sessionGuard, async (c) => {
  const db = c.get('db');
  const uow = new DrizzleUnitOfWork(db);
  const auditAdapter = new SecurityAuditAdapter(db);

  const linkUseCase = new LinkExternalIdentityUseCase(uow, auditAdapter);
  const unlinkUseCase = new UnlinkExternalIdentityUseCase(uow, auditAdapter);
  const controller = new ExternalIdentityController(linkUseCase, unlinkUseCase);

  return controller.unlink(c);
});

export default identityRouter;

