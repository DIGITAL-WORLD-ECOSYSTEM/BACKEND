import { eq } from 'drizzle-orm';
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
    const normalized = (data.emailNormalized || data.email).toLowerCase().trim();
    const subjectType = data.subjectType === 'citizen' || !data.subjectType ? 'human' : data.subjectType;

    await this.db
      .insert(users)
      .values({
        email: data.email.trim(),
        emailNormalized: normalized,
        subjectType,
        status: data.status || 'active',
        authEpoch: 1,
      });

    const created = await this.findByEmail(normalized);
    if (!created) {
      throw new Error('Falha ao recuperar usuário recém-criado no D1.');
    }
    return created;
  }

  async updateStatus(id: number, status: 'active' | 'suspended' | 'pending'): Promise<void> {
    await this.db
      .update(users)
      .set({ status })
      .where(eq(users.id, id));
  }

  private mapToRecord(raw: any): UserRecord {
    return {
      id: raw.id,
      publicId: raw.publicId || null,
      email: raw.email,
      emailNormalized: raw.emailNormalized || raw.email,
      status: raw.status || 'active',
      subjectType: raw.subjectType || 'human',
      createdAt: raw.createdAt instanceof Date ? raw.createdAt : new Date(raw.createdAt ? raw.createdAt * 1000 : Date.now()),
      updatedAt: raw.updatedAt instanceof Date ? raw.updatedAt : new Date(raw.updatedAt ? raw.updatedAt * 1000 : Date.now()),
    };
  }
}
