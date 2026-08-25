import { Context, Next } from 'hono';
import { error } from '../helpers/response';
import { JwtService } from '../../../infrastructure/security/jwt/JwtService';

const jwtService = new JwtService();

/**
 * verifyRole - Middleware para Role-Based Access Control (RBAC)
 * @param allowedRoles Lista de cargos permitidos (ex: ['admin', 'partner'])
 */
export const verifyRole = (allowedRoles: string[]) => {
  return async (c: Context, next: Next) => {
    try {
      const authHeader = c.req.header('Authorization');
      const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null;

      if (!token) {
        return error(c, 'Acesso negado: Token de autorização não fornecido.', null, 401);
      }

      const secret = c.env.JWT_SECRET || 'default-secret-change-in-production';
      const payload = await jwtService.verify(token, secret);

      const userRole = (payload.role as string) || 'citizen';

      if (!allowedRoles.includes(userRole)) {
        return error(
          c,
          `Acesso negado: Seu cargo (${userRole}) não tem permissão para realizar esta ação. Requerido: [${allowedRoles.join(
            ', '
          )}]`,
          null,
          403
        );
      }

      c.set('jwtPayload', payload);
      await next();
    } catch (err: unknown) {
      console.error('🚨 RBAC Auth Error:', err);
      return error(c, 'Sessão inválida ou expirada. Efetue login novamente.', null, 401);
    }
  };
};
