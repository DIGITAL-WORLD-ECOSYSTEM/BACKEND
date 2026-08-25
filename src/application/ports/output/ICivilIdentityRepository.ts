export interface CitizenRecord {
  userId: number;
  username: string | null;
  legalFirstName: string | null;
  legalLastName: string | null;
  nationalityCode: string | null;
  birthDate: string | null;
  maritalStatus: string | null;
  civilStatus: 'pending' | 'verified' | 'suspended' | 'revoked';
  status?: string;
  publicKey?: string;
  did?: string;
  verifiedAt?: Date | null;
  verifiedBy?: number | null;
  version?: number;
}


export interface IdentityDocumentRecord {
  id?: number;
  userId: number;
  documentType: 'cpf' | 'rg' | 'passport' | 'cnh';
  countryCode: string;
  numberLookupHash: string;
  encryptedNumber: string;
  last4?: string | null;
  source: 'government' | 'manual_upload' | 'kyc_provider' | 'admin' | 'import';
  verificationStatus: 'pending' | 'verified' | 'rejected';
  verifiedAt?: Date | null;
  verifiedBy?: number | null;
  version?: number;
}

export interface KycVerificationRecord {
  id?: number;
  userId: number;
  verificationLevel: 'basic' | 'enhanced' | 'institutional';
  status: 'submitted' | 'under_review' | 'approved' | 'rejected' | 'expired';
  provider: string;
  riskScore?: number | null;
  rejectionReason?: string | null;
  startedAt: Date;
  completedAt?: Date | null;
  expiresAt?: Date | null;
  version?: number;
}

export interface ICivilIdentityRepository {
  findByDid(did: string): Promise<CitizenRecord | null>;
  createCitizen(data: Partial<CitizenRecord> & { userId: number }): Promise<CitizenRecord>;
  findCitizenByUserId(userId: number): Promise<CitizenRecord | null>;
  updateCivilStatus(userId: number, civilStatus: 'pending' | 'verified' | 'suspended' | 'revoked', verifiedBy?: number): Promise<void>;
  createIdentityDocument(data: IdentityDocumentRecord): Promise<IdentityDocumentRecord>;
  findDocumentsByUserId(userId: number): Promise<IdentityDocumentRecord[]>;
  createKycVerification(data: KycVerificationRecord): Promise<KycVerificationRecord>;
  getLatestKycByUserId(userId: number): Promise<KycVerificationRecord | null>;
}

