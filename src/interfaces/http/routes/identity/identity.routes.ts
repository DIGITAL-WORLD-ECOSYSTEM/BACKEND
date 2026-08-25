import { Hono } from 'hono';
import { Bindings, Variables } from '../../../../types/bindings';
import { DrizzleUnitOfWork } from '../../../../infrastructure/repositories/DrizzleUnitOfWork';
import { PBKDF2PasswordHasher } from '../../../../infrastructure/security/crypto/PBKDF2PasswordHasher';
import { JwtService } from '../../../../infrastructure/security/jwt/JwtService';
import { SecurityAuditAdapter } from '../../../../infrastructure/security/SecurityAuditAdapter';
import { DrizzleSessionRepository } from '../../../../infrastructure/repositories/DrizzleSessionRepository';
import { AuthenticateAccountUseCase } from '../../../../domains/identity/use-cases/AuthenticateAccountUseCase';
import { RegisterAccountUseCase } from '../../../../domains/identity/use-cases/RegisterAccountUseCase';
import { LinkExternalIdentityUseCase } from '../../../../domains/identity/use-cases/LinkExternalIdentityUseCase';
import { UnlinkExternalIdentityUseCase } from '../../../../domains/identity/use-cases/UnlinkExternalIdentityUseCase';
import { IdentityController } from '../../controllers/identity/IdentityController';
import { ExternalIdentityController } from '../../controllers/identity/ExternalIdentityController';
import { rateLimit } from '../../middlewares/rate_limit';

type AppType = {
  Bindings: Bindings;
  Variables: Variables;
};

const identityRouter = new Hono<AppType>();

// ----------------------------------------------------------------------------
// 1. CANONICAL REGISTER & LOGIN
// ----------------------------------------------------------------------------
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

// ----------------------------------------------------------------------------
// 2. EXTERNAL IDENTITIES (GET, POST /link, POST /unlink)
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
