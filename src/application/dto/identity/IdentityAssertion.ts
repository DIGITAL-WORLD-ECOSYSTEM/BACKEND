/**
 * DTO Canônico de Afirmação de Identidade Externa (Discriminated Union).
 * Garante em tempo de compilação que provedores e mecanismos não sofram combinações inválidas.
 */
export type IdentityAssertion =
  | {
      readonly type: 'oauth';
      readonly provider: 'google' | 'github' | 'discord' | 'apple';
      readonly subjectId: string;
      readonly emailSnapshot?: string;
      readonly verifiedAt: Date;
    }
  | {
      readonly type: 'web3_wallet';
      readonly provider: 'evm';
      readonly subjectId: string; // Endereço EVM normalizado em minúsculas
      readonly networkId: number;
      readonly verifiedAt: Date;
    }
  | {
      readonly type: 'passkey';
      readonly provider: 'webauthn';
      readonly subjectId: string; // Passkey Credential ID
      readonly verifiedAt: Date;
    }
  | {
      readonly type: 'ssi_did';
      readonly provider: 'polygonid';
      readonly subjectId: string; // W3C DID string
      readonly verifiedAt: Date;
    };
