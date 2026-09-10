import { Result } from '../../../shared/kernel/Result';
import { UserStatus, USER_STATUSES } from '../types';
import {
  InvalidUserStatusError,
  InvalidUserStatusTransitionError,
} from '../errors/UserErrors';

export interface StatusTransitionOptions {
  isAdministrative?: boolean;
  isDeleted?: boolean;
}

export class UserStatusPolicy {
  public static isValidStatus(status: string): status is UserStatus {
    return (USER_STATUSES as readonly string[]).includes(status);
  }

  public static validateStatus(status: string): Result<UserStatus, InvalidUserStatusError> {
    if (!this.isValidStatus(status)) {
      return Result.err(new InvalidUserStatusError(status));
    }
    return Result.ok(status);
  }

  /**
   * Finite State Machine for Account Lifecycle:
   *
   * pending_setup ──► active | disabled
   * active        ──► suspended | locked | disabled
   * suspended     ──► active | disabled
   * locked        ──► active | disabled
   * disabled      ──► active (Requires explicit administrative override)
   */
  public static canTransition(
    currentStatus: UserStatus,
    targetStatus: UserStatus,
    options: StatusTransitionOptions = {}
  ): Result<void, InvalidUserStatusTransitionError> {
    if (currentStatus === targetStatus) {
      return Result.ok();
    }

    const { isAdministrative = false } = options;

    switch (currentStatus) {
      case 'pending_setup':
        if (targetStatus === 'active' || targetStatus === 'disabled') {
          return Result.ok();
        }
        return Result.err(
          new InvalidUserStatusTransitionError(
            currentStatus,
            targetStatus,
            'Contas em setup pendente só podem transicionar para "active" ou "disabled".'
          )
        );

      case 'active':
        if (
          targetStatus === 'suspended' ||
          targetStatus === 'locked' ||
          targetStatus === 'disabled'
        ) {
          return Result.ok();
        }
        return Result.err(
          new InvalidUserStatusTransitionError(
            currentStatus,
            targetStatus,
            'Contas ativas só podem ser suspensas, bloqueadas ou desativadas.'
          )
        );

      case 'suspended':
        if (targetStatus === 'active' || targetStatus === 'disabled') {
          return Result.ok();
        }
        return Result.err(
          new InvalidUserStatusTransitionError(
            currentStatus,
            targetStatus,
            'Contas suspensas só podem ser reativadas ou desativadas.'
          )
        );

      case 'locked':
        if (targetStatus === 'active' || targetStatus === 'disabled') {
          return Result.ok();
        }
        return Result.err(
          new InvalidUserStatusTransitionError(
            currentStatus,
            targetStatus,
            'Contas bloqueadas só podem ser desbloqueadas ("active") ou desativadas.'
          )
        );

      case 'disabled':
        if (targetStatus === 'active') {
          if (options.isDeleted) {
            return Result.err(
              new InvalidUserStatusTransitionError(
                currentStatus,
                targetStatus,
                'Contas excluídas (soft-deleted) estão em estado terminal definitivo e não podem ser reativadas.'
              )
            );
          }
          if (isAdministrative) {
            return Result.ok();
          }
          return Result.err(
            new InvalidUserStatusTransitionError(
              currentStatus,
              targetStatus,
              'Contas desativadas só podem ser reativadas mediante ação administrativa explícita.'
            )
          );
        }
        return Result.err(
          new InvalidUserStatusTransitionError(
            currentStatus,
            targetStatus,
            'Estado "disabled" é terminal para operações não-administrativas.'
          )
        );

      default:
        return Result.err(
          new InvalidUserStatusTransitionError(
            currentStatus,
            targetStatus,
            'Status de origem desconhecido.'
          )
        );
    }
  }
}
