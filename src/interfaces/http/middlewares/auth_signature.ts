import { Context, Next } from 'hono';
import { CryptoCore } from '../../../infrastructure/security/crypto/crypto';
import { JwtService } from '../../../infrastructure/security/jwt/JwtService';
import { DrizzleUnitOfWork } from '../../../infrastructure/repositories/DrizzleUnitOfWork';
import { CitizenRecord } from '../../../application/ports/output/ICivilIdentityRepository';
import { Result } from '../../../shared/kernel/Result';
import { SessionValidationService } from '../../../application/services/SessionValidationService';

const jwtService = new JwtService();

function requireJwtSecret(c: Context): string {
  const secret = c.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET não configurado no ambiente.');
  }
  return secret;
}

// In-memory nonce store (For production, use Cloudflare KV or Durable Objects)
const consumedNonces = new Map<string, number>();

/**
 * Limpa nonces expirados do mapa em memória para evitar memory leak.
 */
function cleanupNonces() {
  const now = Date.now();
  for (const [key, timestamp] of consumedNonces.entries()) {
    if (Math.abs(now - timestamp) > 300000) {
      consumedNonces.delete(key);
    }
  }
}

/**
 * Zero-Trust Signature Middleware
 * Requer os headers:
 * - X-Identity-Signature
 * - X-Identity-DID
 * - X-Identity-Timestamp
 * - X-Identity-Nonce
 *
 * FALLBACK: Aceita JWT Bearer token se os headers de Zero-Trust estiverem ausentes.
 */
export const authSignature = async (c: Context, next: Next) => {

  const signature = c.req.header('X-Identity-Signature');
  const did = c.req.header('X-Identity-DID');
  const timestampStr = c.req.header('X-Identity-Timestamp');
  const nonce = c.req.header('X-Identity-Nonce');

  const hasAnyZeroTrustHeader = signature || did || timestampStr || nonce;

  // --- FALLBACK JWT ---
  if (!signature || !did || !timestampStr || !nonce) {
    if (hasAnyZeroTrustHeader) {
      return c.json({ success: false, message: 'Missing Zero-Trust credentials.' }, 401);
    }

    const authHeader = c.req.header('Authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null;

    if (token) {
      let secret: string;
      try {
        secret = requireJwtSecret(c);
      } catch (err) {
        console.error('[SECURITY] JWT_SECRET ausente — recusando autenticação.', err);
        return c.json({ success: false, message: 'Erro de configuração do servidor.' }, 500);
      }

      try {
        const db = c.get('db');
        if (!db) {
          return c.json({ success: false, message: 'Database context unavailable.' }, 500);
        }

        const validationService = new SessionValidationService(jwtService);
        const validationResult = await validationService.validate({
          token,
          secret,
          db,
        });

        c.set('user', {
          userId: validationResult.userId,
          sessionId: validationResult.sessionId,
          sessionAal: validationResult.sessionAal,
          // Role is NOT extracted from JWT. Authorization is deferred to RBAC.
        });

        c.set('userId', validationResult.userId);
        c.set('sessionId', validationResult.sessionId);
        c.set('sessionAal', validationResult.sessionAal);
        c.set('lastAuthenticatedAt', validationResult.lastAuthenticatedAt);

        return await next();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Token inválido';
        return c.json({ success: false, message, error: message }, 401);
      }
    }
    return c.json({ success: false, message: 'Authentication required (Zero-Trust or JWT).' }, 401);
  }

  // 1. Verificar expiração do Timestamp e formato
  const timestamp = Number(timestampStr);
  if (isNaN(timestamp)) {
    return c.json({ success: false, message: 'Invalid timestamp format.' }, 401);
  }

  const now = Date.now();
  if (Math.abs(now - timestamp) > 300000) {
    return c.json({ success: false, message: 'Request signature expired.' }, 401);
  }

  // 2. Anti-Replay: Validar Nonce
  const nonceKey = `identity:${did}:nonce:${nonce}`;
  if (consumedNonces.has(nonceKey)) {
    return c.json({ success: false, message: 'Nonce already consumed (Replay detected).' }, 401);
  }
  consumedNonces.set(nonceKey, timestamp);
  cleanupNonces(); // Chance to GC

  // 3. Buscar Cidadão via UnitOfWork & Repositório Canônico
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

  // 4. Verificar Assinatura (Ed25519(timestamp + nonce + method + path + sha256(body)))
  if (!activeCitizen.publicKey) {
    return c.json({ success: false, message: 'Public key missing for citizen.' }, 401);
  }

  const publicKey = Uint8Array.from(JSON.parse(activeCitizen.publicKey));
  const bodyText = await c.req.raw.clone().text();

  // Generate SHA-256 hash of the body
  const bodyHashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(bodyText));
  const bodyHashHex = Array.from(new Uint8Array(bodyHashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');

  const msgPayload = `${timestampStr}${nonce}${c.req.method}${c.req.path}${bodyHashHex}`;
  const msg = new TextEncoder().encode(msgPayload);

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

    // Role is NOT injected. Defer to RBAC.
    c.set('user', { userId: activeCitizen.userId });
    c.set('userId', activeCitizen.userId);
  } catch (e) {
    return c.json({ success: false, message: 'Signature verification failed.' }, 401);
  }

  await next();
};
