export interface SetupTotpDTO {
  transactionId: string;
  encryptionKey: string;
}

export interface SetupTotpResult {
  secret: string;
  otpauthUrl: string;
}
