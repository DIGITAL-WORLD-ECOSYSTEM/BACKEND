import { Result } from '../../../shared/kernel/Result';

export interface DidIdentityRecord {
  id: string; // UUID v4
  userId: number;
  did: string;
  method: 'key' | 'ion' | 'polygonid' | 'web' | 'cheqd' | 'pkh';
  controller: string;
  status?: 'active' | 'suspended' | 'revoked';
  version?: number;
}

export interface VerifiableCredentialRecord {
  id: string;
  holderUserId: number;
  issuerDid: string;
  subjectDid: string;
  credentialType: 'CivicIdentityCredential' | 'MembershipCredential' | 'KycVerificationCredential' | 'ReputationCredential';
  credentialHash: string;
  encryptedClaims: string;
  proofType: 'Ed25519Signature2020' | 'BbsBlsSignature2020' | 'JsonWebSignature2020';
  status: 'active' | 'suspended' | 'revoked' | 'expired';
  issuanceDate: Date;
  expirationDate?: Date | null;
  revokedAt?: Date | null;
  version?: number;
}

export interface ISsiRepository {
  findDidByUserId(userId: number): Promise<Result<DidIdentityRecord>>;
  saveDid(record: DidIdentityRecord): Promise<Result<DidIdentityRecord>>;
  saveVerifiableCredential(record: VerifiableCredentialRecord): Promise<Result<VerifiableCredentialRecord>>;
  findVerifiableCredentialById(id: string): Promise<Result<VerifiableCredentialRecord>>;
  listVerifiableCredentialsByUserId(userId: number): Promise<Result<VerifiableCredentialRecord[]>>;
  revokeVerifiableCredential(id: string): Promise<Result<void>>;
}

