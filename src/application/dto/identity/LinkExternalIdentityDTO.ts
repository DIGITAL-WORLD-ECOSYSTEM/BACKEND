import { IdentityAssertion } from './IdentityAssertion';

export interface LinkExternalIdentityInputDTO {
  readonly userId: number;
  readonly sessionAal: number; // AAL2+ obrigatório (AF-007)
  readonly assertion: IdentityAssertion;
}

export interface LinkExternalIdentityOutputDTO {
  readonly success: boolean;
  readonly provider: string;
  readonly subjectId: string;
  readonly linkedAt: Date;
}
