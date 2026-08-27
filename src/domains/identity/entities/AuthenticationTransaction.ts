export type AuthTransactionStatus =
  | 'created'
  | 'awaiting_factor'
  | 'verified'
  | 'completed'
  | 'expired'
  | 'cancelled'
  | 'failed'
  | 'replayed'
  | 'locked';

export type AuthContext =
  | 'login'
  | 'mfa_setup'
  | 'mfa_change'
  | 'credential_link'
  | 'credential_unlink'
  | 'sensitive_operation'
  | 'password_change'
  | 'recovery';

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface AuthenticationTransactionProps {
  id: string;
  userId: number;
  status: AuthTransactionStatus;
  initialAal: number;
  currentAal: number;
  targetAal: number;
  method: string;
  challengeHash?: string | null;
  context: AuthContext;
  ip?: string | null;
  userAgent?: string | null;
  createdAt: Date;
  expiresAt: Date;
  completedAt?: Date | null;
  consumedAt?: Date | null;
  failureCount: number;
  authEpochAtStart: number;
  lastAuthenticatedAt?: Date | null;
  assuranceMethod?: string | null;
  riskLevel: RiskLevel;
}

export class AuthenticationTransaction {
  private props: AuthenticationTransactionProps;

  constructor(props: AuthenticationTransactionProps) {
    this.props = { ...props };
  }

  get id(): string { return this.props.id; }
  get userId(): number { return this.props.userId; }
  get status(): AuthTransactionStatus { return this.props.status; }
  get targetAal(): number { return this.props.targetAal; }
  get currentAal(): number { return this.props.currentAal; }
  get context(): AuthContext { return this.props.context; }
  get authEpochAtStart(): number { return this.props.authEpochAtStart; }
  get expiresAt(): Date { return this.props.expiresAt; }
  get failureCount(): number { return this.props.failureCount; }

  public isExpired(now: Date = new Date()): boolean {
    return now.getTime() > this.props.expiresAt.getTime();
  }

  public isValid(currentAuthEpoch: number): boolean {
    if (this.isExpired()) return false;
    if (this.props.status === 'expired' || this.props.status === 'cancelled' || this.props.status === 'failed' || this.props.status === 'locked' || this.props.status === 'completed') {
      return false;
    }
    // AuthEpoch must match the one at the start of the transaction
    if (currentAuthEpoch !== this.props.authEpochAtStart) {
      return false;
    }
    return true;
  }

  public recordFailedAttempt(maxAttempts: number = 5): void {
    this.props.failureCount += 1;
    if (this.props.failureCount >= maxAttempts) {
      this.props.status = 'locked';
    }
  }

  public verifyFactor(method: string, newAal: number): void {
    if (this.props.status !== 'created' && this.props.status !== 'awaiting_factor') {
      throw new Error(`Cannot verify factor in status ${this.props.status}`);
    }
    this.props.method = method;
    this.props.currentAal = newAal;
    this.props.status = 'verified';
    this.props.assuranceMethod = method;
  }

  public complete(): void {
    if (this.props.status !== 'verified') {
      throw new Error('Transaction must be verified before completion');
    }
    this.props.status = 'completed';
    this.props.completedAt = new Date();
  }

  public toPersistence(): any {
    return { ...this.props };
  }

  public static fromPersistence(record: any): AuthenticationTransaction {
    return new AuthenticationTransaction({
      id: record.id,
      userId: record.userId,
      status: record.status,
      initialAal: record.initialAal,
      currentAal: record.currentAal,
      targetAal: record.targetAal,
      method: record.method,
      challengeHash: record.challengeHash,
      context: record.context,
      ip: record.ip,
      userAgent: record.userAgent,
      createdAt: new Date(record.createdAt),
      expiresAt: new Date(record.expiresAt),
      completedAt: record.completedAt ? new Date(record.completedAt) : null,
      consumedAt: record.consumedAt ? new Date(record.consumedAt) : null,
      failureCount: record.failureCount,
      authEpochAtStart: record.authEpochAtStart,
      lastAuthenticatedAt: record.lastAuthenticatedAt ? new Date(record.lastAuthenticatedAt) : null,
      assuranceMethod: record.assuranceMethod,
      riskLevel: record.riskLevel,
    });
  }
}
