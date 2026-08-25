import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { users, auditLogs } from '../../../../db/schema';
import { authSignature } from '../../middlewares/auth_signature';
import { timingSafeEqual } from '../../../../infrastructure/security/crypto/timing_safe';
import { Bindings } from '../../../../types/bindings';

const KycSubmit = {
  Schema: z.object({
    userId: z.number().int().positive('userId deve ser um número inteiro positivo'),
    documentType: z.enum(['RG', 'CPF', 'CNH', 'PASSAPORTE', 'OUTROS'], {
      message: 'Tipo de documento inválido',
    }),
  }),
};

const KycReview = {
  Schema: z.object({
    userId: z.number().int().positive('userId deve ser um número inteiro positivo'),
    status: z.enum(['approved', 'rejected', 'pending'], { message: 'Status inválido' }),
    reason: z.string().max(500).optional(),
  }),
};

type AppType = { Bindings: Bindings; Variables: { db: any } };

const compliance = new Hono<AppType>();

compliance.post('/kyc/submit', authSignature, zValidator('json', KycSubmit.Schema), async (c) => {
  const { userId, documentType } = c.req.valid('json');
  const db = c.get('db');

  await db.update(users).set({ kycStatus: 'pending' }).where(eq(users.id, userId));

  await db.insert(auditLogs).values({
    action: 'KYC_SUBMITTED',
    actorId: userId,
    status: 'success',
    metadata: { documentType },
  });

  return c.json({ success: true, message: 'Documentos enviados para revisão.' });
});

compliance.post('/kyc/review', zValidator('json', KycReview.Schema), async (c) => {
  const { userId, status, reason } = c.req.valid('json');
  const adminKey = c.req.header('x-admin-key') ?? '';
  const db = c.get('db');

  const adminPassword = c.env.ADMIN_PASSWORD;
  if (!adminPassword) {
    return c.json(
      { success: false, message: 'Configuração de segurança ausente. Contate o administrador.' },
      500
    );
  }

  if (!adminKey || !timingSafeEqual(adminKey, adminPassword)) {
    return c.json({ success: false, message: 'Unauthorized' }, 401);
  }

  await db.update(users).set({ kycStatus: status }).where(eq(users.id, userId));

  await db.insert(auditLogs).values({
    action: `KYC_${status.toUpperCase()}`,
    actorId: userId,
    status: 'success',
    metadata: { reason },
  });

  return c.json({ success: true, message: `Status KYC atualizado para: ${status}` });
});

export default compliance;
