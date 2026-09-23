/**
 * Catálogo canônico de status de ciclo de vida de transações financeiras.
 * Alinhado estritamente à persistência SQLite/Cloudflare D1 (lowercase string union).
 */
export const FINANCIAL_TRANSACTION_STATUSES = [
  'pending',
  'processing',
  'completed',
  'failed',
  'cancelled',
  'reversed',
  'refunded',
] as const;

export type FinancialTransactionStatus = (typeof FINANCIAL_TRANSACTION_STATUSES)[number];

export function isFinancialTransactionStatus(value: unknown): value is FinancialTransactionStatus {
  return (
    typeof value === 'string' &&
    FINANCIAL_TRANSACTION_STATUSES.includes(value as FinancialTransactionStatus)
  );
}

/**
 * Constantes semânticas para uso opcional mantendo a representação física idêntica.
 */
export const FinancialTransactionStatusConstant = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  REVERSED: 'reversed',
  REFUNDED: 'refunded',
} as const;
