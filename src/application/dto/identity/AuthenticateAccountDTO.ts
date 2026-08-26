export interface AuthenticateAccountDTO {
  email: string;
  password: string;
}

export interface AuthenticateAccountResult {
  userId: number;
  email: string;
  publicId: string | null;
  status: string;
}
