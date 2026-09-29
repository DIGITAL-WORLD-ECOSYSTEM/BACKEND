export interface SetupTotpDTO {
  readonly transactionId: string;
  readonly encryptionKey: string;
}

export interface SetupTotpResult {
  readonly secret: string;
  readonly otpauthUrl: string;
}
