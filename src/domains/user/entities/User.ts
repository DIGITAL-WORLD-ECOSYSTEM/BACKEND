import { Result } from '../../../shared/kernel/Result';
import { UserId } from '../../../shared/kernel/ids/UserId';
import { UserStatus, UserSubjectType, USER_SUBJECT_TYPES } from '../types';
import { UserStatusPolicy, StatusTransitionOptions } from '../policies/UserStatusPolicy';
import {
  InvalidUserStatusTransitionError,
  InvalidUserSubjectTypeError,
  PublicIdAlreadyAssignedError,
  AlreadyDeletedError,
  InvalidEmailVerificationError,
} from '../errors/UserErrors';
import { PublicId } from '../value-objects/PublicId';
import { Email } from '../value-objects/Email';

export interface UserPropsInternal {
  id: UserId;
  publicId: PublicId | null;
  subjectType: UserSubjectType;
  email: Email | null;
  emailVerifiedAt: Date | null;
  emailChangedAt: Date | null;
  status: UserStatus;
  statusChangedAt: Date | null;
  lockedAt: Date | null;
  disabledAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export class User {
  private constructor(private props: UserPropsInternal) {}

  /**
   * Factory de criação de nova Conta com validação rigorosa de domínio em runtime.
   */
  public static create(params: {
    id: UserId;
    email?: Email | null;
    subjectType?: UserSubjectType;
    status?: UserStatus;
    publicId?: PublicId | null;
  }): Result<User, Error> {
    const subjectType = params.subjectType ?? 'human';
    if (!USER_SUBJECT_TYPES.includes(subjectType)) {
      return Result.err(new InvalidUserSubjectTypeError(String(subjectType)));
    }

    const status = params.status ?? 'pending_setup';
    const statusValidation = UserStatusPolicy.validateStatus(status);
    if (statusValidation.isErr()) {
      return Result.err(statusValidation.typedError || new Error(`Status inválido: ${status}`));
    }

    const now = new Date();
    return Result.ok(
      new User({
        id: params.id,
        publicId: params.publicId ?? null,
        subjectType,
        email: params.email ?? null,
        emailVerifiedAt: null,
        emailChangedAt: null,
        status,
        statusChangedAt: null,
        lockedAt: null,
        disabledAt: null,
        deletedAt: null,
        createdAt: now,
        updatedAt: now,
      })
    );
  }

  /**
   * Hidratação a partir da camada de persistência com validações de integridade.
   */
  public static fromPersistence(props: UserPropsInternal): User {
    return new User({
      ...props,
      createdAt: new Date(props.createdAt.getTime()),
      updatedAt: new Date(props.updatedAt.getTime()),
      emailVerifiedAt: props.emailVerifiedAt ? new Date(props.emailVerifiedAt.getTime()) : null,
      emailChangedAt: props.emailChangedAt ? new Date(props.emailChangedAt.getTime()) : null,
      statusChangedAt: props.statusChangedAt ? new Date(props.statusChangedAt.getTime()) : null,
      lockedAt: props.lockedAt ? new Date(props.lockedAt.getTime()) : null,
      disabledAt: props.disabledAt ? new Date(props.disabledAt.getTime()) : null,
      deletedAt: props.deletedAt ? new Date(props.deletedAt.getTime()) : null,
    });
  }

  get id(): UserId {
    return this.props.id;
  }

  get publicId(): string | null {
    return this.props.publicId ? this.props.publicId.getValue() : null;
  }

  get publicIdVo(): PublicId | null {
    return this.props.publicId;
  }

  get subjectType(): UserSubjectType {
    return this.props.subjectType;
  }

  get email(): string | null {
    return this.props.email ? this.props.email.getRaw() : null;
  }

  get emailNormalized(): string | null {
    return this.props.email ? this.props.email.getNormalized() : null;
  }

  get emailVo(): Email | null {
    return this.props.email;
  }

  get emailVerifiedAt(): Date | null {
    return this.props.emailVerifiedAt ? new Date(this.props.emailVerifiedAt.getTime()) : null;
  }

  get emailChangedAt(): Date | null {
    return this.props.emailChangedAt ? new Date(this.props.emailChangedAt.getTime()) : null;
  }

  get status(): UserStatus {
    return this.props.status;
  }

  get statusChangedAt(): Date | null {
    return this.props.statusChangedAt ? new Date(this.props.statusChangedAt.getTime()) : null;
  }

  get lockedAt(): Date | null {
    return this.props.lockedAt ? new Date(this.props.lockedAt.getTime()) : null;
  }

  get disabledAt(): Date | null {
    return this.props.disabledAt ? new Date(this.props.disabledAt.getTime()) : null;
  }

  get deletedAt(): Date | null {
    return this.props.deletedAt ? new Date(this.props.deletedAt.getTime()) : null;
  }

  get createdAt(): Date {
    return new Date(this.props.createdAt.getTime());
  }

  get updatedAt(): Date {
    return new Date(this.props.updatedAt.getTime());
  }

  public isActive(): boolean {
    return this.props.status === 'active' && this.props.deletedAt === null;
  }

  public isDeleted(): boolean {
    return this.props.deletedAt !== null;
  }

  /**
   * Transiciona o status da conta governado pela UserStatusPolicy.
   */
  public changeStatus(
    newStatus: UserStatus,
    options: StatusTransitionOptions = {}
  ): Result<void, InvalidUserStatusTransitionError> {
    const transitionCheck = UserStatusPolicy.canTransition(this.props.status, newStatus, {
      ...options,
      isDeleted: this.props.deletedAt !== null,
    });
    if (transitionCheck.isErr()) {
      return transitionCheck;
    }

    const now = new Date();
    this.props.status = newStatus;
    this.props.statusChangedAt = now;
    this.props.updatedAt = now;

    if (newStatus === 'locked') {
      this.props.lockedAt = now;
    } else if (newStatus === 'disabled') {
      this.props.disabledAt = now;
    }

    return Result.ok();
  }

  /**
   * Atribui o PublicId à conta garantindo imutabilidade e unicidade de atribuição.
   */
  public assignPublicId(publicId: PublicId): Result<void, PublicIdAlreadyAssignedError> {
    if (this.props.publicId !== null) {
      return Result.err(
        new PublicIdAlreadyAssignedError(
          this.props.id as unknown as number,
          this.props.publicId.getValue()
        )
      );
    }

    this.props.publicId = publicId;
    this.props.updatedAt = new Date();
    return Result.ok();
  }

  /**
   * Atualiza o email principal da conta via Value Object.
   */
  public updateEmail(newEmail: Email): void {
    const now = new Date();
    this.props.email = newEmail;
    this.props.emailChangedAt = now;
    this.props.emailVerifiedAt = null; // Reinicia verificação
    this.props.updatedAt = now;
  }

  /**
   * Marca o email principal como verificado.
   */
  public markEmailVerified(): Result<void, InvalidEmailVerificationError> {
    if (this.props.email === null) {
      return Result.err(new InvalidEmailVerificationError());
    }
    const now = new Date();
    this.props.emailVerifiedAt = now;
    this.props.updatedAt = now;
    return Result.ok();
  }

  /**
   * Executa soft-delete na conta de forma idempotente e atualiza o estado para disabled.
   */
  public softDelete(): Result<void, AlreadyDeletedError> {
    if (this.props.deletedAt !== null) {
      return Result.err(new AlreadyDeletedError(this.props.id as unknown as number));
    }
    const now = new Date();
    this.props.deletedAt = now;
    this.props.status = 'disabled';
    this.props.disabledAt = now;
    this.props.statusChangedAt = now;
    this.props.updatedAt = now;
    return Result.ok();
  }
}
