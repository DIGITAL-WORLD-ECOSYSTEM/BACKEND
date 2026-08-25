export interface VerifyWalletIdentityInputDTO {
  readonly message: string;
  readonly signature: string;
  readonly expectedNonce?: string;
  readonly expectedDomain?: string;
}

export interface VerifyWalletIdentityOutputDTO {
  readonly userId: number;
  readonly address: string;
  readonly chainId: number;
  readonly bindingType: string;
}
