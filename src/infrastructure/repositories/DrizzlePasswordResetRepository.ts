import { Result } from '../../shared/kernel/Result';
import { RepositoryError } from '../../shared/kernel/RepositoryError';
import { IPasswordResetRepository, PasswordReset, CreatePasswordResetData } from '../../application/ports/output/IPasswordResetRepository';
import { passwordResets } from '../../db/authentication/tables';
import { eq } from 'drizzle-orm';

export class DrizzlePasswordResetRepository implements IPasswordResetRepository {
  constructor(private db: any) {}

  async findByToken(tokenHash: string): Promise<Result<PasswordReset, RepositoryError>> {
    try {
      const [reset] = await this.db
        .select()
        .from(passwordResets)
        .where(eq(passwordResets.tokenHash, tokenHash))
        .limit(1);

      if (!reset) {
        return Result.err(RepositoryError.notFound('PasswordReset', tokenHash));
      }
      return Result.ok(reset as PasswordReset);
    } catch (e: any) {
      return Result.err(RepositoryError.transient(e.message, e));
    }
  }

  async invalidate(id: number): Promise<Result<void, RepositoryError>> {
    try {
      await this.db
        .update(passwordResets)
        .set({ usedAt: new Date() })
        .where(eq(passwordResets.id, id));
      return Result.ok();
    } catch (e: any) {
      return Result.err(RepositoryError.transient(e.message, e));
    }
  }

  async create(data: CreatePasswordResetData): Promise<Result<void, RepositoryError>> {
    try {
      await this.db.insert(passwordResets).values(data);
      return Result.ok();
    } catch (e: any) {
      return Result.err(RepositoryError.integrity(e.message, e));
    }
  }

  async consumeToken(tokenHash: string): Promise<Result<PasswordReset, RepositoryError>> {
    try {
      const { and, isNull, sql } = await import('drizzle-orm');
      
      const [reset] = await this.db
        .update(passwordResets)
        .set({ usedAt: new Date() })
        .where(and(
          eq(passwordResets.tokenHash, tokenHash),
          isNull(passwordResets.usedAt),
          sql`${passwordResets.expiresAt} > ${sql`(unixepoch())`}`
        ))
        .returning();

      if (!reset) {
        return Result.err(RepositoryError.notFound('PasswordReset', tokenHash));
      }
      return Result.ok(reset as PasswordReset);
    } catch (e: any) {
      return Result.err(RepositoryError.transient(e.message, e));
    }
  }
}
