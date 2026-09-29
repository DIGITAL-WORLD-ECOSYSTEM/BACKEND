export interface AuthenticateTotpDTO {
  readonly transactionId: string;
  readonly code: string;
  readonly encryptionKey: string;
  readonly sessionId?: string;
}
