import { eq, and, sql } from 'drizzle-orm';
import { didIdentities } from '../../db/ssi/tables';
import { Result } from '../../shared/kernel/Result';
import {
  ISsiRepository,
  DidIdentityRecord,
} from '../../application/ports/output/ISsiRepository';

export type { DidIdentityRecord };


export class DrizzleSsiRepository implements ISsiRepository {
  constructor(private db: any) {}

  async findDidByUserId(userId: number): Promise<Result<DidIdentityRecord>> {
    try {
      const result = await this.db
        .select()
        .from(didIdentities)
        .where(and(eq(didIdentities.userId, userId), eq(didIdentities.status, 'active')))
        .limit(1);

      if (!result || result.length === 0) {
        return Result.fail('DID identity not found');
      }

      return Result.ok({
        id: result[0].id,
        userId: result[0].userId,
        did: result[0].did,
        method: result[0].method,
        controller: result[0].controller,
        status: result[0].status,
        version: result[0].version || 1,
      });
    } catch (error: any) {
      return Result.fail(error.message);
    }
  }

  async saveDid(record: DidIdentityRecord): Promise<Result<DidIdentityRecord>> {
    try {
      const existing = await this.db
        .select()
        .from(didIdentities)
        .where(eq(didIdentities.id, record.id))
        .limit(1);

      if (!existing || existing.length === 0) {
        await this.db.insert(didIdentities).values({
          id: record.id,
          userId: record.userId,
          did: record.did,
          method: record.method,
          controller: record.controller,
          status: record.status || 'active',
          version: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        record.version = 1;
      } else {
        const currentVersion = record.version ?? existing[0].version ?? 1;

        const updated = await this.db
          .update(didIdentities)
          .set({
            status: record.status || 'active',
            updatedAt: new Date(),
            version: sql`${didIdentities.version} + 1`,
          })
          .where(
            and(
              eq(didIdentities.id, record.id),
              eq(didIdentities.version, currentVersion)
            )
          )
          .returning();

        if (!updated || updated.length === 0) {
          return Result.fail('CONCURRENT_MODIFICATION_ERROR: DID identity was modified by another process');
        }

        record.version = currentVersion + 1;
      }
      return Result.ok(record);
    } catch (error: any) {
      return Result.fail(error.message);
    }
  }
}

