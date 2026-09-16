export type UserAccountStatus = 'active' | 'suspended' | 'pending_setup' | 'locked';
export type UserAccountSubjectType = 'human' | 'service' | 'system' | 'citizen';

export interface UserAccountProps {
  id: number;
  publicId?: string | null;
  email?: string | null;
  emailNormalized?: string | null;
  status: UserAccountStatus;
  subjectType: UserAccountSubjectType;
  failedLoginAttempts: number;
  lastFailedLoginAt: Date | null;
  authEpoch: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Entidade de Domínio do IAM: UserAccount
 * Representa a conta autenticável com controle de tentativas de login (brute-force),
 * bloqueio de segurança e authEpoch para revogação instantânea de sessões.
 */
export class UserAccount {
  public static readonly MAX_FAILED_ATTEMPTS = 5;

  private props: UserAccountProps;

  constructor(props: UserAccountProps) {
    this.props = { ...props };
  }

  get id(): number {
    return this.props.id;
  }

  get publicId(): string | null {
    return this.props.publicId || null;
  }

  get email(): string | null {
    return this.props.email || null;
  }

  get status(): UserAccountStatus {
    return this.props.status;
  }

  get subjectType(): UserAccountSubjectType {
    return this.props.subjectType;
  }

  get failedLoginAttempts(): number {
    return this.props.failedLoginAttempts;
  }

  get authEpoch(): number {
    return this.props.authEpoch;
  }

  public canAuthenticate(): boolean {
    if (this.props.status === 'suspended' || this.props.status === 'locked' || this.props.status === 'pending_setup') {
      return false;
    }

    // Only humans (or citizens, depending on legacy naming) can authenticate via standard login forms
    if (this.props.subjectType !== 'human' && this.props.subjectType !== 'citizen') {
      return false;
    }

    return true;
  }

  public registerFailedLogin(): void {
    this.props.failedLoginAttempts += 1;
    this.props.lastFailedLoginAt = new Date();

    if (this.props.failedLoginAttempts >= UserAccount.MAX_FAILED_ATTEMPTS) {
      this.props.status = 'locked';
    }
  }

  public resetFailedLogins(): void {
    this.props.failedLoginAttempts = 0;
    this.props.lastFailedLoginAt = null;

    if (this.props.status === 'locked') {
      this.props.status = 'active';
    }
  }
}
