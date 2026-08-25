import { Context, Next } from 'hono';
import { JwtService } from '../../../infrastructure/security/jwt/JwtService';
import { DrizzleSessionRepository } from '../../../infrastructure/repositories/DrizzleSessionRepository';
import { DrizzleUserRepositoryAdapter } from '../../../infrastructure/repositories/DrizzleUserRepositoryAdapter';

const jwtService = new JwtService();

/**
 * Stateful Session Guard Middleware
 * 1. Extrai o Bearer token do header Authorization.
 * 2. Valida a assinatura criptográfica do JWT.
 * 3. Extrai o sid (Session ID) do payload.
 * 4. Realiza o lookup físico no D1 (user_sessions).
 * 5. Bloqueia (HTTP 401) se a sessão não existir, estiver revogada ou expirada.
 * 6. Injeta no contexto do Hono (c.set('user', ...)) o userId, sessionId e sessionAal.
 */
export const sessionGuard = async (c: Context, next: Next) => {
  const authHeader = c.req.header('Authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null;

  if (!token) {
    return c.json({ success: false, message: 'Authentication required (Bearer token missing).' }, 401);
  }

  try {
    const secret = c.env.JWT_SECRET || 'asppibra-secret-key-change-in-production';
    const payload = await jwtService.verify(token, secret);

    if (!payload.sid) {
      return c.json({ success: false, message: 'Invalid session payload (sid missing).' }, 401);
    }

    const db = c.get('db');
    if (!db) {
      return c.json({ success: false, message: 'Database context unavailable.' }, 500);
    }

    const sessionRepo = new DrizzleSessionRepository(db);
    const session = await sessionRepo.getSessionById(payload.sid);

    if (!session) {
      return c.json({ success: false, message: 'Session not found.' }, 401);
    }

    if (session.revokedAt) {
      return c.json({ success: false, message: 'Session has been revoked.' }, 401);
    }

    if (session.expiresAt && new Date(session.expiresAt) < new Date()) {
      return c.json({ success: false, message: 'Session has expired.' }, 401);
    }

    const userRepo = new DrizzleUserRepositoryAdapter(db);
    const user = await userRepo.findById(session.userId);

    if (!user) {
      return c.json({ success: false, message: 'User account not found.' }, 401);
    }

    if (user.status === 'suspended' || user.status === 'locked' || user.status === 'disabled') {
      return c.json({ success: false, message: `User account is ${user.status}.` }, 403);
    }

    // AF-008: Validar authEpoch do token JWT contra o authEpoch atual do usuário no D1
    const tokenEpoch = typeof payload.authEpoch === 'number' ? payload.authEpoch : 1;
    const currentEpoch = user.authEpoch || 1;
    if (tokenEpoch < currentEpoch) {
      return c.json(
        {
          success: false,
          message: 'Session invalidated due to password reset or security revocation (authEpoch mismatch).',
        },
        401
      );
    }

    c.set('user', {
      userId: session.userId,
      sessionId: session.id,
      sessionAal: session.aal,
      role: payload.role || 'citizen',
    });
    c.set('userId', session.userId);
    c.set('sessionId', session.id);
    c.set('sessionAal', session.aal);

    await next();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Token inválido';
    return c.json({ success: false, message: 'Invalid or expired session token.', error: message }, 401);
  }
};
