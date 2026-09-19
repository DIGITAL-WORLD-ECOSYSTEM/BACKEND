import { Result } from '../../../shared/kernel/Result';

/**
 * ============================================================
 * FINANCIAL TRANSACTION STATUS
 * ============================================================
 *
 * Representa exclusivamente o lifecycle de negócio da transação.
 *
 * IMPORTANTE:
 * FinancialTransactionStatus NÃO representa:
 * - posting state (not_posted vs posted);
 * - idempotency state (processing vs completed);
 * - OCC state (versioning de saldo);
 * - settlement state;
 * - estado de outbox.
 *
 * Esses conceitos pertencem às respectivas camadas/policies de infraestrutura e liquidação.
 */
export type FinancialTransactionStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'reversed'
  | 'refunded';

const FINANCIAL_TRANSACTION_STATUSES = Object.freeze([
  'pending',
  'processing',
  'completed',
  'failed',
  'cancelled',
  'reversed',
  'refunded',
] as const);

function isFinancialTransactionStatus(
  value: unknown
): value is FinancialTransactionStatus {
  return (
    typeof value === 'string' &&
    FINANCIAL_TRANSACTION_STATUSES.includes(
      value as FinancialTransactionStatus
    )
  );
}

/**
 * ============================================================
 * STATE TRANSITION MATRIX (CANÔNICA E IMUTÁVEL)
 * ============================================================
 *
 * pending:    -> processing | failed | cancelled
 * processing: -> completed  | failed
 * completed:  -> reversed   | refunded
 * failed:     -> terminal (nenhuma)
 * cancelled:  -> terminal (nenhuma)
 * reversed:   -> terminal (nenhuma)
 * refunded:   -> terminal (nenhuma)
 *
 * REGRA FINANCEIRA CRÍTICA:
 * 'processing -> cancelled' É ESTRITAMENTE PROIBIDO.
 * O cancelamento só pode ocorrer enquanto a transação estiver em 'pending'.
 */
const ALLOWED_TRANSITIONS: Readonly<
  Record<
    FinancialTransactionStatus,
    readonly FinancialTransactionStatus[]
  >
> = Object.freeze({
  pending: Object.freeze(['processing', 'failed', 'cancelled'] as const),
  processing: Object.freeze(['completed', 'failed'] as const),
  completed: Object.freeze(['reversed', 'refunded'] as const),
  failed: Object.freeze([] as const),
  cancelled: Object.freeze([] as const),
  reversed: Object.freeze([] as const),
  refunded: Object.freeze([] as const),
});

export class FinancialTransactionStateMachine {
  /**
   * Executa e valida a transição de estado da transação financeira.
   *
   * Retorna:
   *   Result.ok(targetStatus) se a transição for permitida ou for no-op idempotente.
   *   Result.fail(mensagem) se o status for inválido ou a transição for proibida.
   */
  static transition(
    currentStatus: FinancialTransactionStatus,
    targetStatus: FinancialTransactionStatus
  ): Result<FinancialTransactionStatus> {
    if (!isFinancialTransactionStatus(currentStatus)) {
      return Result.fail('Status de transação financeira atual inválido.');
    }

    if (!isFinancialTransactionStatus(targetStatus)) {
      return Result.fail('Status de transação financeira de destino inválido.');
    }

    // No-op idempotente: transição para o mesmo estado é segura e permitida
    if (currentStatus === targetStatus) {
      return Result.ok(targetStatus);
    }

    const allowedTransitions = ALLOWED_TRANSITIONS[currentStatus];

    if (!allowedTransitions.includes(targetStatus)) {
      return Result.fail(
        `Transição de estado inválida: '${currentStatus}' -> '${targetStatus}'. Transições permitidas a partir de '${currentStatus}': [${allowedTransitions.join(', ')}].`
      );
    }

    return Result.ok(targetStatus);
  }

  /**
   * Helper booleano de conveniência para verificar se a transição é autorizada.
   */
  static canTransition(
    currentStatus: FinancialTransactionStatus,
    targetStatus: FinancialTransactionStatus
  ): boolean {
    return this.transition(currentStatus, targetStatus).isSuccess;
  }

  /**
   * Verifica se o status fornecido é terminal (não admite mais transições de saída).
   */
  static isTerminal(status: FinancialTransactionStatus): boolean {
    if (!isFinancialTransactionStatus(status)) {
      return false;
    }
    return status === 'failed' || status === 'cancelled' || status === 'reversed';
  }

  /**
   * Type-guard para validação de input externo.
   */
  static isValidStatus(status: unknown): status is FinancialTransactionStatus {
    return isFinancialTransactionStatus(status);
  }

  /**
   * Retorna uma lista imutável das transições permitidas a partir do status informado.
   */
  static getAllowedTransitions(
    status: FinancialTransactionStatus
  ): readonly FinancialTransactionStatus[] {
    if (!isFinancialTransactionStatus(status)) {
      return Object.freeze([]);
    }
    return ALLOWED_TRANSITIONS[status];
  }
}
