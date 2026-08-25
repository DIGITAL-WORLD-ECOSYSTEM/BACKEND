import { Hono } from 'hono';
import { Bindings, Variables } from '../../../../types/bindings';
import { DrizzleUnitOfWork } from '../../../../infrastructure/repositories/DrizzleUnitOfWork';
import { PBKDF2PasswordHasher } from '../../../../infrastructure/security/crypto/PBKDF2PasswordHasher';
import { JwtService } from '../../../../infrastructure/security/jwt/JwtService';
import { SecurityAuditAdapter } from '../../../../infrastructure/security/SecurityAuditAdapter';
import { DrizzleSessionRepository } from '../../../../infrastructure/repositories/DrizzleSessionRepository';
import { AuthenticateAccountUseCase } from '../../../../domains/identity/use-cases/AuthenticateAccountUseCase';
import { IdentityController } from '../../controllers/identity/IdentityController';
import { rateLimit } from '../../middlewares/rate_limit';

type AppType = {
  Bindings: Bindings;
  Variables: Variables;
};

const identityRouter = new Hono<AppType>();

identityRouter.post(
  '/login/local',
  rateLimit({ windowMs: 60 * 1000, maxRequests: 5 }),
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

export default identityRouter;
