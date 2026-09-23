/**
 * Hierarquia canônica de erros do domínio financeiro.
 *
 * PROPRIEDADES ARQUITETURAIS:
 * - O domínio puro NÃO gera timestamps de wall clock (preserva determinismo de testes e replay).
 * - O domínio puro NÃO serializa detalhes internos (details) diretamente para HTTP/JSON (prevenindo vazamento de PII/credenciais).
 * - Os detalhes internos (details) são sanitizados profundamente contra retenção de referências mutáveis.
 * - [F9] O domínio puro NÃO contém conceitos de transporte web (como httpStatus). O mapeamento HTTP é
 *   responsabilidade exclusiva da camada Application (src/application/finance/errors/FinancialErrorMapper.ts).
 */
function sanitizeErrorDetails(
  raw?: Record<string, unknown>
): Readonly<Record<string, unknown>> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined;
  }
  const sanitized: Record<string, unknown> = Object.create(null);
  for (const [key, val] of Object.entries(raw)) {
    if (val === null || val === undefined) {
      sanitized[key] = val;
    } else if (
      typeof val === 'string' ||
      typeof val === 'number' ||
      typeof val === 'boolean'
    ) {
      sanitized[key] = val;
    } else if (typeof val === 'bigint') {
      sanitized[key] = val.toString(10);
    } else {
      // Isola referências e objetos complexos sem executar getters ou toString() arbitrários
      sanitized[key] = '[non-serializable]';
    }
  }
  return Object.freeze(sanitized);
}

export abstract class FinancialError extends Error {
  public readonly details?: Readonly<Record<string, unknown>>;

  constructor(
    message: string,
    public readonly code: string,
    public readonly retryable: boolean = false,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = this.constructor.name;
    this.details = sanitizeErrorDetails(details);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class InsufficientBalanceError extends FinancialError {
  constructor(message: string = 'Saldo insuficiente para a operação financeira.', details?: Record<string, unknown>) {
    super(message, 'INSUFFICIENT_BALANCE', false, details);
  }
}

export class OptimisticConcurrencyError extends FinancialError {
  constructor(message: string = 'Conflito de concorrência otimista (OCC). Recarregue e tente novamente.', details?: Record<string, unknown>) {
    super(message, 'OCC_CONFLICT', true, details);
  }
}

export class IdempotencyConflictError extends FinancialError {
  constructor(message: string = 'Conflito de idempotência: Mesma chave fornecida com payload divergente.', details?: Record<string, unknown>) {
    super(message, 'IDEMPOTENCY_HASH_MISMATCH', false, details);
  }
}

export class IdempotencyInProgressError extends FinancialError {
  constructor(message: string = 'Transação em processamento com esta chave de idempotência.', details?: Record<string, unknown>) {
    super(message, 'IDEMPOTENCY_IN_PROGRESS', true, details);
  }
}

export class InvalidStateTransitionError extends FinancialError {
  constructor(
    message: string = 'Transição de estado inválida para a transação financeira.',
    details?: Record<string, unknown>
  ) {
    super(message, 'INVALID_STATE_TRANSITION', false, details);
  }
}

export class ReversalAlreadyExistsError extends FinancialError {
  constructor(message: string = 'A transação já foi estornada anteriormente.', details?: Record<string, unknown>) {
    super(message, 'REVERSAL_ALREADY_EXISTS', false, details);
  }
}

export class ExternalEventPayloadConflictError extends FinancialError {
  constructor(message: string = 'Evento externo com mesmo providerId e externalEventId possui payload divergente.', details?: Record<string, unknown>) {
    super(message, 'EXTERNAL_EVENT_PAYLOAD_CONFLICT', false, details);
  }
}

export class AccountInactiveError extends FinancialError {
  constructor(message: string = 'Conta financeira inativa ou suspensa.', details?: Record<string, unknown>) {
    super(message, 'ACCOUNT_INACTIVE', false, details);
  }
}

export class AssetInactiveError extends FinancialError {
  constructor(message: string = 'Ativo financeiro inativo.', details?: Record<string, unknown>) {
    super(message, 'ASSET_INACTIVE', false, details);
  }
}

export class Money256OverflowError extends FinancialError {
  constructor(message: string = 'Valor excede o limite máximo permitido de 256 bits (2^256 - 1).', details?: Record<string, unknown>) {
    super(message, 'MONEY_256_OVERFLOW', false, details);
  }
}

export class FinancialValidationError extends FinancialError {
  constructor(
    message: string = 'Dados fornecidos violam validação de domínio financeiro.',
    code: string = 'FINANCIAL_VALIDATION_ERROR',
    retryable: boolean = false,
    details?: Record<string, unknown>
  ) {
    super(message, code, retryable, details);
  }
}

export class InvalidMoneyFormatError extends FinancialValidationError {
  constructor(
    message: string = 'Formato numérico inválido. Deve ser string decimal canônica sem expoente, sinal ou zeros à esquerda.',
    details?: Record<string, unknown>
  ) {
    super(message, 'INVALID_MONEY_FORMAT', false, details);
  }
}

export class CurrencyMismatchError extends FinancialError {
  constructor(message: string = 'Operação proibida entre ativos/moedas diferentes.', details?: Record<string, unknown>) {
    super(message, 'CURRENCY_MISMATCH', false, details);
  }
}

export class MoneyUnderflowError extends FinancialError {
  constructor(message: string = 'Subtração resultando em saldo negativo é proibida (underflow).', details?: Record<string, unknown>) {
    super(message, 'MONEY_UNDERFLOW', false, details);
  }
}

export class InvalidIdentifierError extends FinancialError {
  constructor(message: string = 'Identificador físico inválido.', details?: Record<string, unknown>) {
    super(message, 'INVALID_IDENTIFIER', false, details);
  }
}

export class InvalidRefundAmountError extends FinancialError {
  constructor(message: string = 'Valor de reembolso inválido ou excede o montante da transação original.', details?: Record<string, unknown>) {
    super(message, 'INVALID_REFUND_AMOUNT', false, details);
  }
}

export class UnsupportedFinancialOperationError extends FinancialError {
  constructor(message: string = 'Operação financeira não suportada.', details?: Record<string, unknown>) {
    super(message, 'UNSUPPORTED_FINANCIAL_OPERATION', false, details);
  }
}

export class InvalidFinancialOperationError extends FinancialError {
  constructor(message: string = 'Operação financeira inválida ou parâmetros inconsistentes.', details?: Record<string, unknown>) {
    super(message, 'INVALID_FINANCIAL_OPERATION', false, details);
  }
}

export class AccountOwnershipError extends FinancialError {
  constructor(message: string = 'Conflito de propriedade da conta ou transação financeira.', details?: Record<string, unknown>) {
    super(message, 'ACCOUNT_OWNERSHIP_MISMATCH', false, details);
  }
}

export class InvalidAccountClassError extends FinancialError {
  constructor(accountTypeOrMessage: string = 'Classe contábil inválida ou não suportada.', accountClass?: string, details?: Record<string, unknown>) {
    const message = accountClass
      ? `Classe de conta "${accountClass}" é incompatível com o tipo de conta "${accountTypeOrMessage}".`
      : accountTypeOrMessage;
    super(message, 'INVALID_ACCOUNT_CLASS', false, details);
  }
}

export class InvalidLedgerTransactionError extends FinancialError {
  constructor(
    message: string = 'Transação contábil do ledger inválida ou viola os invariantes de partidas dobradas.',
    code: string = 'INVALID_LEDGER_TRANSACTION',
    retryable: boolean = false,
    details?: Record<string, unknown>
  ) {
    super(message, code, retryable, details);
  }
}

/**
 * Aliases de retrocompatibilidade para classes e nomes alternativos
 */

export class FinancialArithmeticError extends FinancialError {
  constructor(message: string = 'Erro aritmético financeiro.', details?: Record<string, unknown>) {
    super(message, 'FINANCIAL_ARITHMETIC_ERROR', false, details);
  }
}

export class FinancialRangeError extends FinancialError {
  constructor(message: string = 'Valor fora do intervalo financeiro permitido.', details?: Record<string, unknown>) {
    super(message, 'FINANCIAL_RANGE_ERROR', false, details);
  }
}

export class FinancialInvalidStateTransitionError extends InvalidStateTransitionError {}
export class FinancialIdempotencyConflictError extends IdempotencyConflictError {}
export class FinancialInsufficientFundsError extends InsufficientBalanceError {}

export class AtomicPostingExecutionError extends FinancialError {
  constructor(
    message: string = 'Falha na execução atômica do lote contábil.',
    code: string = 'ATOMIC_POSTING_EXECUTION_ERROR',
    retryable: boolean = false,
    details?: Record<string, unknown>
  ) {
    super(message, code, retryable, details);
  }
}

