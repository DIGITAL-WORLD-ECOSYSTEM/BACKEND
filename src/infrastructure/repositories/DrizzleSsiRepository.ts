import { eq, and, sql } from 'drizzle-orm';
import { didIdentities, verifiableCredentials } from '../../db/ssi/tables';
import { Result } from '../../shared/kernel/Result';
import {
  ISsiRepository,
  DidIdentityRecord,
  VerifiableCredentialRecord,
} from '../../application/ports/output/ISsiRepository';

export type { DidIdentityRecord, VerifiableCredentialRecord };

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

  async saveDid(record: DidIdentityRecord & { isPrimary?: boolean; revokedAt?: Date | null }): Promise<Result<DidIdentityRecord>> {
    try {
      const existing = await this.db
        .select()
        .from(didIdentities)
        .where(eq(didIdentities.id, record.id))
        .limit(1);

      const revokedAtValue = record.status === 'revoked' ? (record.revokedAt || new Date()) : null;

      if (!existing || existing.length === 0) {
        await this.db.insert(didIdentities).values({
          id: record.id,
          userId: record.userId,
          did: record.did,
          method: record.method,
          controller: record.controller,
          isPrimary: record.isPrimary ?? false,
          status: record.status || 'active',
          version: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
          revokedAt: revokedAtValue,
        });
        record.version = 1;
      } else {
        const currentVersion = record.version ?? existing[0].version ?? 1;

        const updated = await this.db
          .update(didIdentities)
          .set({
            status: record.status || 'active',
            isPrimary: record.isPrimary !== undefined ? record.isPrimary : existing[0].isPrimary,
            revokedAt: revokedAtValue,
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

  async saveVerifiableCredential(
    record: VerifiableCredentialRecord
  ): Promise<Result<VerifiableCredentialRecord>> {
    try {
      await this.db.insert(verifiableCredentials).values({
        id: record.id,
        holderUserId: record.holderUserId,
        issuerDid: record.issuerDid,
        subjectDid: record.subjectDid,
        credentialType: record.credentialType,
        credentialHash: record.credentialHash,
        encryptedClaims: record.encryptedClaims,
        proofType: record.proofType,
        status: record.status || 'active',
        issuanceDate: record.issuanceDate,
        expirationDate: record.expirationDate || null,
        revokedAt: record.status === 'revoked' ? (record.revokedAt || new Date()) : null,
        version: 1,
      });

      return Result.ok(record);
    } catch (error: any) {
      return Result.fail(error.message);
    }
  }

  async findVerifiableCredentialById(id: string): Promise<Result<VerifiableCredentialRecord>> {
    try {
      const [row] = await this.db
        .select()
        .from(verifiableCredentials)
        .where(eq(verifiableCredentials.id, id))
        .limit(1);

      if (!row) return Result.fail('Verifiable Credential not found');

      return Result.ok({
        id: row.id,
        holderUserId: row.holderUserId,
        issuerDid: row.issuerDid,
        subjectDid: row.subjectDid,
        credentialType: row.credentialType as any,
        credentialHash: row.credentialHash,
        encryptedClaims: row.encryptedClaims,
        proofType: row.proofType as any,
        status: row.status as any,
        issuanceDate: new Date(row.issuanceDate),
        expirationDate: row.expirationDate ? new Date(row.expirationDate) : null,
        revokedAt: row.revokedAt ? new Date(row.revokedAt) : null,
        version: row.version,
      });
    } catch (error: any) {
      return Result.fail(error.message);
    }
  }

  async listVerifiableCredentialsByUserId(
    userId: number
  ): Promise<Result<VerifiableCredentialRecord[]>> {
    try {
      const rows = await this.db
        .select()
        .from(verifiableCredentials)
        .where(
          and(
            eq(verifiableCredentials.holderUserId, userId),
            sql`${verifiableCredentials.status} != 'revoked'`
          )
        );

      const credentials: VerifiableCredentialRecord[] = rows.map((row: any) => ({
        id: row.id,
        holderUserId: row.holderUserId,
        issuerDid: row.issuerDid,
        subjectDid: row.subjectDid,
        credentialType: row.credentialType,
        credentialHash: row.credentialHash,
        encryptedClaims: row.encryptedClaims,
        proofType: row.proofType,
        status: row.status,
        issuanceDate: new Date(row.issuanceDate),
        expirationDate: row.expirationDate ? new Date(row.expirationDate) : null,
        revokedAt: row.revokedAt ? new Date(row.revokedAt) : null,
        version: row.version,
      }));

      return Result.ok(credentials);
    } catch (error: any) {
      return Result.fail(error.message);
    }
  }

  async revokeVerifiableCredential(id: string): Promise<Result<void>> {
    try {
      const res = await this.db
        .update(verifiableCredentials)
        .set({
          status: 'revoked',
          revokedAt: new Date(),
          version: sql`${verifiableCredentials.version} + 1`,
        })
        .where(
          and(
            eq(verifiableCredentials.id, id),
            sql`${verifiableCredentials.status} != 'revoked'`
          )
        );

      const affected = (res?.meta?.changes ?? res?.rowsAffected ?? 0);
      if (affected === 0) {
        return Result.fail('Verifiable Credential already revoked or not found');
      }

      return Result.ok(undefined);
    } catch (error: any) {
      return Result.fail(error.message);
    }
  }
}
