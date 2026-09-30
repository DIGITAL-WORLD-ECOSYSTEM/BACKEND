import { Hono } from 'hono';
import { Bindings, Variables } from '../../../../types/bindings';
import { DrizzleCivilIdentityRepositoryAdapter } from '../../../../infrastructure/repositories/DrizzleCivilIdentityRepositoryAdapter';
import { WebCryptoVaultAdapter } from '../../../../infrastructure/security/crypto/WebCryptoVaultAdapter';
import { RegisterCitizenUseCase } from '../../../../application/use-cases/civil-identity/RegisterCitizenUseCase';
import { SubmitKycVerificationUseCase } from '../../../../application/use-cases/civil-identity/SubmitKycVerificationUseCase';
import { CivilIdentityController } from '../../controllers/civil-identity/CivilIdentityController';
import { sessionGuard } from '../../middlewares/session_guard';

type AppType = {
  Bindings: Bindings;
  Variables: Variables;
};

export const civilIdentityRouter = new Hono<AppType>();

civilIdentityRouter.use('*', sessionGuard);

civilIdentityRouter.post('/register', async (c) => {
  const db = c.get('db');
  const civilRepo = new DrizzleCivilIdentityRepositoryAdapter(db);
  const vault = new WebCryptoVaultAdapter();
  const encryptionKey = c.env.TOTP_ENCRYPTION_KEY || c.env.JWT_SECRET;
  const registerUseCase = new RegisterCitizenUseCase(civilRepo);
  const submitKycUseCase = new SubmitKycVerificationUseCase(civilRepo, vault, encryptionKey);

  const controller = new CivilIdentityController(registerUseCase, submitKycUseCase, civilRepo);
  return controller.register(c);
});

civilIdentityRouter.post('/kyc/submit', async (c) => {
  const db = c.get('db');
  const civilRepo = new DrizzleCivilIdentityRepositoryAdapter(db);
  const vault = new WebCryptoVaultAdapter();
  const encryptionKey = c.env.TOTP_ENCRYPTION_KEY || c.env.JWT_SECRET;
  const registerUseCase = new RegisterCitizenUseCase(civilRepo);
  const submitKycUseCase = new SubmitKycVerificationUseCase(civilRepo, vault, encryptionKey);

  const controller = new CivilIdentityController(registerUseCase, submitKycUseCase, civilRepo);
  return controller.submitKyc(c);
});

civilIdentityRouter.get('/me', async (c) => {
  const db = c.get('db');
  const civilRepo = new DrizzleCivilIdentityRepositoryAdapter(db);
  const vault = new WebCryptoVaultAdapter();
  const encryptionKey = c.env.TOTP_ENCRYPTION_KEY || c.env.JWT_SECRET;
  const registerUseCase = new RegisterCitizenUseCase(civilRepo);
  const submitKycUseCase = new SubmitKycVerificationUseCase(civilRepo, vault, encryptionKey);

  const controller = new CivilIdentityController(registerUseCase, submitKycUseCase, civilRepo);
  return controller.getMe(c);
});

