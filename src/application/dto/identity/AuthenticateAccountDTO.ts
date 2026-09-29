export interface AuthenticateAccountDTO {
  readonly email: string;
  readonly password: string;
}

export interface AuthenticateAccountResult {
  readonly userId: number;
  readonly email: string;
  readonly publicId: string | null;
  readonly status: string;
}
