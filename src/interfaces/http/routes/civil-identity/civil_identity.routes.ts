import { Hono } from 'hono';
import { Bindings, Variables } from '../../../../types/bindings';
import { DrizzleUnitOfWork } from '../../../../infrastructure/repositories/DrizzleUnitOfWork';
import { DrizzleCivilIdentityRepositoryAdapter } from '../../../../infrastructure/repositories/DrizzleCivilIdentityRepositoryAdapter';
import { RegisterCitizenUseCase } from '../../../../domains/civil-identity/use-cases/RegisterCitizenUseCase';
import { SubmitKycVerificationUseCase } from '../../../../domains/civil-identity/use-cases/SubmitKycVerificationUseCase';
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
  const uow = new DrizzleUnitOfWork(db);
  const civilRepo = new DrizzleCivilIdentityRepositoryAdapter(db);
  const registerUseCase = new RegisterCitizenUseCase(uow);
  const submitKycUseCase = new SubmitKycVerificationUseCase(uow);

  const controller = new CivilIdentityController(registerUseCase, submitKycUseCase, civilRepo);
  return controller.register(c);
});

civilIdentityRouter.post('/kyc/submit', async (c) => {
  const db = c.get('db');
  const uow = new DrizzleUnitOfWork(db);
  const civilRepo = new DrizzleCivilIdentityRepositoryAdapter(db);
  const registerUseCase = new RegisterCitizenUseCase(uow);
  const submitKycUseCase = new SubmitKycVerificationUseCase(uow);

  const controller = new CivilIdentityController(registerUseCase, submitKycUseCase, civilRepo);
  return controller.submitKyc(c);
});

civilIdentityRouter.get('/me', async (c) => {
  const db = c.get('db');
  const uow = new DrizzleUnitOfWork(db);
  const civilRepo = new DrizzleCivilIdentityRepositoryAdapter(db);
  const registerUseCase = new RegisterCitizenUseCase(uow);
  const submitKycUseCase = new SubmitKycVerificationUseCase(uow);

  const controller = new CivilIdentityController(registerUseCase, submitKycUseCase, civilRepo);
  return controller.getMe(c);
});
