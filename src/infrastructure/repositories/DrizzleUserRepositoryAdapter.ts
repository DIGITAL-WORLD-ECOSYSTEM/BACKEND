import { eq, sql } from 'drizzle-orm';
import { users } from '../../db/user/tables';
import {
  IUserRepository,
  UserRecord,
  CreateUserData,
} from '../../application/ports/output/IUserRepository';

export type { UserRecord, CreateUserData };

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

  async create(data: CreateUserData): Promise<UserRecord> {
    const email = data.email || '';
    const normalized = (data.emailNormalized || email).toLowerCase().trim();
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
      throw new Error('Falha ao criar usuário no D1.');
    }
    return this.mapToRecord(created);
  }

  async updateStatus(id: number, status: 'active' | 'suspended' | 'pending' | 'locked'): Promise<void> {
    await this.db
      .update(users)
      .set({ status })
      .where(eq(users.id, id));
  }

  async incrementAuthEpoch(userId: number): Promise<number> {
    const [updated] = await this.db
      .update(users)
      .set({
        authEpoch: sql`${users.authEpoch} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId))
      .returning();

    if (!updated) {
      throw new Error('User not found to increment authEpoch');
    }
    return updated.authEpoch;
  }

  async incrementFailedLoginAttempts(userId: number, maxAttempts: number): Promise<void> {
    const now = new Date();
    await this.db
      .update(users)
      .set({
        failedLoginAttempts: sql`${users.failedLoginAttempts} + 1`,
        lastFailedLoginAt: now,
        status: sql`CASE WHEN ${users.failedLoginAttempts} + 1 >= ${maxAttempts} THEN 'locked' ELSE ${users.status} END`,
      })
      .where(eq(users.id, userId));
  }

  async resetFailedLoginAttempts(userId: number): Promise<void> {
    await this.db
      .update(users)
      .set({
        failedLoginAttempts: 0,
        lastFailedLoginAt: null,
      })
      .where(eq(users.id, userId));
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
