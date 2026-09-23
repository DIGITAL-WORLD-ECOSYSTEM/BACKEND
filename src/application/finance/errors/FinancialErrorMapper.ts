import { FinancialError } from '../../../domains/finance/errors/FinancialError';

/**
 * Type guard para objetos com código de erro estruturado.
 */
function hasErrorCode(err: unknown): err is { code: string } {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    typeof (err as { code: unknown }).code === 'string'
  );
}

/**
 * [F9] Application Error Mapper:
 * Responsável exclusivo por traduzir erros do Domínio Financeiro Puro
 * em códigos de status do protocolo de transporte HTTP.
 *
 * ARQUITETURA PURA:
 * O Domínio Puro não possui nem acopla conceitos de rede web ou códigos HTTP.
 * O mapper inspeciona exclusivamente o código canônico de domínio (FinancialError.code),
 * garantindo mapeamento determinístico sem confiar em propriedades httpStatus externas.
 */
export function mapFinancialErrorToHttpStatus(error: unknown): number {
  const code: string | undefined = error instanceof FinancialError
    ? error.code
    : hasErrorCode(error)
      ? error.code
      : undefined;

  switch (code) {
    case 'ACCOUNT_OWNERSHIP_MISMATCH':
      return 403;
    case 'INSUFFICIENT_BALANCE':
    case 'MONEY_256_OVERFLOW':
    case 'MONEY_UNDERFLOW':
    case 'LEDGER_IMBALANCE':
    case 'INVALID_STATE_TRANSITION':
    case 'NON_ZERO_BALANCE':
    case 'CURRENCY_MISMATCH':
    case 'INVALID_ACCOUNT_CLASS':
    case 'ACCOUNT_INACTIVE':
    case 'ASSET_INACTIVE':
    case 'FINANCIAL_ARITHMETIC_ERROR':
    case 'INVALID_LEDGER_TRANSACTION':
    case 'ACCOUNTING_MATRIX_VALIDATION_FAILED':
    case 'INVALID_REFUND_AMOUNT':
      return 422;
    case 'OPTIMISTIC_CONCURRENCY_LOCK':
    case 'OCC_CONFLICT':
    case 'EXTERNAL_EVENT_PAYLOAD_CONFLICT':
    case 'IDEMPOTENCY_CONFLICT':
    case 'IDEMPOTENCY_HASH_MISMATCH':
    case 'IDEMPOTENCY_IN_PROGRESS':
    case 'REVERSAL_ALREADY_EXISTS':
      return 409;
    case 'ACCOUNT_NOT_FOUND':
    case 'ASSET_NOT_FOUND':
      return 404;
    case 'INVALID_MONEY_FORMAT':
    case 'INVALID_IDENTIFIER':
    case 'FINANCIAL_VALIDATION_ERROR':
    case 'FINANCIAL_RANGE_ERROR':
    case 'UNSUPPORTED_FINANCIAL_OPERATION':
    case 'INVALID_FINANCIAL_OPERATION':
    default:
      return 400;
  }
}
