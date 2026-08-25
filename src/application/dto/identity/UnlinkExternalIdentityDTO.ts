export interface UnlinkExternalIdentityInputDTO {
  readonly userId: number;
  readonly sessionAal: number;
  readonly provider: string;
  readonly subjectId: string;
}

export interface UnlinkExternalIdentityOutputDTO {
  readonly success: boolean;
  readonly unlinkedAt: Date;
}
