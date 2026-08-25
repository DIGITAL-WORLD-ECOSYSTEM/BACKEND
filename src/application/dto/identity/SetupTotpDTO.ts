export interface SetupTotpDTO {
  userId: number;
}

export interface SetupTotpResult {
  secret: string;
  otpauthUrl: string;
}
