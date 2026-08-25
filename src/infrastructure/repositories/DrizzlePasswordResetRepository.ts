import { Result } from '../../shared/kernel/Result';
import { IPasswordResetRepository, PasswordReset } from '../../application/ports/output/IPasswordResetRepository';
import { passwordResets } from '../../db/authentication/tables';
import { eq } from 'drizzle-orm';

export class DrizzlePasswordResetRepository implements IPasswordResetRepository {
  constructor(private db: any) {}

  async findByToken(tokenHash: string): Promise<Result<PasswordReset>> {
    try {
      const [reset] = await this.db
        .select()
        .from(passwordResets)
        .where(eq(passwordResets.tokenHash, tokenHash))
        .limit(1);

      if (!reset) {
        return Result.fail('PasswordResetNotFound');
      }
      return Result.ok(reset as PasswordReset);
    } catch (e: any) {
      return Result.fail(e.message);
    }
  }

  async invalidate(id: number): Promise<Result<void>> {
    try {
      await this.db
        .update(passwordResets)
        .set({ usedAt: new Date() })
        .where(eq(passwordResets.id, id));
      return Result.ok();
    } catch (e: any) {
      return Result.fail(e.message);
    }
  }

  async create(data: { userId: number; tokenHash: string; expiresAt: Date }): Promise<Result<void>> {
    try {
      await this.db.insert(passwordResets).values(data);
      return Result.ok();
    } catch (e: any) {
      return Result.fail(e.message);
    }
  }
}
