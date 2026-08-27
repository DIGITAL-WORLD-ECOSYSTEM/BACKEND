import { AuthenticationTransaction } from '../../../domains/identity/entities/AuthenticationTransaction';
import { AuthenticationChallenge } from '../../../domains/identity/entities/AuthenticationChallenge';

export interface IAuthTransactionRepository {
  createTransaction(transaction: AuthenticationTransaction): Promise<void>;
  getTransactionById(id: string): Promise<AuthenticationTransaction | null>;
  updateTransaction(transaction: AuthenticationTransaction): Promise<void>;
  
  createChallenge(challenge: AuthenticationChallenge): Promise<void>;
  getChallengeById(id: string): Promise<AuthenticationChallenge | null>;
  getChallengeByHash(hash: string): Promise<AuthenticationChallenge | null>;
  updateChallenge(challenge: AuthenticationChallenge): Promise<void>;
  
  // Atomic Operations
  completeFactorAtomically(txId: string, aal: number, authEpochAtStart: number, method: string): Promise<boolean>;
  recordFailedAttemptAtomically(txId: string, maxAttempts: number): Promise<boolean>;
  consumeChallengeAtomically(challengeId: string): Promise<boolean>;
}
