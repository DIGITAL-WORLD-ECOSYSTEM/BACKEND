/**
 * Project: Governance System (ASPPIBRA DAO)
 * Role: Database Connection Factory (Drizzle ORM + D1)
 * Version: 1.1.0
 */
import { drizzle, DrizzleD1Database } from 'drizzle-orm/d1';
import * as schema from './schema';

/**
 * Instancia a conexão com o banco de dados D1.
 * O mapeamento do 'schema' permite o uso da Query API (db.query.users.findFirst)
 * @param d1 O binding do D1Database vindo do ambiente (c.env.DB)
 */
export const createDb = (d1: D1Database) => {
  return drizzle(d1, { schema });
};

/**
 * Tipo Database para ser utilizado no contexto do Hono (c.set('db', db))
 */
export type Database = DrizzleD1Database<typeof schema>;
