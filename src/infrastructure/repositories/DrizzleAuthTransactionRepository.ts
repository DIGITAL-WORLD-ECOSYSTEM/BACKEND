import { DrizzleD1Database } from '../../../types/bindings';
import { IAuthTransactionRepository } from '../../../application/ports/output/IAuthTransactionRepository';
import { AuthenticationTransaction } from '../../../domains/identity/entities/AuthenticationTransaction';
import { AuthenticationChallenge } from '../../../domains/identity/entities/AuthenticationChallenge';
import { authTransactions, authChallenges } from '../../../db/authentication/tables';
import { eq, sql, and, inArray, gt, isNull } from 'drizzle-orm';

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
      .where(
        and(
          eq(authTransactions.id, txId),
          inArray(authTransactions.status, ['created', 'awaiting_factor']),
          eq(authTransactions.authEpochAtStart, authEpochAtStart)
        )
      );
      
    return result.meta.changes > 0;
  }

  async recordFailedAttemptAtomically(txId: string, maxAttempts: number): Promise<boolean> {
    const result = await this.db
      .update(authTransactions)
      .set({
        failureCount: sql`${authTransactions.failureCount} + 1`,
        status: sql`CASE WHEN ${authTransactions.failureCount} + 1 >= ${maxAttempts} THEN 'locked' ELSE ${authTransactions.status} END`
      })
      .where(
        and(
          eq(authTransactions.id, txId),
          inArray(authTransactions.status, ['created', 'awaiting_factor'])
        )
      );
      
    return result.meta.changes > 0;
  }

  async consumeChallengeAtomically(challengeId: string): Promise<boolean> {
    const result = await this.db
      .update(authChallenges)
      .set({
        usedAt: new Date()
      })
      .where(
        and(
          eq(authChallenges.id, challengeId),
          isNull(authChallenges.usedAt),
          gt(authChallenges.expiresAt, new Date())
        )
      );
    return result.meta.changes > 0;
  }
}
