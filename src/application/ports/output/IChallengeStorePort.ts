export type NonceConsumeResult = 'VALID' | 'INVALID' | 'EXPIRED';

export interface IChallengeStorePort {
  saveNonce(username: string, nonce: string, ttlSeconds: number): Promise<void>;

  /**
   * Atomically validates and consumes a nonce in a single operation.
   * Eliminates the TOCTOU race condition of separate get+delete calls.
   *
   * - VALID   → nonce matched and was consumed (deleted)
   * - INVALID → nonce not found or mismatch
   * - EXPIRED → nonce existed but TTL had elapsed
   */
  consumeNonce(username: string, nonce: string): Promise<NonceConsumeResult>;
}

