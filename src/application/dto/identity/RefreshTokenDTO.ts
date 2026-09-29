export interface RefreshTokenDTO {
  readonly refreshToken: string;
}

export interface RefreshTokenResult {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresIn: number;
}
