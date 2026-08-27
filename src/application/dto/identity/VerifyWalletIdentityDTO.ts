export interface VerifyWalletIdentityInputDTO {
  readonly challengeId: string;
  readonly message: string;
  readonly signature: string;
  readonly expectedDomain?: string;
}

export interface VerifyWalletIdentityOutputDTO {
  readonly userId: number;
  readonly address: string;
  readonly chainId: number;
  readonly bindingType: string;
}
