import { Hono } from 'hono';
import { Bindings, Variables } from '../../../../types/bindings';
import { DrizzleSsiRepository } from '../../../../infrastructure/repositories/DrizzleSsiRepository';
import { WebCryptoVaultAdapter } from '../../../../infrastructure/security/crypto/WebCryptoVaultAdapter';
import { CreateDidUseCase } from '../../../../application/use-cases/ssi/CreateDidUseCase';
import { IssueVerifiableCredentialUseCase } from '../../../../application/use-cases/ssi/IssueVerifiableCredentialUseCase';
import { RevokeCredentialUseCase } from '../../../../application/use-cases/ssi/RevokeCredentialUseCase';
import { VerifyVerifiableCredentialUseCase } from '../../../../application/use-cases/ssi/VerifyVerifiableCredentialUseCase';
import { LocalIssuerSigner } from '../../../../infrastructure/security/crypto/LocalIssuerSigner';
import { SsiController } from '../../controllers/ssi/SsiController';
import { sessionGuard, requireAal } from '../../middlewares/session_guard';
import { verifyPermission } from '../../middlewares/rbac';

type AppType = {
  Bindings: Bindings;
  Variables: Variables;
};

export const ssiRouter = new Hono<AppType>();

ssiRouter.use('*', sessionGuard);

async function getIssuerSigner(env: Bindings): Promise<LocalIssuerSigner> {
  const dedicatedSecret = env.SSI_ISSUER_PRIVATE_KEY || env.SSI_ISSUER_SEED;
  const rawSecret = dedicatedSecret || env.JWT_SECRET;
  if (!rawSecret) {
    throw new Error('SSI_ISSUER_PRIVATE_KEY, SSI_ISSUER_SEED ou JWT_SECRET deve estar configurado no ambiente.');
  }
  const encoder = new TextEncoder();
  const domainPrefix = dedicatedSecret ? 'ASPPIBRA_SSI_DEDICATED_ROOT_ISSUER:' : 'ASPPIBRA_SSI_ISOLATED_FALLBACK_SEED:';
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(`${domainPrefix}${rawSecret}`));
  const seedBytes = new Uint8Array(hashBuffer);
  return new LocalIssuerSigner(seedBytes);
}

function buildSsiController(db: any, env: Bindings, signer: LocalIssuerSigner): SsiController {
  const ssiRepo = new DrizzleSsiRepository(db);
  const vault = new WebCryptoVaultAdapter();
  const encryptionKey = env.TOTP_ENCRYPTION_KEY || env.JWT_SECRET;

  const createDidUseCase = new CreateDidUseCase(ssiRepo);
  const issueVcUseCase = new IssueVerifiableCredentialUseCase(ssiRepo, signer, vault, encryptionKey);
  const revokeVcUseCase = new RevokeCredentialUseCase(ssiRepo);
  const verifyVcUseCase = new VerifyVerifiableCredentialUseCase(ssiRepo, signer);

  return new SsiController(
    createDidUseCase,
    issueVcUseCase,
    revokeVcUseCase,
    ssiRepo,
    verifyVcUseCase,
    vault,
    encryptionKey
  );
}

ssiRouter.post(
  '/did',
  requireAal(2),
  verifyPermission('ssi.did.create'),
  async (c) => {
    const db = c.get('db');
    const signer = await getIssuerSigner(c.env);
    const controller = buildSsiController(db, c.env, signer);
    return controller.createDid(c);
  }
);

ssiRouter.post(
  '/credentials/issue',
  requireAal(2, 15),
  verifyPermission('ssi.credential.issue'),
  async (c) => {
    const db = c.get('db');
    const signer = await getIssuerSigner(c.env);
    const controller = buildSsiController(db, c.env, signer);
    return controller.issueCredential(c);
  }
);

ssiRouter.post(
  '/credentials/revoke',
  requireAal(2, 15),
  verifyPermission('ssi.credential.revoke'),
  async (c) => {
    const db = c.get('db');
    const signer = await getIssuerSigner(c.env);
    const controller = buildSsiController(db, c.env, signer);
    return controller.revokeCredential(c);
  }
);

ssiRouter.get(
  '/credentials',
  requireAal(1),
  verifyPermission('ssi.credential.read'),
  async (c) => {
    const db = c.get('db');
    const signer = await getIssuerSigner(c.env);
    const controller = buildSsiController(db, c.env, signer);
    return controller.listMyCredentials(c);
  }
);

ssiRouter.post('/credentials/verify', async (c) => {
  const db = c.get('db');
  const signer = await getIssuerSigner(c.env);
  const controller = buildSsiController(db, c.env, signer);
  return controller.verifyCredential(c);
});
