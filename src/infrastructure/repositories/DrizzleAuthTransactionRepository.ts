import { DrizzleD1Database } from '../../types/bindings';
import { IAuthTransactionRepository } from '../../application/ports/output/IAuthTransactionRepository';
import { AuthenticationTransaction } from '../../domains/identity/entities/AuthenticationTransaction';
import { AuthenticationChallenge } from '../../domains/identity/entities/AuthenticationChallenge';
import { authTransactions, authChallenges } from '../../db/authentication/tables';
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
    const currentVersion = (data as any).version ?? 1;
    const res = await (this.db as any)
      .update(authTransactions)
      .set({
        ...data,
        version: currentVersion + 1,
      })
      .where(
        and(
          eq(authTransactions.id, data.id),
          eq(authTransactions.version, currentVersion)
        )
      );

    const affected = (res?.meta?.changes ?? res?.rowsAffected ?? 0);
    if (affected === 0) {
      throw new Error(`AuthenticationTransaction OCC failed or transaction locked: ${data.id}`);
    }
  }

  async createChallenge(challenge: AuthenticationChallenge): Promise<void> {
    const data = challenge.toPersistence();
    await this.db.insert(authChallenges).values(data);
  }

  async getChallengeById(id: string): Promise<AuthenticationChallenge | null> {
    const result = await (this.db as any)
      .select()
      .from(authChallenges)
      .where(
        and(
          eq(authChallenges.id, id),
          isNull(authChallenges.usedAt),
          gt(authChallenges.expiresAt, new Date())
        )
      )
      .limit(1)
      .get();

    if (!result) return null;
    return AuthenticationChallenge.fromPersistence(result);
  }

  async getChallengeByHash(hash: string): Promise<AuthenticationChallenge | null> {
    const result = await (this.db as any)
      .select()
      .from(authChallenges)
      .where(
        and(
          eq(authChallenges.challengeHash, hash),
          isNull(authChallenges.usedAt),
          gt(authChallenges.expiresAt, new Date())
        )
      )
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
    const result: any = await this.db
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
          eq(authTransactions.authEpochAtStart, authEpochAtStart),
          gt(authTransactions.expiresAt, new Date())
        )
      );
      
    const affected = (result?.meta?.changes ?? result?.rowsAffected ?? 0);
    return affected > 0;
  }

  async recordFailedAttemptAtomically(txId: string, maxAttempts: number): Promise<boolean> {
    const result: any = await this.db
      .update(authTransactions)
      .set({
        failureCount: sql`${authTransactions.failureCount} + 1`,
        status: sql`CASE WHEN ${authTransactions.failureCount} + 1 >= ${maxAttempts} THEN 'locked' ELSE ${authTransactions.status} END`
      })
      .where(
        and(
          eq(authTransactions.id, txId),
          inArray(authTransactions.status, ['created', 'awaiting_factor']),
          gt(authTransactions.expiresAt, new Date())
        )
      );
      
    const affected = (result?.meta?.changes ?? result?.rowsAffected ?? 0);
    return affected > 0;
  }

  async consumeChallengeAtomically(challengeId: string): Promise<boolean> {
    const result: any = await this.db
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

    const affected = (result?.meta?.changes ?? result?.rowsAffected ?? 0);
    return affected > 0;
  }
}
