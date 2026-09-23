import { InvalidLedgerTransactionError } from './FinancialError';

/**
 * Erro disparado quando uma transação contábil viola o princípio fundamental
 * das partidas dobradas (ΣDébitos !== ΣCréditos para um ou mais ativos).
 */
export class LedgerImbalanceError extends InvalidLedgerTransactionError {
  constructor(
    message: string = 'Double-entry imbalance: Total debits must equal total credits per asset.',
    details?: Record<string, unknown>
  ) {
    super(message, 'LEDGER_IMBALANCE', false, details);
  }
}
