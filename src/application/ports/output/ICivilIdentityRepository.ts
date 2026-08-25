export interface CitizenRecord {
  userId: number;
  username: string | null;
  civilStatus: string;
  status?: string;
  publicKey?: string;
  did?: string;
}

export interface ICivilIdentityRepository {
  findByDid(did: string): Promise<CitizenRecord | null>;
}
