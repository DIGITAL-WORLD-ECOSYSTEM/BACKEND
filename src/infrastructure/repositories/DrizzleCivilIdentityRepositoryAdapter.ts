import { eq, or } from 'drizzle-orm';
import { citizens } from '../../db/civil-identity/tables';
import {
  ICivilIdentityRepository,
  CitizenRecord,
} from '../../application/ports/output/ICivilIdentityRepository';

export type { CitizenRecord };

export class DrizzleCivilIdentityRepositoryAdapter implements ICivilIdentityRepository {
  constructor(private readonly db: any) {}

  async findByDid(did: string): Promise<CitizenRecord | null> {
    const username = did.split(':').pop();
    const [row] = await this.db
      .select()
      .from(citizens)
      .where(
        username
          ? or(eq((citizens as any).did, did), eq(citizens.username, username))
          : eq((citizens as any).did, did)
      )
      .limit(1);

    if (!row) return null;
    return {
      userId: row.userId,
      username: row.username,
      civilStatus: row.civilStatus,
      status: row.status || row.civilStatus,
      publicKey: row.publicKey,
      did: row.did || did,
    };
  }
}
