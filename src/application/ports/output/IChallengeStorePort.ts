export interface IChallengeStorePort {
  saveNonce(username: string, nonce: string, ttlSeconds: number): Promise<void>;
  getNonce(username: string): Promise<string | null>;
  deleteNonce(username: string): Promise<void>;
}
