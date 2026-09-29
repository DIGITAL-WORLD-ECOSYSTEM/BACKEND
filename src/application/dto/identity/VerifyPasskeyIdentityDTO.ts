import type { AuthenticationResponseJSON } from '@simplewebauthn/server';

export interface VerifyPasskeyIdentityInputDTO {
  readonly challengeId: string;
  readonly responseJSON: AuthenticationResponseJSON;
  readonly expectedOrigin: string;
  readonly expectedRPID: string;
}

export interface VerifyPasskeyIdentityOutputDTO {
  readonly userId: number;
  readonly credentialId: string;
  readonly bindingType: string;
}
