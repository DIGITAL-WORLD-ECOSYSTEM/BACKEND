export interface SiweVerificationInput {
  readonly message: string;
  readonly signature: string;
  readonly expectedNonce?: string;
  readonly expectedDomain?: string;
}

export interface SiweVerificationOutput {
  readonly address: string;
  readonly chainId: number;
  readonly nonce: string;
  readonly domain: string;
}

export interface ISiweVerifierPort {
  verify(input: SiweVerificationInput): Promise<SiweVerificationOutput>;
}
