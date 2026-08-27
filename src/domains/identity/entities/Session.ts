export interface SessionProps {
  id: string;
  userId: number;
  jti: string;
  ip: string | null;
  userAgent: string | null;
  refreshTokenHash: string;
  aal: number;
  authEpoch: number;
  lastActivityAt: Date | null;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  revocationReason: string | null;
}

export class Session {
  private props: SessionProps;

  private constructor(props: SessionProps) {
    this.props = { ...props };
  }

  public static fromPersistence(props: SessionProps): Session {
    return new Session(props);
  }

  get id(): string {
    return this.props.id;
  }

  get userId(): number {
    return this.props.userId;
  }

  get authEpoch(): number {
    return this.props.authEpoch;
  }
  
  get aal(): number {
    return this.props.aal;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get lastActivityAt(): Date | null {
    return this.props.lastActivityAt;
  }

  get isRevoked(): boolean {
    return this.props.revokedAt !== null;
  }

  get isExpired(): boolean {
    return new Date() > this.props.expiresAt;
  }

  public isValid(): boolean {
    return !this.isRevoked && !this.isExpired;
  }

  public matchesUserEpoch(userAuthEpoch: number): boolean {
    return this.props.authEpoch === userAuthEpoch;
  }

  public revoke(reason: string): void {
    if (!this.isRevoked) {
      this.props.revokedAt = new Date();
      this.props.revocationReason = reason;
    }
  }
}
