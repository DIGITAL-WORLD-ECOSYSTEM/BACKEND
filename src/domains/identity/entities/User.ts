export type UserStatus = 'active' | 'suspended' | 'pending_setup' | 'locked';
export type SubjectType = 'human' | 'service' | 'system' | 'citizen';

export interface UserProps {
  id: number;
  publicId?: string | null;
  email?: string | null;
  emailNormalized?: string | null;
  status: UserStatus;
  subjectType: SubjectType;
  failedLoginAttempts: number;
  lastFailedLoginAt: Date | null;
  authEpoch: number;
  createdAt: Date;
  updatedAt: Date;
}

export class User {
  public static readonly MAX_FAILED_ATTEMPTS = 5;

  private props: UserProps;

  constructor(props: UserProps) {
    this.props = { ...props };
  }

  get id(): number {
    return this.props.id;
  }

  get email(): string | null {
    return this.props.email || null;
  }

  get status(): UserStatus {
    return this.props.status;
  }

  get subjectType(): SubjectType {
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
    
    if (this.props.failedLoginAttempts >= User.MAX_FAILED_ATTEMPTS) {
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
