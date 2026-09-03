export abstract class FinancialError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly retryable: boolean = false,
    public readonly httpStatus: number = 400
  ) {
    super(message);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class InsufficientBalanceError extends FinancialError {
  constructor(message: string = 'Saldo insuficiente para a operação financeira.') {
    super(message, 'INSUFFICIENT_BALANCE', false, 422);
  }
}

export class OptimisticConcurrencyError extends FinancialError {
  constructor(message: string = 'Conflito de concorrência otimista (OCC). Recarregue e tente novamente.') {
    super(message, 'OCC_CONFLICT', true, 409);
  }
}

export class IdempotencyConflictError extends FinancialError {
  constructor(message: string = 'Conflito de idempotência: Mesma chave fornecida com payload divergente.') {
    super(message, 'IDEMPOTENCY_HASH_MISMATCH', false, 409);
  }
}

export class IdempotencyInProgressError extends FinancialError {
  constructor(message: string = 'Transação em processamento com esta chave de idempotência.') {
    super(message, 'IDEMPOTENCY_IN_PROGRESS', true, 409);
  }
}

export class InvalidStateTransitionError extends FinancialError {
  constructor(message: string = 'Transição de estado inválida para a transação financeira.') {
    super(message, 'INVALID_STATE_TRANSITION', false, 422);
  }
}

export class ReversalAlreadyExistsError extends FinancialError {
  constructor(message: string = 'A transação já foi estornada anteriormente.') {
    super(message, 'REVERSAL_ALREADY_EXISTS', false, 409);
  }
}

export class ExternalEventPayloadConflictError extends FinancialError {
  constructor(message: string = 'Evento externo com mesmo providerId e externalEventId possui payload divergente.') {
    super(message, 'EXTERNAL_EVENT_PAYLOAD_CONFLICT', false, 409);
  }
}

export class AccountInactiveError extends FinancialError {
  constructor(message: string = 'Conta financeira inativa ou suspensa.') {
    super(message, 'ACCOUNT_INACTIVE', false, 422);
  }
}

export class AssetInactiveError extends FinancialError {
  constructor(message: string = 'Ativo financeiro inativo.') {
    super(message, 'ASSET_INACTIVE', false, 422);
  }
}

export class Money256OverflowError extends FinancialError {
  constructor(message: string = 'Valor excede o limite máximo permitido de 256 bits (2^256 - 1).') {
    super(message, 'MONEY_256_OVERFLOW', false, 400);
  }
}

export class InvalidMoneyFormatError extends FinancialError {
  constructor(message: string = 'Formato numérico inválido. Deve ser string decimal canônica sem expoente, sinal ou zeros à esquerda.') {
    super(message, 'INVALID_MONEY_FORMAT', false, 400);
  }
}

export class CurrencyMismatchError extends InvalidMoneyFormatError {
  constructor(message: string = 'Operação proibida entre ativos/moedas diferentes.') {
    super(message);
    (this as any).code = 'CURRENCY_MISMATCH';
  }
}

export class MoneyUnderflowError extends InvalidMoneyFormatError {
  constructor(message: string = 'Subtração resultando em saldo negativo é proibida (underflow).') {
    super(message);
    (this as any).code = 'MONEY_UNDERFLOW';
  }
}

export class InvalidIdentifierError extends InvalidMoneyFormatError {
  constructor(message: string = 'Identificador físico inválido.') {
    super(message);
    (this as any).code = 'INVALID_IDENTIFIER';
  }
}

export class InvalidRefundAmountError extends FinancialError {
  constructor(message: string = 'Valor de reembolso inválido ou excede o montante da transação original.') {
    super(message, 'INVALID_REFUND_AMOUNT', false, 422);
  }
}

export class UnsupportedFinancialOperationError extends FinancialError {
  constructor(message: string = 'Operação financeira não suportada.') {
    super(message, 'UNSUPPORTED_FINANCIAL_OPERATION', false, 400);
  }
}

export class InvalidFinancialOperationError extends FinancialError {
  constructor(message: string = 'Operação financeira inválida ou parâmetros inconsistentes.') {
    super(message, 'INVALID_FINANCIAL_OPERATION', false, 400);
  }
}

export class AccountOwnershipError extends FinancialError {
  constructor(message: string = 'Conflito de propriedade da conta ou transação financeira.') {
    super(message, 'ACCOUNT_OWNERSHIP_MISMATCH', false, 403);
  }
}

export class InvalidAccountClassError extends FinancialError {
  constructor(accountTypeOrMessage: string = 'Classe contábil inválida ou não suportada.', accountClass?: string) {
    const message = accountClass
      ? `Classe de conta "${accountClass}" é incompatível com o tipo de conta "${accountTypeOrMessage}".`
      : accountTypeOrMessage;
    super(message, 'INVALID_ACCOUNT_CLASS', false, 400);
  }
}

