import { Result } from '../../../shared/kernel/Result';

export type FinancialTransactionStatus = 
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'reversed';

export class FinancialTransactionStateMachine {
  private static readonly ALLOWED_TRANSITIONS: Record<FinancialTransactionStatus, FinancialTransactionStatus[]> = {
    pending: ['processing', 'failed', 'cancelled'],
    processing: ['completed', 'failed', 'cancelled'],
    completed: ['reversed'],
    failed: [],
    cancelled: [],
    reversed: [],
  };

  /**
   * Valida se uma transição de estado da transação financeira é permitida pela máquina de estados (DOD-12).
   */
  static transition(
    currentStatus: FinancialTransactionStatus,
    targetStatus: FinancialTransactionStatus
  ): Result<FinancialTransactionStatus> {
    if (currentStatus === targetStatus) {
      return Result.ok(targetStatus);
    }

    const allowed = this.ALLOWED_TRANSITIONS[currentStatus] || [];
    if (!allowed.includes(targetStatus)) {
      return Result.fail(
        `Transição de estado inválida: '${currentStatus}' -> '${targetStatus}'. Transições permitidas a partir de '${currentStatus}': [${allowed.join(', ')}].`
      );
    }

    return Result.ok(targetStatus);
  }

  static canTransition(
    currentStatus: FinancialTransactionStatus,
    targetStatus: FinancialTransactionStatus
  ): boolean {
    return this.transition(currentStatus, targetStatus).isSuccess;
  }
}
