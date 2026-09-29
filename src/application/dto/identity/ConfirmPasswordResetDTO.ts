export interface ConfirmPasswordResetDTO {
  readonly token: string;
  readonly newPassword: string;
}
