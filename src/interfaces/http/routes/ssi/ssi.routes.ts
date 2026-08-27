import { Hono } from 'hono';
import { Bindings, Variables } from '../../../../types/bindings';
import { DrizzleUnitOfWork } from '../../../../infrastructure/repositories/DrizzleUnitOfWork';
import { DrizzleSsiRepository } from '../../../../infrastructure/repositories/DrizzleSsiRepository';
import { CreateDidUseCase } from '../../../../domains/ssi/use-cases/CreateDidUseCase';
import { IssueVerifiableCredentialUseCase } from '../../../../domains/ssi/use-cases/IssueVerifiableCredentialUseCase';
import { RevokeCredentialUseCase } from '../../../../domains/ssi/use-cases/RevokeCredentialUseCase';
import { SsiController } from '../../controllers/ssi/SsiController';
import { sessionGuard, requireAal } from '../../middlewares/session_guard';
import { verifyPermission } from '../../middlewares/rbac';

type AppType = {
  Bindings: Bindings;
  Variables: Variables;
};

export const ssiRouter = new Hono<AppType>();

ssiRouter.use('*', sessionGuard);

ssiRouter.post(
  '/did',
  requireAal(2),
  verifyPermission('ssi.did.create'),
  async (c) => {
    const db = c.get('db');
  const uow = new DrizzleUnitOfWork(db);
  const ssiRepo = new DrizzleSsiRepository(db);
  const createDidUseCase = new CreateDidUseCase(uow);
  const issueVcUseCase = new IssueVerifiableCredentialUseCase(uow);
  const revokeVcUseCase = new RevokeCredentialUseCase(uow);

  const controller = new SsiController(createDidUseCase, issueVcUseCase, revokeVcUseCase, ssiRepo);
  return controller.createDid(c);
});

ssiRouter.post(
  '/credentials/issue',
  requireAal(2, 15),
  verifyPermission('ssi.credential.issue'),
  async (c) => {
    const db = c.get('db');
  const uow = new DrizzleUnitOfWork(db);
  const ssiRepo = new DrizzleSsiRepository(db);
  const createDidUseCase = new CreateDidUseCase(uow);
  const issueVcUseCase = new IssueVerifiableCredentialUseCase(uow);
  const revokeVcUseCase = new RevokeCredentialUseCase(uow);

  const controller = new SsiController(createDidUseCase, issueVcUseCase, revokeVcUseCase, ssiRepo);
  return controller.issueCredential(c);
});

ssiRouter.post(
  '/credentials/revoke',
  requireAal(2, 15),
  verifyPermission('ssi.credential.revoke'),
  async (c) => {
    const db = c.get('db');
  const uow = new DrizzleUnitOfWork(db);
  const ssiRepo = new DrizzleSsiRepository(db);
  const createDidUseCase = new CreateDidUseCase(uow);
  const issueVcUseCase = new IssueVerifiableCredentialUseCase(uow);
  const revokeVcUseCase = new RevokeCredentialUseCase(uow);

  const controller = new SsiController(createDidUseCase, issueVcUseCase, revokeVcUseCase, ssiRepo);
  return controller.revokeCredential(c);
});

ssiRouter.get(
  '/credentials',
  requireAal(1),
  verifyPermission('ssi.credential.read'),
  async (c) => {
    const db = c.get('db');
  const uow = new DrizzleUnitOfWork(db);
  const ssiRepo = new DrizzleSsiRepository(db);
  const createDidUseCase = new CreateDidUseCase(uow);
  const issueVcUseCase = new IssueVerifiableCredentialUseCase(uow);
  const revokeVcUseCase = new RevokeCredentialUseCase(uow);

  const controller = new SsiController(createDidUseCase, issueVcUseCase, revokeVcUseCase, ssiRepo);
  return controller.listMyCredentials(c);
});
