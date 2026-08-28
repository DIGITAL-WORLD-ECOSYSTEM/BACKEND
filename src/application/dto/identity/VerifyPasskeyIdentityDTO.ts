export interface VerifyPasskeyIdentityInputDTO {
  readonly challengeId: string;
  readonly responseJSON: any;
  readonly expectedOrigin: string;
  readonly expectedRPID: string;
}

export interface VerifyPasskeyIdentityOutputDTO {
  readonly userId: number;
  readonly credentialId: string;
  readonly bindingType: string;
}
