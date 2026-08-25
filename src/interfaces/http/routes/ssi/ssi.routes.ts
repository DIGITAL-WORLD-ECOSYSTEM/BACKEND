import { Hono } from 'hono';
import { Bindings, Variables } from '../../../../types/bindings';
import { DrizzleUnitOfWork } from '../../../../infrastructure/repositories/DrizzleUnitOfWork';
import { DrizzleSsiRepository } from '../../../../infrastructure/repositories/DrizzleSsiRepository';
import { CreateDidUseCase } from '../../../../domains/ssi/use-cases/CreateDidUseCase';
import { IssueVerifiableCredentialUseCase } from '../../../../domains/ssi/use-cases/IssueVerifiableCredentialUseCase';
import { RevokeCredentialUseCase } from '../../../../domains/ssi/use-cases/RevokeCredentialUseCase';
import { SsiController } from '../../controllers/ssi/SsiController';
import { sessionGuard } from '../../middlewares/session_guard';

type AppType = {
  Bindings: Bindings;
  Variables: Variables;
};

export const ssiRouter = new Hono<AppType>();

ssiRouter.use('*', sessionGuard);

ssiRouter.post('/did', async (c) => {
  const db = c.get('db');
  const uow = new DrizzleUnitOfWork(db);
  const ssiRepo = new DrizzleSsiRepository(db);
  const createDidUseCase = new CreateDidUseCase(uow);
  const issueVcUseCase = new IssueVerifiableCredentialUseCase(uow);
  const revokeVcUseCase = new RevokeCredentialUseCase(uow);

  const controller = new SsiController(createDidUseCase, issueVcUseCase, revokeVcUseCase, ssiRepo);
  return controller.createDid(c);
});

ssiRouter.post('/credentials/issue', async (c) => {
  const db = c.get('db');
  const uow = new DrizzleUnitOfWork(db);
  const ssiRepo = new DrizzleSsiRepository(db);
  const createDidUseCase = new CreateDidUseCase(uow);
  const issueVcUseCase = new IssueVerifiableCredentialUseCase(uow);
  const revokeVcUseCase = new RevokeCredentialUseCase(uow);

  const controller = new SsiController(createDidUseCase, issueVcUseCase, revokeVcUseCase, ssiRepo);
  return controller.issueCredential(c);
});

ssiRouter.post('/credentials/revoke', async (c) => {
  const db = c.get('db');
  const uow = new DrizzleUnitOfWork(db);
  const ssiRepo = new DrizzleSsiRepository(db);
  const createDidUseCase = new CreateDidUseCase(uow);
  const issueVcUseCase = new IssueVerifiableCredentialUseCase(uow);
  const revokeVcUseCase = new RevokeCredentialUseCase(uow);

  const controller = new SsiController(createDidUseCase, issueVcUseCase, revokeVcUseCase, ssiRepo);
  return controller.revokeCredential(c);
});

ssiRouter.get('/credentials', async (c) => {
  const db = c.get('db');
  const uow = new DrizzleUnitOfWork(db);
  const ssiRepo = new DrizzleSsiRepository(db);
  const createDidUseCase = new CreateDidUseCase(uow);
  const issueVcUseCase = new IssueVerifiableCredentialUseCase(uow);
  const revokeVcUseCase = new RevokeCredentialUseCase(uow);

  const controller = new SsiController(createDidUseCase, issueVcUseCase, revokeVcUseCase, ssiRepo);
  return controller.listMyCredentials(c);
});
