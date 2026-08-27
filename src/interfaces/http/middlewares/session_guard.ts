import { Context, Next } from 'hono';
import { JwtService } from '../../../infrastructure/security/jwt/JwtService';
import { DrizzleSessionRepository } from '../../../infrastructure/repositories/DrizzleSessionRepository';
import { DrizzleUserRepositoryAdapter } from '../../../infrastructure/repositories/DrizzleUserRepositoryAdapter';
import { IJwtService } from '../../../application/ports/security/IJwtService';

function resolveJwtService(c: Context): IJwtService {
  const service = c.get('jwtService') as IJwtService | undefined;
  if (!service) {
    throw new Error('IJwtService was not provided in the Hono context (Dependency Injection missing).');
  }
  return service;
}

/**
 * Stateful Session Guard Middleware
 * 1. Extrai o Bearer token do header Authorization.
 * 2. Valida a assinatura criptográfica e as claims temporais do JWT.
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

  const secret = c.env.JWT_SECRET;
  if (!secret) {
    console.error('[SECURITY] JWT_SECRET ausente — recusando autenticação.');
    return c.json({ success: false, message: 'Erro de configuração do servidor.' }, 500);
  }

  try {
    const jwtService = resolveJwtService(c);
    const payload = await jwtService.verify(token, secret);

    if (!payload.sid) {
      return c.json({ success: false, message: 'Invalid session payload (sid missing).' }, 401);
    }

    const db = c.get('db');
    if (!db) {
      return c.json({ success: false, message: 'Database context unavailable.' }, 500);
    }

    const sessionRepo = new DrizzleSessionRepository(db);
    const sessionRecord = await sessionRepo.getSessionById(payload.sid);

    if (!sessionRecord) {
      return c.json({ success: false, message: 'Session not found.' }, 401);
    }

    const { Session } = await import('../../../domains/identity/entities/Session');
    const session = Session.fromPersistence(sessionRecord as any);

    if (!session.isValid()) {
      return c.json({ success: false, message: session.isRevoked ? 'Session has been revoked.' : 'Session has expired.' }, 401);
    }

    const userRepo = new DrizzleUserRepositoryAdapter(db);
    const userRecord = await userRepo.findById(session.userId);

    if (!userRecord) {
      return c.json({ success: false, message: 'User account not found.' }, 401);
    }

    const { User } = await import('../../../domains/identity/entities/User');
    const user = new User(userRecord as any);

    if (!user.canAuthenticate()) {
      return c.json({ success: false, message: `User account is not eligible for authentication.` }, 403);
    }

    // AF-008: Validar authEpoch da entidade Session contra o authEpoch atual do usuário (D1 -> D1)
    if (!session.matchesUserEpoch(user.authEpoch)) {
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
    c.set('sessionCreatedAt', session.createdAt);

    await next();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Token inválido';
    return c.json({ success: false, message: 'Invalid or expired session token.', error: message }, 401);
  }
};

/**
 * Middleware para impor Nível de Garantia de Autenticação (AAL) e Recent Auth.
 * Deve ser usado APÓS o sessionGuard na cadeia de middlewares da rota.
 * 
 * @param minAal O AAL mínimo necessário (1, 2, ou 3).
 * @param maxAgeMinutes O tempo máximo permitido desde a autenticação (opcional).
 */
export const requireAal = (minAal: number, maxAgeMinutes?: number) => {
  return async (c: Context, next: Next) => {
    const sessionAal = c.get('sessionAal') as number | undefined;
    const sessionCreatedAt = c.get('sessionCreatedAt') as Date | undefined;

    if (!sessionAal) {
      return c.json({ success: false, message: 'Authentication level not found in context. sessionGuard is required.' }, 500);
    }

    if (sessionAal < minAal) {
      return c.json({ 
        success: false, 
        message: 'Insufficient authentication level.', 
        code: 'AAL_INSUFFICIENT',
        requiredAal: minAal 
      }, 403);
    }

    if (maxAgeMinutes && sessionCreatedAt) {
      const now = new Date();
      const diffMinutes = (now.getTime() - sessionCreatedAt.getTime()) / (1000 * 60);
      if (diffMinutes > maxAgeMinutes) {
        return c.json({ 
          success: false, 
          message: 'Recent authentication required.', 
          code: 'RECENT_AUTH_REQUIRED',
          maxAgeMinutes 
        }, 403);
      }
    }

    await next();
  };
};
