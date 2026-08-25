/**
 * DTO Canônico do Resultado de Resolução de Identidade.
 */
export type IdentityResolutionResult =
  | {
      readonly status: 'resolved';
      readonly userId: number;
      readonly bindingType: 'oauth' | 'web3_wallet' | 'passkey' | 'ssi_did';
      readonly provider: 'google' | 'github' | 'discord' | 'apple' | 'evm' | 'webauthn' | 'polygonid';
    }
  | {
      readonly status: 'not_linked';
      readonly code: 'IDENTITY_NOT_LINKED';
      readonly message: string;
    };
