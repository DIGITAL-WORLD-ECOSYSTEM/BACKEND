import { DrizzleD1Database } from '../../../types/bindings';
import { IAuthTransactionRepository } from '../../../application/ports/output/IAuthTransactionRepository';
import { AuthenticationTransaction } from '../../../domains/identity/entities/AuthenticationTransaction';
import { AuthenticationChallenge } from '../../../domains/identity/entities/AuthenticationChallenge';
import { authTransactions, authChallenges } from '../../../db/authentication/tables';
import { eq, sql } from 'drizzle-orm';

export class DrizzleAuthTransactionRepository implements IAuthTransactionRepository {
  constructor(private readonly db: DrizzleD1Database) {}

  async createTransaction(transaction: AuthenticationTransaction): Promise<void> {
    const data = transaction.toPersistence();
    await this.db.insert(authTransactions).values(data);
  }

  async getTransactionById(id: string): Promise<AuthenticationTransaction | null> {
    const result = await this.db
      .select()
      .from(authTransactions)
      .where(eq(authTransactions.id, id))
      .limit(1)
      .get();
      
    if (!result) return null;
    return AuthenticationTransaction.fromPersistence(result);
  }

  async updateTransaction(transaction: AuthenticationTransaction): Promise<void> {
    const data = transaction.toPersistence();
    await this.db
      .update(authTransactions)
      .set(data)
      .where(eq(authTransactions.id, data.id));
  }

  async createChallenge(challenge: AuthenticationChallenge): Promise<void> {
    const data = challenge.toPersistence();
    await this.db.insert(authChallenges).values(data);
  }

  async getChallengeById(id: string): Promise<AuthenticationChallenge | null> {
    const result = await this.db
      .select()
      .from(authChallenges)
      .where(eq(authChallenges.id, id))
      .limit(1)
      .get();

    if (!result) return null;
    return AuthenticationChallenge.fromPersistence(result);
  }

  async getChallengeByHash(hash: string): Promise<AuthenticationChallenge | null> {
    const result = await this.db
      .select()
      .from(authChallenges)
      .where(eq(authChallenges.challengeHash, hash))
      .limit(1)
      .get();

    if (!result) return null;
    return AuthenticationChallenge.fromPersistence(result);
  }

  async updateChallenge(challenge: AuthenticationChallenge): Promise<void> {
    const data = challenge.toPersistence();
    await this.db
      .update(authChallenges)
      .set(data)
      .where(eq(authChallenges.id, data.id));
  }

  async completeFactorAtomically(txId: string, aal: number, authEpochAtStart: number, method: string): Promise<boolean> {
    const result = await this.db
      .update(authTransactions)
      .set({
        status: 'verified',
        currentAal: aal,
        method: method,
        assuranceMethod: method,
        lastAuthenticatedAt: new Date()
      })
      .where(sql`${authTransactions.id} = ${txId} AND ${authTransactions.status} IN ('created', 'awaiting_factor') AND ${authTransactions.authEpochAtStart} = ${authEpochAtStart}`);
      
    return result.meta.changes > 0;
  }

  async recordFailedAttemptAtomically(txId: string, maxAttempts: number): Promise<boolean> {
    const result = await this.db
      .update(authTransactions)
      .set({
        failureCount: sql`${authTransactions.failureCount} + 1`,
        status: sql`CASE WHEN ${authTransactions.failureCount} + 1 >= ${maxAttempts} THEN 'locked' ELSE ${authTransactions.status} END`
      })
      .where(sql`${authTransactions.id} = ${txId} AND ${authTransactions.status} IN ('created', 'awaiting_factor')`);
      
    return result.meta.changes > 0;
  }

  async consumeChallengeAtomically(challengeId: string): Promise<boolean> {
    const result = await this.db
      .update(authChallenges)
      .set({
        usedAt: new Date()
      })
      .where(sql`${authChallenges.id} = ${challengeId} AND ${authChallenges.usedAt} IS NULL AND ${authChallenges.expiresAt} > ${new Date().getTime()}`); // SQLite uses integer timestamp if configured so, but standard is Date. Let's use current_timestamp or just JS Date. Since Drizzle maps Date to int, `new Date()` works. Wait, to be safe, `(strftime('%s', 'now') * 1000)` or just Drizzle's `eq` / `gt`.
      
    // Better Drizzle where syntax
    return result.meta.changes > 0;
  }
}
