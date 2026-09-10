import { eq, sql } from 'drizzle-orm';
import { users } from '../../db/user/tables';
import { Result } from '../../shared/kernel/Result';
import { RepositoryError } from '../../shared/kernel/RepositoryError';
import {
  IUserRepository,
  UserRecord,
  CreateUserData,
  UserStatus,
} from '../../application/ports/output/IUserRepository';

export type { UserRecord, CreateUserData, UserStatus };

export class DrizzleUserRepositoryAdapter implements IUserRepository {
  constructor(private readonly db: any) {}

  async findById(id: number): Promise<UserRecord | null> {
    const [user] = await this.db
      .select()
      .from(users)
      .where(eq(users.id, id))
      .limit(1);

    if (!user) return null;
    return this.mapToRecord(user);
  }

  async findByEmail(email: string): Promise<UserRecord | null> {
    const normalized = email.toLowerCase().trim();
    const [user] = await this.db
      .select()
      .from(users)
      .where(eq(users.emailNormalized, normalized))
      .limit(1);

    if (!user) return null;
    return this.mapToRecord(user);
  }

  async create(data: CreateUserData): Promise<Result<UserRecord, RepositoryError>> {
    const email = data.email || '';
    const normalized = (data.emailNormalized || email).toLowerCase().trim();
    try {
      const subjectType = data.subjectType === 'citizen' || !data.subjectType ? 'human' : data.subjectType;

      const [created] = await this.db
        .insert(users)
        .values({
          email: email ? email.trim() : null,
          emailNormalized: normalized || null,
          subjectType,
          status: data.status || 'active',
          authEpoch: 1,
        })
        .returning();

      if (!created) {
        return Result.err(RepositoryError.integrity('Falha ao criar usuário no D1.'));
      }
      return Result.ok(this.mapToRecord(created));
    } catch (e: any) {
      if (e.message?.includes('UNIQUE') || e.message?.includes('constraint')) {
        return Result.err(RepositoryError.conflict(`User conflict on email: ${normalized}`, e));
      }
      return Result.err(RepositoryError.transient(e.message, e));
    }
  }

  async updateStatus(id: number, status: UserStatus): Promise<Result<void, RepositoryError>> {
    try {
      await this.db
        .update(users)
        .set({ status })
        .where(eq(users.id, id));
      return Result.ok();
    } catch (e: any) {
      return Result.err(RepositoryError.transient(e.message, e));
    }
  }

  async incrementAuthEpoch(userId: number): Promise<Result<number, RepositoryError>> {
    try {
      const [updated] = await this.db
        .update(users)
        .set({
          authEpoch: sql`${users.authEpoch} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId))
        .returning();

      if (!updated) {
        return Result.err(RepositoryError.notFound('User', userId));
      }
      return Result.ok(updated.authEpoch);
    } catch (e: any) {
      return Result.err(RepositoryError.transient(e.message, e));
    }
  }

  async incrementFailedLoginAttempts(userId: number, maxAttempts: number): Promise<Result<void, RepositoryError>> {
    try {
      const now = new Date();
      await this.db
        .update(users)
        .set({
          failedLoginAttempts: sql`${users.failedLoginAttempts} + 1`,
          lastFailedLoginAt: now,
          status: sql`CASE WHEN ${users.failedLoginAttempts} + 1 >= ${maxAttempts} THEN 'locked' ELSE ${users.status} END`,
        })
        .where(eq(users.id, userId));
      return Result.ok();
    } catch (e: any) {
      return Result.err(RepositoryError.transient(e.message, e));
    }
  }

  async resetFailedLoginAttempts(userId: number): Promise<Result<void, RepositoryError>> {
    try {
      await this.db
        .update(users)
        .set({
          failedLoginAttempts: 0,
          lastFailedLoginAt: null,
        })
        .where(eq(users.id, userId));
      return Result.ok();
    } catch (e: any) {
      return Result.err(RepositoryError.transient(e.message, e));
    }
  }

  private mapToRecord(raw: any): UserRecord {
    return {
      id: raw.id,
      publicId: raw.publicId || null,
      email: raw.email || null,
      emailNormalized: raw.emailNormalized || raw.email || null,
      status: raw.status || 'active',
      subjectType: raw.subjectType || 'human',
      failedLoginAttempts: raw.failedLoginAttempts || 0,
      lastFailedLoginAt: raw.lastFailedLoginAt instanceof Date ? raw.lastFailedLoginAt : (raw.lastFailedLoginAt ? new Date(raw.lastFailedLoginAt * 1000) : null),
      authEpoch: raw.authEpoch || 1,
      createdAt: raw.createdAt instanceof Date ? raw.createdAt : new Date(raw.createdAt ? raw.createdAt * 1000 : Date.now()),
      updatedAt: raw.updatedAt instanceof Date ? raw.updatedAt : new Date(raw.updatedAt ? raw.updatedAt * 1000 : Date.now()),
    };
  }
}
