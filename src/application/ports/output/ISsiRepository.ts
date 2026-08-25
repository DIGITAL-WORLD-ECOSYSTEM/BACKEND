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

export interface ISsiRepository {
  findDidByUserId(userId: number): Promise<Result<DidIdentityRecord>>;
  saveDid(record: DidIdentityRecord): Promise<Result<DidIdentityRecord>>;
}
