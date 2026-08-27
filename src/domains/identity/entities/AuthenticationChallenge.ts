import { AuthContext } from './AuthenticationTransaction';

export interface AuthenticationChallengeProps {
  id: string;
  transactionId?: string | null;
  userId?: number | null;
  challengeHash: string;
  challengeType: string;
  context: AuthContext;
  usedAt?: Date | null;
  createdAt: Date;
  expiresAt: Date;
}

export class AuthenticationChallenge {
  private props: AuthenticationChallengeProps;

  constructor(props: AuthenticationChallengeProps) {
    this.props = { ...props };
  }

  get id(): string { return this.props.id; }
  get transactionId(): string | null { return this.props.transactionId || null; }
  get challengeHash(): string { return this.props.challengeHash; }
  get context(): AuthContext { return this.props.context; }

  public isExpired(now: Date = new Date()): boolean {
    return now.getTime() > this.props.expiresAt.getTime();
  }

  public isUsed(): boolean {
    return this.props.usedAt !== null && this.props.usedAt !== undefined;
  }

  public isValid(): boolean {
    return !this.isExpired() && !this.isUsed();
  }

  public markAsUsed(): void {
    if (this.isUsed()) {
      throw new Error('Challenge already used (Replay detected)');
    }
    this.props.usedAt = new Date();
  }

  public toPersistence(): any {
    return { ...this.props };
  }

  public static fromPersistence(record: any): AuthenticationChallenge {
    return new AuthenticationChallenge({
      id: record.id,
      transactionId: record.transactionId,
      userId: record.userId,
      challengeHash: record.challengeHash,
      challengeType: record.challengeType,
      context: record.context as AuthContext,
      usedAt: record.usedAt ? new Date(record.usedAt) : null,
      createdAt: new Date(record.createdAt),
      expiresAt: new Date(record.expiresAt),
    });
  }
}
