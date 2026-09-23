import * as fs from 'fs';
import * as path from 'path';

export function runAllMigrations(sqlite: any) {
  const migrationsDir = path.resolve(__dirname, '../../migrations');
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();

  for (const file of files) {
    const fullPath = path.join(migrationsDir, file);
    const rawSql = fs.readFileSync(fullPath, 'utf-8');

    // Split by Drizzle statement breakpoint if present, otherwise semicolon
    const statements = rawSql.includes('--> statement-breakpoint')
      ? rawSql.split('--> statement-breakpoint').map((s) => s.trim()).filter((s) => s.length > 0)
      : rawSql.split(';').map((s) => s.trim()).filter((s) => s.length > 0);

    for (const statement of statements) {
      try {
        if (typeof sqlite.exec === 'function') {
          sqlite.exec(statement);
        } else if (typeof sqlite.execute === 'function') {
          sqlite.execute(statement);
        }
      } catch (err: any) {
        throw new Error(`[Migration Failure] File ${file} failed on statement:\n${statement}\nError: ${err?.message || err}`);
      }
    }
  }
}

export async function runAllMigrationsLibSql(client: any) {
  const migrationsDir = path.resolve(__dirname, '../../migrations');
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();

  for (const file of files) {
    const fullPath = path.join(migrationsDir, file);
    const rawSql = fs.readFileSync(fullPath, 'utf-8');

    const statements = rawSql.includes('--> statement-breakpoint')
      ? rawSql.split('--> statement-breakpoint').map((s) => s.trim()).filter((s) => s.length > 0)
      : rawSql.split(';').map((s) => s.trim()).filter((s) => s.length > 0);

    for (const statement of statements) {
      try {
        await client.execute(statement);
      } catch (err: any) {
        throw new Error(`[Migration Failure LibSQL] File ${file} failed on statement:\n${statement}\nError: ${err?.message || err}`);
      }
    }
  }
}
