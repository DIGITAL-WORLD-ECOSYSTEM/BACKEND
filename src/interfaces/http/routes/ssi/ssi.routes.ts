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
  const rawSecret = env.JWT_SECRET || 'asppibra_root_issuer_fallback_secret_32';
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(`SSI_ISSUER_KEY:${rawSecret}`));
  const seedBytes = new Uint8Array(hashBuffer);
  return new LocalIssuerSigner(seedBytes);
}

ssiRouter.post(
  '/did',
  requireAal(2),
  verifyPermission('ssi.did.create'),
  async (c) => {
    const db = c.get('db');
    const ssiRepo = new DrizzleSsiRepository(db);
    const signer = await getIssuerSigner(c.env);
    const vault = new WebCryptoVaultAdapter();
    const encryptionKey = c.env.TOTP_ENCRYPTION_KEY || c.env.JWT_SECRET;

    const createDidUseCase = new CreateDidUseCase(ssiRepo);
    const issueVcUseCase = new IssueVerifiableCredentialUseCase(ssiRepo, signer, vault, encryptionKey);
    const revokeVcUseCase = new RevokeCredentialUseCase(ssiRepo);
    const verifyVcUseCase = new VerifyVerifiableCredentialUseCase(ssiRepo, signer);

    const controller = new SsiController(createDidUseCase, issueVcUseCase, revokeVcUseCase, ssiRepo, verifyVcUseCase);
    return controller.createDid(c);
  }
);

ssiRouter.post(
  '/credentials/issue',
  requireAal(2, 15),
  verifyPermission('ssi.credential.issue'),
  async (c) => {
    const db = c.get('db');
    const ssiRepo = new DrizzleSsiRepository(db);
    const signer = await getIssuerSigner(c.env);
    const vault = new WebCryptoVaultAdapter();
    const encryptionKey = c.env.TOTP_ENCRYPTION_KEY || c.env.JWT_SECRET;

    const createDidUseCase = new CreateDidUseCase(ssiRepo);
    const issueVcUseCase = new IssueVerifiableCredentialUseCase(ssiRepo, signer, vault, encryptionKey);
    const revokeVcUseCase = new RevokeCredentialUseCase(ssiRepo);
    const verifyVcUseCase = new VerifyVerifiableCredentialUseCase(ssiRepo, signer);

    const controller = new SsiController(createDidUseCase, issueVcUseCase, revokeVcUseCase, ssiRepo, verifyVcUseCase);
    return controller.issueCredential(c);
  }
);

ssiRouter.post(
  '/credentials/revoke',
  requireAal(2, 15),
  verifyPermission('ssi.credential.revoke'),
  async (c) => {
    const db = c.get('db');
    const ssiRepo = new DrizzleSsiRepository(db);
    const signer = await getIssuerSigner(c.env);
    const vault = new WebCryptoVaultAdapter();
    const encryptionKey = c.env.TOTP_ENCRYPTION_KEY || c.env.JWT_SECRET;

    const createDidUseCase = new CreateDidUseCase(ssiRepo);
    const issueVcUseCase = new IssueVerifiableCredentialUseCase(ssiRepo, signer, vault, encryptionKey);
    const revokeVcUseCase = new RevokeCredentialUseCase(ssiRepo);
    const verifyVcUseCase = new VerifyVerifiableCredentialUseCase(ssiRepo, signer);

    const controller = new SsiController(createDidUseCase, issueVcUseCase, revokeVcUseCase, ssiRepo, verifyVcUseCase);
    return controller.revokeCredential(c);
  }
);

ssiRouter.get(
  '/credentials',
  requireAal(1),
  verifyPermission('ssi.credential.read'),
  async (c) => {
    const db = c.get('db');
    const ssiRepo = new DrizzleSsiRepository(db);
    const signer = await getIssuerSigner(c.env);
    const vault = new WebCryptoVaultAdapter();
    const encryptionKey = c.env.TOTP_ENCRYPTION_KEY || c.env.JWT_SECRET;

    const createDidUseCase = new CreateDidUseCase(ssiRepo);
    const issueVcUseCase = new IssueVerifiableCredentialUseCase(ssiRepo, signer, vault, encryptionKey);
    const revokeVcUseCase = new RevokeCredentialUseCase(ssiRepo);
    const verifyVcUseCase = new VerifyVerifiableCredentialUseCase(ssiRepo, signer);

    const controller = new SsiController(createDidUseCase, issueVcUseCase, revokeVcUseCase, ssiRepo, verifyVcUseCase);
    return controller.listMyCredentials(c);
  }
);

ssiRouter.post('/credentials/verify', async (c) => {
  const db = c.get('db');
  const ssiRepo = new DrizzleSsiRepository(db);
  const signer = await getIssuerSigner(c.env);
  const vault = new WebCryptoVaultAdapter();
  const encryptionKey = c.env.TOTP_ENCRYPTION_KEY || c.env.JWT_SECRET;

  const createDidUseCase = new CreateDidUseCase(ssiRepo);
  const issueVcUseCase = new IssueVerifiableCredentialUseCase(ssiRepo, signer, vault, encryptionKey);
  const revokeVcUseCase = new RevokeCredentialUseCase(ssiRepo);
  const verifyVcUseCase = new VerifyVerifiableCredentialUseCase(ssiRepo, signer);

  const controller = new SsiController(createDidUseCase, issueVcUseCase, revokeVcUseCase, ssiRepo, verifyVcUseCase);
  return controller.verifyCredential(c);
});

