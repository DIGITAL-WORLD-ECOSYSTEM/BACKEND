export interface AuthenticateTotpDTO {
  transactionId: string;
  code: string;
  encryptionKey: string;
  sessionId?: string;
}
