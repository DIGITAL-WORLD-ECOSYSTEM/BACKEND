export interface RegisterAccountInputDTO {
  readonly email: string;
  readonly password: string;
  readonly displayName?: string;
  readonly username?: string;
}

export interface RegisterAccountOutputDTO {
  readonly userId: number;
  readonly email: string;
  readonly status: string;
  readonly createdAt: Date;
}
