/**
 * Catálogo canônico dos estados de ciclo de vida
 * de uma transação financeira.
 *
 * A definição pertence exclusivamente ao domínio financeiro.
 */
export const FinancialTransactionStatusConstant = Object.freeze({
  PENDING: 'pending',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  REVERSED: 'reversed',
  REFUNDED: 'refunded',
} as const);

export type FinancialTransactionStatus =
  (typeof FinancialTransactionStatusConstant)[keyof typeof FinancialTransactionStatusConstant];

/**
 * Catálogo runtime imutável utilizado pelos parsers e type guards.
 *
 * Todos os valores são derivados da única fonte semântica
 * FinancialTransactionStatusConstant.
 */
export const FINANCIAL_TRANSACTION_STATUSES = Object.freeze([
  FinancialTransactionStatusConstant.PENDING,
  FinancialTransactionStatusConstant.PROCESSING,
  FinancialTransactionStatusConstant.COMPLETED,
  FinancialTransactionStatusConstant.FAILED,
  FinancialTransactionStatusConstant.CANCELLED,
  FinancialTransactionStatusConstant.REVERSED,
  FinancialTransactionStatusConstant.REFUNDED,
] as const);

/**
 * Type guard de runtime para status de transação financeira.
 */
export function isFinancialTransactionStatus(
  value: unknown
): value is FinancialTransactionStatus {
  return (
    typeof value === 'string' &&
    FINANCIAL_TRANSACTION_STATUSES.includes(
      value as FinancialTransactionStatus
    )
  );
}

