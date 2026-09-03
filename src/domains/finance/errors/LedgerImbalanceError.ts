import { FinancialError } from './FinancialError';

export class LedgerImbalanceError extends FinancialError {
  constructor(
    message: string = 'A transação não está balanceada. A soma dos débitos deve ser exatamente igual à soma dos créditos.'
  ) {
    super(message, 'LEDGER_IMBALANCE', false, 422);
  }
}

