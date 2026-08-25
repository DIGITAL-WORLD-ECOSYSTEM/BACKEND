export interface VerifyPasskeyIdentityInputDTO {
  readonly credentialId: string;
  readonly clientDataJSON: string;
  readonly authenticatorData: string;
  readonly signature: string;
}

export interface VerifyPasskeyIdentityOutputDTO {
  readonly userId: number;
  readonly credentialId: string;
  readonly bindingType: string;
}
