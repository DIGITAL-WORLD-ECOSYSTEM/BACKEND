import { Result } from '../../../shared/kernel/Result';
import { RepositoryError } from '../../../shared/kernel/RepositoryError';

export type CivilStatus = 'pending' | 'verified' | 'suspended' | 'revoked';
export type DocumentType = 'cpf' | 'rg' | 'passport' | 'cnh';
export type DocumentSource = 'government' | 'manual_upload' | 'kyc_provider' | 'admin' | 'import';
export type DocumentVerificationStatus = 'pending' | 'verified' | 'rejected';
export type KycVerificationLevel = 'basic' | 'enhanced' | 'institutional';
export type KycStatus = 'submitted' | 'under_review' | 'approved' | 'rejected' | 'expired';

export interface CitizenRecord {
  userId: number;
  username: string | null;
  legalFirstName: string | null;
  legalLastName: string | null;
  nationalityCode: string | null;
  birthDate: string | null;
  maritalStatus: string | null;
  /** Canonical civil identity status. Single source of truth — status?: string removed. */
  civilStatus: CivilStatus;
  publicKey?: string;
  did?: string;
  verifiedAt?: Date | null;
  verifiedBy?: number | null;
  version?: number;
}

/** Explicit creation DTO — replaces the unsafe Partial<CitizenRecord> pattern. */
export interface CreateCitizenData {
  userId: number;
  legalFirstName: string;
  legalLastName: string;
  nationalityCode: string;
  birthDate?: string;
  maritalStatus?: string;
  username?: string;
  civilStatus?: CivilStatus;
}

export interface IdentityDocumentRecord {
  id?: number;
  userId: number;
  documentType: DocumentType;
  countryCode: string;
  numberLookupHash: string;
  encryptedNumber: string;
  last4?: string | null;
  source: DocumentSource;
  verificationStatus: DocumentVerificationStatus;
  verifiedAt?: Date | null;
  verifiedBy?: number | null;
  version?: number;
}

export interface KycVerificationRecord {
  id?: number;
  userId: number;
  verificationLevel: KycVerificationLevel;
  status: KycStatus;
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
  findCitizenByUserId(userId: number): Promise<CitizenRecord | null>;
  createCitizen(data: CreateCitizenData): Promise<Result<CitizenRecord, RepositoryError>>;
  updateCivilStatus(userId: number, civilStatus: CivilStatus, verifiedBy?: number): Promise<Result<void, RepositoryError>>;
  createIdentityDocument(data: IdentityDocumentRecord): Promise<Result<IdentityDocumentRecord, RepositoryError>>;
  findDocumentsByUserId(userId: number): Promise<IdentityDocumentRecord[]>;
  createKycVerification(data: KycVerificationRecord): Promise<Result<KycVerificationRecord, RepositoryError>>;
  getLatestKycByUserId(userId: number): Promise<KycVerificationRecord | null>;
}
