import { Context, Next } from 'hono';
import { JwtService } from '../../../infrastructure/security/jwt/JwtService';
import { IJwtService } from '../../../application/ports/security/IJwtService';
import { SessionValidationService } from '../../../application/services/SessionValidationService';

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
import { DrizzleSessionRepository } from '../../../infrastructure/repositories/DrizzleSessionRepository';
import { DrizzleUserRepositoryAdapter } from '../../../infrastructure/repositories/DrizzleUserRepositoryAdapter';

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
    const db = c.get('db');
    if (!db) {
      return c.json({ success: false, message: 'Database context unavailable.' }, 500);
    }

    const sessionRepo = new DrizzleSessionRepository(db);
    const userRepo = new DrizzleUserRepositoryAdapter(db);
    const validationService = new SessionValidationService(jwtService);
    const validationResult = await validationService.validate({
      token,
      secret,
      sessionRepo,
      userRepo,
    });

    c.set('user', {
      userId: validationResult.userId,
      sessionId: validationResult.sessionId,
      sessionAal: validationResult.sessionAal,
    });
    c.set('userId', validationResult.userId);
    c.set('sessionId', validationResult.sessionId);
    c.set('sessionAal', validationResult.sessionAal);
    c.set('lastAuthenticatedAt', validationResult.lastAuthenticatedAt);

    await next();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Token inválido';
    return c.json({ success: false, message, error: message }, 401);
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
    const lastAuthenticatedAt = c.get('lastAuthenticatedAt') as Date | undefined;

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

    if (maxAgeMinutes) {
      if (!lastAuthenticatedAt) {
        return c.json({ 
          success: false, 
          message: 'Recent authentication required but no authentication timestamp found.', 
          code: 'RECENT_AUTH_REQUIRED',
        }, 403);
      }
      const now = new Date();
      const diffMinutes = (now.getTime() - lastAuthenticatedAt.getTime()) / (1000 * 60);
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
