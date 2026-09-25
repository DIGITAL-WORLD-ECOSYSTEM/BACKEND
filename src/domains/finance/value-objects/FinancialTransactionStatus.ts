/**
 * Catálogo canônico dos estados de ciclo de vida
 * de uma transação financeira no domínio.
 *
 * Fonte única semântica da verdade para todos os tipos e coleções.
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
 * Coleção enumerada imutável em runtime para verificações e type guards.
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
