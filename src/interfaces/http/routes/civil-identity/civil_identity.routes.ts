import { eq, inArray } from 'drizzle-orm';
import { users } from '../../../../db/user/tables';
import { citizens } from '../../../../db/civil-identity/tables';
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


// ============================================================================
// CANONICAL CITIZENS RESOURCE (/api/v1/civil/citizens)
// ============================================================================

civilIdentityRouter.get('/citizens', async (c) => {
  const db = c.get('db');
  try {
    const results = await db
      .select({
        id: users.id,
        username: citizens.username,
        firstName: citizens.legalFirstName,
        lastName: citizens.legalLastName,
        email: users.email,
        civilStatus: citizens.civilStatus,
        kycStatus: users.status,
      })
      .from(users)
      .leftJoin(citizens, eq(users.id, citizens.userId))
      .limit(100);

    const data = results.map((r: any) => ({
      id: r.id,
      username: r.username || (r.email ? r.email.split('@')[0] : `user_${r.id}`),
      firstName: r.firstName || '',
      lastName: r.lastName || '',
      cargoOsc: 'ASPPIBRA',
      did: null,
      avatarUrl: null,
      kycStatus: r.civilStatus === 'verified' ? 'approved' : 'pending',
      role: 'citizen',
      phoneNumber: null,
      email: r.email || '',
    }));

    return c.json({ success: true, data });
  } catch (err: any) {
    return c.json({ success: false, message: err.message, data: [] }, 500);
  }
});

civilIdentityRouter.get('/citizens/:id', async (c) => {
  const db = c.get('db');
  const id = Number(c.req.param('id'));
  try {
    const results = await db
      .select({
        id: users.id,
        username: citizens.username,
        firstName: citizens.legalFirstName,
        lastName: citizens.legalLastName,
        email: users.email,
        civilStatus: citizens.civilStatus,
        kycStatus: users.status,
      })
      .from(users)
      .leftJoin(citizens, eq(users.id, citizens.userId))
      .where(eq(users.id, id))
      .limit(1);

    if (!results || results.length === 0) {
      return c.json({ success: false, message: 'Cidadão não encontrado' }, 404);
    }
    const r = results[0];
    return c.json({
      success: true,
      data: {
        id: r.id,
        username: r.username || (r.email ? r.email.split('@')[0] : `user_${r.id}`),
        firstName: r.firstName || '',
        lastName: r.lastName || '',
        cargoOsc: 'ASPPIBRA',
        did: null,
        avatarUrl: null,
        kycStatus: r.civilStatus === 'verified' ? 'approved' : 'pending',
        role: 'citizen',
        phoneNumber: null,
        email: r.email || '',
      },
    });
  } catch (err: any) {
    return c.json({ success: false, message: err.message }, 500);
  }
});

civilIdentityRouter.patch('/citizens/:id', async (c) => {
  const db = c.get('db');
  const id = Number(c.req.param('id'));
  const body = await c.req.json().catch(() => ({}));
  try {
    if (body.firstName || body.lastName) {
      await db
        .update(citizens)
        .set({
          legalFirstName: body.firstName,
          legalLastName: body.lastName,
          updatedAt: new Date(),
        })
        .where(eq(citizens.userId, id));
    }
    return c.json({ success: true, message: 'Cidadão atualizado com sucesso' });
  } catch (err: any) {
    return c.json({ success: false, message: err.message }, 500);
  }
});

civilIdentityRouter.delete('/citizens/:id', async (c) => {
  const db = c.get('db');
  const id = Number(c.req.param('id'));
  try {
    await db.update(users).set({ status: 'suspended' }).where(eq(users.id, id));
    return c.json({ success: true, message: 'Cidadão arquivado com sucesso' });
  } catch (err: any) {
    return c.json({ success: false, message: err.message }, 500);
  }
});

civilIdentityRouter.post('/citizens/bulk-delete', async (c) => {
  const db = c.get('db');
  const body = await c.req.json().catch(() => ({ ids: [] }));
  const ids: number[] = (body.ids || []).map(Number);
  try {
    if (ids.length > 0) {
      await db.update(users).set({ status: 'suspended' }).where(inArray(users.id, ids));
    }
    return c.json({ success: true, message: 'Cidadãos arquivados com sucesso' });
  } catch (err: any) {
    return c.json({ success: false, message: err.message }, 500);
  }
});
