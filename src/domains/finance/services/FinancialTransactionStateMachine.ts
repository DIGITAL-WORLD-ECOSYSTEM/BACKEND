import { Result } from '../../../shared/kernel/Result';
import {
  type FinancialTransactionStatus,
  FINANCIAL_TRANSACTION_STATUSES,
  isFinancialTransactionStatus,
} from '../value-objects/FinancialTransactionStatus';
import { InvalidStateTransitionError } from '../errors/FinancialError';

export {
  type FinancialTransactionStatus,
  FINANCIAL_TRANSACTION_STATUSES,
  isFinancialTransactionStatus,
};

/**
 * Classificação formal e tipada do resultado de uma avaliação de transição.
 * Permite que orquestradores e casos de uso da Fase 2 diferenciem explicitamente
 * operações estéreis (NO_OP) de mutações reais (CHANGED) e falhas (INVALID).
 */
export type TransitionKind = 'NO_OP' | 'CHANGED' | 'INVALID';

export type TransitionResult =
  | {
      readonly kind: 'CHANGED';
      readonly status: FinancialTransactionStatus;
    }
  | {
      readonly kind: 'NO_OP';
      readonly status: FinancialTransactionStatus;
    }
  | {
      readonly kind: 'INVALID';
      readonly error: string;
    };

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
 * REGRAS FINANCEIRAS CRÍTICAS:
 * 1. 'processing -> cancelled' É ESTRITAMENTE PROIBIDO. O cancelamento só pode ocorrer em 'pending'.
 * 2. Estados terminais ('failed', 'cancelled', 'reversed', 'refunded') NÃO admitem nenhuma transição (inclusive auto-transição).
 * 3. 'completed -> completed' é rejeitado como reposting proibido.
 * 4. Apenas 'pending -> pending' e 'processing -> processing' são admitidos como NO_OP seguro (sem side effects nem outbox).
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
   * Avalia a transição retornando um contrato tipado TransitionResult (NO_OP / CHANGED / INVALID).
   * O chamador (Fase 2) pode verificar if (res.kind === 'CHANGED') para disparar eventos/outbox,
   * e if (res.kind === 'NO_OP') para garantir zero efeitos colaterais.
   */
  static evaluateTransition(
    currentStatus: FinancialTransactionStatus,
    targetStatus: FinancialTransactionStatus
  ): TransitionResult {
    const res = this.transition(currentStatus, targetStatus);
    if (res.isFailure) {
      return Object.freeze({
        kind: 'INVALID',
        error: res.error || 'Transição de estado inválida.',
      });
    }

    if (currentStatus === targetStatus) {
      return Object.freeze({
        kind: 'NO_OP',
        status: currentStatus,
      });
    }

    return Object.freeze({
      kind: 'CHANGED',
      status: targetStatus,
    });
  }

  /**
   * Executa e valida a transição de estado da transação financeira.
   *
   * Retorna:
   *   Result.ok(targetStatus) se a transição for permitida ou for no-op seguro (pending/processing).
   *   Result.fail(mensagem) se o status for inválido, se tentar transicionar de estado terminal,
   *   ou se a transição for proibida pela matriz contábil.
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

    // Estados estritamente terminais rejeitam qualquer transição de saída ou reexecução
    if (FinancialTransactionStateMachine.isTerminal(currentStatus)) {
      return Result.fail(
        `Transição de estado inválida: '${currentStatus}' -> '${targetStatus}'. O status '${currentStatus}' é terminal e não admite novas transições.`
      );
    }

    // Transação completada não admite reexecução / reposting para si mesma
    if (currentStatus === 'completed' && targetStatus === 'completed') {
      return Result.fail(
        "Transição de estado inválida: a transação já foi finalizada ('completed') e não admite reexecução."
      );
    }

    // No-op idempotente seguro exclusivamente para estados com continuidade em andamento (sem side-effects)
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
   * Afirma transição válida ou dispara InvalidStateTransitionError com contexto estéril.
   */
  static assertTransition(
    currentStatus: FinancialTransactionStatus,
    targetStatus: FinancialTransactionStatus,
    context?: Record<string, unknown>
  ): void {
    const res = this.transition(currentStatus, targetStatus);
    if (res.isFailure) {
      throw new InvalidStateTransitionError(
        res.error || 'Transição de estado inválida para a transação financeira.',
        {
          currentStatus,
          targetStatus,
          ...context,
        }
      );
    }
  }

  /**
   * Verifica se o status fornecido é terminal (não admite mais transições de saída).
   */
  static isTerminal(status: FinancialTransactionStatus): boolean {
    if (!isFinancialTransactionStatus(status)) {
      return false;
    }
    return ALLOWED_TRANSITIONS[status].length === 0;
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
