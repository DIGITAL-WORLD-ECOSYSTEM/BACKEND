import { eq, desc } from 'drizzle-orm';
import { citizens, identityDocuments, kycVerifications } from '../../db/civil-identity/tables';
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
    const username = did.split(':').pop();
    const [row] = await this.db
      .select()
      .from(citizens)
      .where(eq(citizens.username, username || did))
      .limit(1);

    if (!row) return null;
    return this.mapCitizenRow(row);
  }

  async createCitizen(data: Partial<CitizenRecord> & { userId: number }): Promise<CitizenRecord> {
    const [inserted] = await this.db
      .insert(citizens)
      .values({
        userId: data.userId,
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
    verifiedBy?: number
  ): Promise<void> {
    await this.db
      .update(citizens)
      .set({
        civilStatus,
        verifiedAt: civilStatus === 'verified' ? new Date() : null,
        verifiedBy: verifiedBy || null,
        statusChangedAt: new Date(),
      })
      .where(eq(citizens.userId, userId));
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
        source: data.source,
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
        verificationLevel: data.verificationLevel,
        status: data.status,
        provider: data.provider,
        riskScore: data.riskScore || null,
        rejectionReason: data.rejectionReason || null,
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
