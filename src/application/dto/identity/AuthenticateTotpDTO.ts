export interface AuthenticateTotpDTO {
  userId: number;
  code: string;
  sessionId?: string;
}
