import { Context, Next } from 'hono';
import { CryptoCore } from '../../../infrastructure/security/crypto/crypto';
import { JwtService } from '../../../infrastructure/security/jwt/JwtService';
import { DrizzleUnitOfWork } from '../../../infrastructure/repositories/DrizzleUnitOfWork';
import { CitizenRecord } from '../../../application/ports/output/ICivilIdentityRepository';
import { Result } from '../../../shared/kernel/Result';

const jwtService = new JwtService();

/**
 * Zero-Trust Signature Middleware
 * Requer o header X-Identity-Signature: Base64(Ed25519_Sign(Timestamp + Body))
 * E o header X-Identity-DID: did:dao:asppibra:<username>
 *
 * FALLBACK: Aceita JWT Bearer token se os headers de Zero-Trust estiverem ausentes.
 */
export const authSignature = async (c: Context, next: Next) => {
  const path = c.req.path;
  if (path.includes('/webhook')) {
    return next();
  }

  const signature = c.req.header('X-Identity-Signature');
  const did = c.req.header('X-Identity-DID');
  const timestamp = c.req.header('X-Identity-Timestamp');

  const hasAnyZeroTrustHeader = signature || did || timestamp;

  // --- FALLBACK JWT (Para sessões padrão de Cidadão via Web2/Social) ---
  if (!signature || !did || !timestamp) {
    if (hasAnyZeroTrustHeader) {
      return c.json({ success: false, message: 'Missing Zero-Trust credentials.' }, 401);
    }

    const authHeader = c.req.header('Authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null;

    if (token) {
      try {
        const secret = c.env.JWT_SECRET || 'asppibra-secret-key-change-in-production';
        const payload = await jwtService.verify(token, secret);

        if (payload.sid) {
          const db = c.get('db');
          if (db) {
            const { DrizzleSessionRepository } = await import('../../../infrastructure/repositories/DrizzleSessionRepository');
            const sessionRepo = new DrizzleSessionRepository(db);
            const session = await sessionRepo.getSessionById(payload.sid);

            if (!session || session.revokedAt || (session.expiresAt && new Date(session.expiresAt) < new Date())) {
              return c.json({ success: false, message: 'Session revoked, inactive or expired.' }, 401);
            }

            c.set('user', {
              userId: session.userId,
              sessionId: session.id,
              sessionAal: session.aal,
              role: payload.role || 'citizen',
            });

            return await next();
          }
        }

        c.set('user', {
          userId: payload.userId || payload.sub,
          role: payload.role || 'citizen',
        });

        return await next();
      } catch (err) {
        return c.json({ success: false, message: 'Invalid or expired session token.' }, 401);
      }
    }
    return c.json({ success: false, message: 'Authentication required (Zero-Trust or JWT).' }, 401);
  }

  // 1. Verificar expiração do Timestamp (máximo 5 min)
  const now = Date.now();
  if (Math.abs(now - parseInt(timestamp)) > 300000) {
    return c.json({ success: false, message: 'Request signature expired.' }, 401);
  }

  // 2. Buscar Cidadão via UnitOfWork & Repositório Canônico
  const username = did.split(':').pop();
  if (!username) {
    return c.json({ success: false, message: 'Invalid DID format.' }, 401);
  }

  const db = c.get('db');
  const uow = new DrizzleUnitOfWork(db);

  const repoResult = await uow.execute<CitizenRecord | null>(async (factory) => {
    const citizenRepo = factory.getCivilIdentityRepository();
    const record = await citizenRepo.findByDid(did);
    return Result.ok<CitizenRecord | null>(record);
  });

  const activeCitizen: CitizenRecord | null = repoResult.isSuccess ? repoResult.getValue() : null;

  if (!activeCitizen || activeCitizen.status === 'revoked' || activeCitizen.civilStatus === 'revoked') {
    return c.json({ success: false, message: 'Citizen not found or revoked.' }, 401);
  }

  // 3. Verificar Assinatura
  if (!activeCitizen.publicKey) {
    return c.json({ success: false, message: 'Public key missing for citizen.' }, 401);
  }

  const publicKey = Uint8Array.from(JSON.parse(activeCitizen.publicKey));
  const bodyText = await c.req.raw.clone().text();
  const msg = new TextEncoder().encode(timestamp + bodyText);

  try {
    const isValid = await CryptoCore.verify(
      Uint8Array.from(
        atob(signature)
          .split('')
          .map((char) => char.charCodeAt(0))
      ),
      msg,
      publicKey
    );

    if (!isValid) {
      return c.json({ success: false, message: 'Invalid Zero-Trust signature.' }, 401);
    }

    if (!activeCitizen.userId) {
      return c.json({ success: false, message: 'Citizen is not linked to a User account.' }, 403);
    }

    c.set('user', { userId: activeCitizen.userId, role: 'citizen' });
  } catch (e) {
    return c.json({ success: false, message: 'Signature verification failed.' }, 401);
  }

  await next();
};
