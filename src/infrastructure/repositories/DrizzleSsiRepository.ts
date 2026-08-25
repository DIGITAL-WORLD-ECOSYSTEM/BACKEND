import { eq, and } from 'drizzle-orm';
import { didIdentities, secureVaults, verifiableCredentials } from '../../db/ssi/tables';
import { Result } from '../../shared/kernel/Result';

export interface DidIdentityRecord {
  id: string; // UUID v4
  userId: number;
  did: string;
  method: 'key' | 'ion' | 'polygonid' | 'web' | 'cheqd' | 'pkh';
  controller: string;
  status?: 'active' | 'suspended' | 'revoked';
}

export class DrizzleSsiRepository {
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

      return Result.ok(result[0]);
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
      } else {
        await this.db
          .update(didIdentities)
          .set({
            status: record.status || 'active',
            updatedAt: new Date(),
          })
          .where(eq(didIdentities.id, record.id));
      }
      return Result.ok(record);
    } catch (error: any) {
      return Result.fail(error.message);
    }
  }
}
