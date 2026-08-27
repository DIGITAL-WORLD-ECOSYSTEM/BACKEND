import { Context, Next } from 'hono';
import { error } from '../helpers/response';
import { eq, and, isNull, sql } from 'drizzle-orm';

/**
 * verifyRole - Middleware para Role-Based Access Control (RBAC)
 * Verifica diretamente no banco de dados, ignorando a claim do JWT.
 * @param allowedRoles Lista de cargos permitidos (ex: ['admin', 'partner'])
 */
export const verifyRole = (allowedRoles: string[]) => {
  return async (c: Context, next: Next) => {
    try {
      // GARANTIA FASE 0: RBAC nunca deve rodar sem sessionGuard
      const sessionUserId = c.get('userId');
      if (!sessionUserId) {
        return error(c, 'Erro Interno: Acesso negado. RBAC executado sem sessionGuard anterior.', null, 500);
      }

      const db = c.get('db');
      if (!db) {
        return error(c, 'Erro Interno: Conexão com banco de dados não encontrada.', null, 500);
      }

      const { userRoles, roles } = await import('../../../../db/authorization/tables');

      // Query para verificar se o usuário possui algum dos roles permitidos
      const userRolesData = await db
        .select({ roleKey: roles.key })
        .from(userRoles)
        .innerJoin(roles, eq(userRoles.roleId, roles.id))
        .where(
          and(
            eq(userRoles.userId, sessionUserId),
            isNull(userRoles.revokedAt), // A role não deve estar revogada
            sql`${userRoles.expiresAt} IS NULL OR ${userRoles.expiresAt} > ${sql`(unixepoch())`}`,
            eq(roles.status, 'active') // A role deve estar ativa no sistema
          )
        );

      const userRoleKeys = userRolesData.map((r: any) => r.roleKey);
      
      // The system should not grant implicit roles. All roles must be recorded in the DB.

      const hasRole = userRoleKeys.some((role: string) => allowedRoles.includes(role));

      if (!hasRole) {
        return error(
          c,
          `Acesso negado: Você não tem permissão para realizar esta ação. Requerido um dos: [${allowedRoles.join(', ')}]`,
          null,
          403
        );
      }

      await next();
    } catch (err: unknown) {
      console.error('🚨 RBAC Auth Error:', err);
      return error(c, 'Erro ao verificar permissões de acesso.', null, 500);
    }
  };
};

/**
 * verifyPermission - Middleware para verificar Permissões Granulares (FASE 4)
 * Verifica se as roles do usuário concedem a permissão requerida.
 * @param requiredPermission Permissão granular (ex: 'user.read')
 */
export const verifyPermission = (requiredPermission: string) => {
  return async (c: Context, next: Next) => {
    try {
      const sessionUserId = c.get('userId');
      if (!sessionUserId) {
        return error(c, 'Erro Interno: Acesso negado. RBAC executado sem sessionGuard anterior.', null, 500);
      }

      const db = c.get('db');
      const { userRoles, roles, rolePermissions, permissions } = await import('../../../../db/authorization/tables');

      const userPerms = await db
        .select({ permKey: permissions.key })
        .from(userRoles)
        .innerJoin(roles, eq(userRoles.roleId, roles.id))
        .innerJoin(rolePermissions, eq(roles.id, rolePermissions.roleId))
        .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
        .where(
          and(
            eq(userRoles.userId, sessionUserId),
            isNull(userRoles.revokedAt),
            sql`${userRoles.expiresAt} IS NULL OR ${userRoles.expiresAt} > ${sql`(unixepoch())`}`,
            eq(roles.status, 'active'),
            eq(permissions.key, requiredPermission)
          )
        )
        .limit(1);

      if (userPerms.length === 0) {
        return error(
          c,
          `Acesso negado: Permissão '${requiredPermission}' necessária para esta ação.`,
          null,
          403
        );
      }

      await next();
    } catch (err: unknown) {
      console.error('🚨 Permission Auth Error:', err);
      return error(c, 'Erro ao verificar permissões de acesso.', null, 500);
    }
  };
};

