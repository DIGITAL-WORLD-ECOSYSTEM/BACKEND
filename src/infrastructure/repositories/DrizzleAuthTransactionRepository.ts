import { DrizzleD1Database } from '../../../types/bindings';
import { IAuthTransactionRepository } from '../../../application/ports/output/IAuthTransactionRepository';
import { AuthenticationTransaction } from '../../../domains/identity/entities/AuthenticationTransaction';
import { AuthenticationChallenge } from '../../../domains/identity/entities/AuthenticationChallenge';
import { authTransactions, authChallenges } from '../../../db/authentication/tables';
import { eq } from 'drizzle-orm';

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
}
