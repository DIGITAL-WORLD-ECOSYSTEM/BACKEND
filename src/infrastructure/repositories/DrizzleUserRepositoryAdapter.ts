import { eq, sql } from 'drizzle-orm';
import { users } from '../../db/user/tables';
import { Result } from '../../shared/kernel/Result';
import { RepositoryError } from '../../shared/kernel/RepositoryError';
import { fromTrustedUserId, UserId } from '../../shared/kernel/ids/UserId';
import {
  IUserRepository,
  UserRecord,
  CreateUserData,
} from '../../application/ports/output/IUserRepository';
import { UserStatus, UserSubjectType, USER_STATUSES, USER_SUBJECT_TYPES } from '../../domains/user/types';
import { User } from '../../domains/user/entities/User';

function parseDatabaseDate(val: unknown, fieldName: string): Date {
  if (val instanceof Date) {
    if (isNaN(val.getTime())) {
      throw new Error(`Data corrompida (Invalid Date) no campo "${fieldName}".`);
    }
    return val;
  }
  if (typeof val === 'number') {
    const d = new Date(val * 1000);
    if (isNaN(d.getTime())) {
      throw new Error(`Timestamp numérico inválido no campo "${fieldName}": ${val}`);
    }
    return d;
  }
  if (typeof val === 'string') {
    const d = new Date(val);
    if (isNaN(d.getTime())) {
      throw new Error(`String de data inválida no campo "${fieldName}": ${val}`);
    }
    return d;
  }
  throw new Error(`Tipo inesperado de data no campo "${fieldName}": ${typeof val}`);
}

function parseNullableDatabaseDate(val: unknown, fieldName: string): Date | null {
  if (val === null || val === undefined) return null;
  return parseDatabaseDate(val, fieldName);
}

export class DrizzleUserRepositoryAdapter implements IUserRepository {
  constructor(private readonly db: any) {}

  async findById(id: UserId): Promise<UserRecord | null> {
    const rawId = id as unknown as number;
    const [user] = await this.db
      .select()
      .from(users)
      .where(eq(users.id, rawId))
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

  async findByPublicId(publicId: string): Promise<UserRecord | null> {
    const normalized = publicId.toLowerCase().trim();
    const [user] = await this.db
      .select()
      .from(users)
      .where(eq(users.publicId, normalized))
      .limit(1);

    if (!user) return null;
    return this.mapToRecord(user);
  }

  async create(data: CreateUserData): Promise<Result<UserRecord, RepositoryError>> {
    const email = data.email ? data.email.trim() : null;
    const normalized = data.emailNormalized
      ? data.emailNormalized.toLowerCase().trim()
      : (email ? email.toLowerCase().trim() : null);

    try {
      const subjectType: UserSubjectType = data.subjectType ?? 'human';
      const status: UserStatus = data.status ?? 'pending_setup';

      const [created] = await this.db
        .insert(users)
        .values({
          email,
          emailNormalized: normalized,
          subjectType,
          status,
          authEpoch: 1,
        })
        .returning();

      if (!created) {
        return Result.err(RepositoryError.integrity('Falha ao criar usuário no D1 (returning vazio).'));
      }
      return Result.ok(this.mapToRecord(created));
    } catch (e: unknown) {
      const err = e as { message?: string };
      if (err.message?.includes('UNIQUE') || err.message?.includes('constraint')) {
        return Result.err(RepositoryError.conflict(`User conflict on email: ${normalized}`, e));
      }
      return Result.err(RepositoryError.transient(err.message ?? 'Erro desconhecido ao criar usuário', e));
    }
  }

  async save(user: User): Promise<Result<void, RepositoryError>> {
    const rawId = user.id as unknown as number;
    try {
      const [updated] = await this.db
        .update(users)
        .set({
          status: user.status,
          publicId: user.publicId,
          email: user.email,
          emailNormalized: user.emailNormalized,
          emailVerifiedAt: user.emailVerifiedAt,
          emailChangedAt: user.emailChangedAt,
          statusChangedAt: user.statusChangedAt,
          lockedAt: user.lockedAt,
          disabledAt: user.disabledAt,
          deletedAt: user.deletedAt,
          updatedAt: user.updatedAt,
        })
        .where(eq(users.id, rawId))
        .returning();

      if (!updated) {
        return Result.err(RepositoryError.notFound('User', rawId));
      }
      return Result.ok();
    } catch (e: unknown) {
      const err = e as { message?: string };
      return Result.err(RepositoryError.transient(err.message ?? 'Erro ao salvar aggregate User', e));
    }
  }

  async updatePublicId(id: UserId, publicId: string): Promise<Result<void, RepositoryError>> {
    const rawId = id as unknown as number;
    const normalized = publicId.toLowerCase().trim();
    try {
      const [updated] = await this.db
        .update(users)
        .set({
          publicId: normalized,
          updatedAt: new Date(),
        })
        .where(eq(users.id, rawId))
        .returning();

      if (!updated) {
        return Result.err(RepositoryError.notFound('User', rawId));
      }
      return Result.ok();
    } catch (e: unknown) {
      const err = e as { message?: string };
      if (err.message?.includes('UNIQUE') || err.message?.includes('constraint')) {
        return Result.err(RepositoryError.conflict(`PublicId already in use: ${normalized}`, e));
      }
      return Result.err(RepositoryError.transient(err.message ?? 'Erro ao atualizar PublicId', e));
    }
  }

  async incrementAuthEpoch(userId: UserId): Promise<Result<number, RepositoryError>> {
    const rawId = userId as unknown as number;
    try {
      const [updated] = await this.db
        .update(users)
        .set({
          authEpoch: sql`${users.authEpoch} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(users.id, rawId))
        .returning();

      if (!updated) {
        return Result.err(RepositoryError.notFound('User', rawId));
      }
      return Result.ok(updated.authEpoch);
    } catch (e: unknown) {
      const err = e as { message?: string };
      return Result.err(RepositoryError.transient(err.message ?? 'Erro ao incrementar authEpoch', e));
    }
  }

  async incrementFailedLoginAttempts(userId: UserId): Promise<Result<number, RepositoryError>> {
    const rawId = userId as unknown as number;
    try {
      const now = new Date();
      const [updated] = await this.db
        .update(users)
        .set({
          failedLoginAttempts: sql`${users.failedLoginAttempts} + 1`,
          lastFailedLoginAt: now,
          updatedAt: now,
        })
        .where(eq(users.id, rawId))
        .returning();

      if (!updated) {
        return Result.err(RepositoryError.notFound('User', rawId));
      }
      return Result.ok(updated.failedLoginAttempts);
    } catch (e: unknown) {
      const err = e as { message?: string };
      return Result.err(RepositoryError.transient(err.message ?? 'Erro ao incrementar falhas de login', e));
    }
  }

  async resetFailedLoginAttempts(userId: UserId): Promise<Result<void, RepositoryError>> {
    const rawId = userId as unknown as number;
    try {
      const [updated] = await this.db
        .update(users)
        .set({
          failedLoginAttempts: 0,
          lastFailedLoginAt: null,
          updatedAt: new Date(),
        })
        .where(eq(users.id, rawId))
        .returning();

      if (!updated) {
        return Result.err(RepositoryError.notFound('User', rawId));
      }
      return Result.ok();
    } catch (e: unknown) {
      const err = e as { message?: string };
      return Result.err(RepositoryError.transient(err.message ?? 'Erro ao resetar falhas de login', e));
    }
  }

  private mapToRecord(raw: any): UserRecord {
    if (!raw.id || typeof raw.id !== 'number') {
      throw new Error(`Integridade violada: Usuário sem ID numérico válido.`);
    }

    if (!raw.status || !USER_STATUSES.includes(raw.status)) {
      throw new Error(`Integridade violada: Status inválido no banco: "${raw.status}"`);
    }

    if (!raw.subjectType || !USER_SUBJECT_TYPES.includes(raw.subjectType)) {
      throw new Error(`Integridade violada: SubjectType inválido no banco: "${raw.subjectType}"`);
    }

    if (raw.authEpoch === null || raw.authEpoch === undefined || typeof raw.authEpoch !== 'number') {
      throw new Error(`Integridade violada: authEpoch ausente ou nulo para usuário ${raw.id}`);
    }

    if (raw.failedLoginAttempts === null || raw.failedLoginAttempts === undefined || typeof raw.failedLoginAttempts !== 'number') {
      throw new Error(`Integridade violada: failedLoginAttempts ausente ou nulo para usuário ${raw.id}`);
    }

    return {
      id: fromTrustedUserId(raw.id),
      publicId: raw.publicId ? String(raw.publicId).toLowerCase().trim() : null,
      email: raw.email ? String(raw.email).trim() : null,
      emailNormalized: raw.emailNormalized ? String(raw.emailNormalized).toLowerCase().trim() : null,
      status: raw.status as UserStatus,
      subjectType: raw.subjectType as UserSubjectType,
      failedLoginAttempts: raw.failedLoginAttempts,
      lastFailedLoginAt: parseNullableDatabaseDate(raw.lastFailedLoginAt, 'lastFailedLoginAt'),
      authEpoch: raw.authEpoch,
      emailVerifiedAt: parseNullableDatabaseDate(raw.emailVerifiedAt, 'emailVerifiedAt'),
      emailChangedAt: parseNullableDatabaseDate(raw.emailChangedAt, 'emailChangedAt'),
      statusChangedAt: parseNullableDatabaseDate(raw.statusChangedAt, 'statusChangedAt'),
      lockedAt: parseNullableDatabaseDate(raw.lockedAt, 'lockedAt'),
      disabledAt: parseNullableDatabaseDate(raw.disabledAt, 'disabledAt'),
      deletedAt: parseNullableDatabaseDate(raw.deletedAt, 'deletedAt'),
      createdAt: parseDatabaseDate(raw.createdAt, 'createdAt'),
      updatedAt: parseDatabaseDate(raw.updatedAt, 'updatedAt'),
    };
  }
}
