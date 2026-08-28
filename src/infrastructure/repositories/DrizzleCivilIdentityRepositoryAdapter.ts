import { eq, desc, and, isNull } from 'drizzle-orm';
import { citizens, identityDocuments, kycVerifications } from '../../db/civil-identity/tables';
import { didIdentities } from '../../db/ssi/tables';
import {
  ICivilIdentityRepository,
  CitizenRecord,
  IdentityDocumentRecord,
  KycVerificationRecord,
} from '../../application/ports/output/ICivilIdentityRepository';

export type { CitizenRecord, IdentityDocumentRecord, KycVerificationRecord };

export class DrizzleCivilIdentityRepositoryAdapter implements ICivilIdentityRepository {
  constructor(private readonly db: any) {}

  async findByDid(did: string): Promise<CitizenRecord | null> {
    const [row] = await this.db
      .select({
        userId: citizens.userId,
        username: citizens.username,
        legalFirstName: citizens.legalFirstName,
        legalLastName: citizens.legalLastName,
        nationalityCode: citizens.nationalityCode,
        birthDate: citizens.birthDate,
        maritalStatus: citizens.maritalStatus,
        civilStatus: citizens.civilStatus,
        verifiedAt: citizens.verifiedAt,
        verifiedBy: citizens.verifiedBy,
        version: citizens.version,
      })
      .from(didIdentities)
      .innerJoin(citizens, eq(didIdentities.userId, citizens.userId))
      .where(
        and(
          eq(didIdentities.did, did),
          eq(didIdentities.status, 'active')
        )
      )
      .limit(1);

    if (!row) return null;
    return this.mapCitizenRow(row);
  }

  async createCitizen(data: Partial<CitizenRecord> & { userId: number }): Promise<CitizenRecord> {
    const canonicalUsername = data.username ? data.username.trim().toLowerCase() : undefined;
    const [inserted] = await this.db
      .insert(citizens)
      .values({
        userId: data.userId,
        username: canonicalUsername,
        legalFirstName: data.legalFirstName || null,
        legalLastName: data.legalLastName || null,
        nationalityCode: data.nationalityCode || 'BR',
        birthDate: data.birthDate || null,
        maritalStatus: (data.maritalStatus as any) || null,
        civilStatus: data.civilStatus || 'pending',
      })
      .returning();

    return this.mapCitizenRow(inserted);
  }

  async findCitizenByUserId(userId: number): Promise<CitizenRecord | null> {
    const [row] = await this.db
      .select()
      .from(citizens)
      .where(eq(citizens.userId, userId))
      .limit(1);

    if (!row) return null;
    return this.mapCitizenRow(row);
  }

  async updateCivilStatus(
    userId: number,
    civilStatus: 'pending' | 'verified' | 'suspended' | 'revoked',
    verifiedBy?: number,
    expectedVersion?: number
  ): Promise<void> {
    const current = await this.findCitizenByUserId(userId);
    if (!current) {
      throw new Error(`Citizen record not found for userId ${userId}`);
    }
    const version = expectedVersion ?? current.version ?? 1;

    const res = await this.db
      .update(citizens)
      .set({
        civilStatus,
        verifiedAt: civilStatus === 'verified' ? new Date() : null,
        verifiedBy: verifiedBy || null,
        statusChangedAt: new Date(),
        version: version + 1,
      })
      .where(
        and(
          eq(citizens.userId, userId),
          eq(citizens.version, version)
        )
      );

    const affected = (res?.meta?.changes ?? res?.rowsAffected ?? 0);
    if (affected === 0) {
      throw new Error(`OCC update failed for citizen userId ${userId}`);
    }
  }

  async createIdentityDocument(data: IdentityDocumentRecord): Promise<IdentityDocumentRecord> {
    const [inserted] = await this.db
      .insert(identityDocuments)
      .values({
        userId: data.userId,
        documentType: data.documentType,
        countryCode: data.countryCode || 'BR',
        numberLookupHash: data.numberLookupHash,
        encryptedNumber: data.encryptedNumber,
        last4: data.last4 || null,
        documentHash: (data as any).documentHash || null,
        issuingAuthority: (data as any).issuingAuthority || null,
        issuedAt: (data as any).issuedAt || null,
        expiresAt: (data as any).expiresAt || null,
        source: data.source,
        sourceReference: (data as any).sourceReference || null,
        verificationStatus: data.verificationStatus || 'pending',
        verifiedAt: data.verifiedAt || null,
        verifiedBy: data.verifiedBy || null,
      })
      .returning();

    return {
      id: inserted.id,
      userId: inserted.userId,
      documentType: inserted.documentType as any,
      countryCode: inserted.countryCode,
      numberLookupHash: inserted.numberLookupHash,
      encryptedNumber: inserted.encryptedNumber,
      last4: inserted.last4,
      source: inserted.source as any,
      verificationStatus: inserted.verificationStatus as any,
      verifiedAt: inserted.verifiedAt ? new Date(inserted.verifiedAt) : null,
      verifiedBy: inserted.verifiedBy,
      version: inserted.version,
    };
  }

  async findDocumentsByUserId(userId: number): Promise<IdentityDocumentRecord[]> {
    const rows = await this.db
      .select()
      .from(identityDocuments)
      .where(eq(identityDocuments.userId, userId));

    return rows.map((r: any) => ({
      id: r.id,
      userId: r.userId,
      documentType: r.documentType,
      countryCode: r.countryCode,
      numberLookupHash: r.numberLookupHash,
      encryptedNumber: r.encryptedNumber,
      last4: r.last4,
      source: r.source,
      verificationStatus: r.verificationStatus,
      verifiedAt: r.verifiedAt ? new Date(r.verifiedAt) : null,
      verifiedBy: r.verifiedBy,
      version: r.version,
    }));
  }

  async createKycVerification(data: KycVerificationRecord): Promise<KycVerificationRecord> {
    const [inserted] = await this.db
      .insert(kycVerifications)
      .values({
        userId: data.userId,
        verificationVersion: (data as any).verificationVersion ?? 1,
        verificationLevel: data.verificationLevel,
        status: data.status,
        provider: data.provider,
        riskScore: data.riskScore || null,
        riskModel: (data as any).riskModel || null,
        riskModelVersion: (data as any).riskModelVersion || null,
        rejectionReason: data.rejectionReason || null,
        metadata: (data as any).metadata || null,
        reviewedBy: (data as any).reviewedBy || null,
        startedAt: data.startedAt,
        completedAt: data.completedAt || null,
        expiresAt: data.expiresAt || null,
      })
      .returning();

    return {
      id: inserted.id,
      userId: inserted.userId,
      verificationLevel: inserted.verificationLevel as any,
      status: inserted.status as any,
      provider: inserted.provider,
      riskScore: inserted.riskScore,
      rejectionReason: inserted.rejectionReason,
      startedAt: new Date(inserted.startedAt),
      completedAt: inserted.completedAt ? new Date(inserted.completedAt) : null,
      expiresAt: inserted.expiresAt ? new Date(inserted.expiresAt) : null,
      version: inserted.version,
    };
  }

  async getLatestKycByUserId(userId: number): Promise<KycVerificationRecord | null> {
    const [row] = await this.db
      .select()
      .from(kycVerifications)
      .where(eq(kycVerifications.userId, userId))
      .orderBy(desc(kycVerifications.id))
      .limit(1);

    if (!row) return null;

    return {
      id: row.id,
      userId: row.userId,
      verificationLevel: row.verificationLevel as any,
      status: row.status as any,
      provider: row.provider,
      riskScore: row.riskScore,
      rejectionReason: row.rejectionReason,
      startedAt: new Date(row.startedAt),
      completedAt: row.completedAt ? new Date(row.completedAt) : null,
      expiresAt: row.expiresAt ? new Date(row.expiresAt) : null,
      version: row.version,
    };
  }

  private mapCitizenRow(row: any): CitizenRecord {
    return {
      userId: row.userId,
      username: row.username,
      legalFirstName: row.legalFirstName,
      legalLastName: row.legalLastName,
      nationalityCode: row.nationalityCode,
      birthDate: row.birthDate,
      maritalStatus: row.maritalStatus,
      civilStatus: row.civilStatus,
      verifiedAt: row.verifiedAt ? new Date(row.verifiedAt) : null,
      verifiedBy: row.verifiedBy,
      version: row.version,
    };
  }
}
