import { Money256 } from '../value-objects/Money256';
import { FinancialError } from '../errors/FinancialError';

export interface RawLedgerEntrySpec {
  accountId: number;
  assetId: number;
  entryType: 'debit' | 'credit';
  amount: Money256;
  description: string;
}

export interface AccountingContext {
  transactionType: string;
  category?: string;
  source?: string;
  destination?: string;
  assetId: number;
  feeType?: string;
  businessReason?: string;
}

export class AccountingMatrixValidationError extends FinancialError {
  constructor(message: string) {
    super(message, 'ACCOUNTING_MATRIX_VALIDATION_FAILED', false, 422);
  }
}

export class AccountingEntryPolicy {
  /**
   * 1. DEPOSIT: Dr Treasury Asset (+Ativo) / Cr User Available (+Passivo)
   */
  public static createDepositEntries(params: {
    treasuryAccountId: number;
    userAccountId: number;
    amount: Money256;
    description: string;
  }): RawLedgerEntrySpec[] {
    AccountingEntryPolicy.assertPositiveAmount(params.amount);
    const entries: RawLedgerEntrySpec[] = [
      {
        accountId: params.treasuryAccountId,
        assetId: params.amount.assetId,
        entryType: 'debit',
        amount: params.amount,
        description: `Deposit Treasury Debit: ${params.description}`,
      },
      {
        accountId: params.userAccountId,
        assetId: params.amount.assetId,
        entryType: 'credit',
        amount: params.amount,
        description: `Deposit User Credit: ${params.description}`,
      },
    ];
    AccountingEntryPolicy.validateEntriesBalance(entries);
    return entries;
  }

  /**
   * 2. WITHDRAWAL: Dr User Available (-Passivo) / Cr Treasury Asset (-Ativo)
   */
  public static createWithdrawalEntries(params: {
    treasuryAccountId: number;
    userAccountId: number;
    amount: Money256;
    description: string;
  }): RawLedgerEntrySpec[] {
    AccountingEntryPolicy.assertPositiveAmount(params.amount);
    const entries: RawLedgerEntrySpec[] = [
      {
        accountId: params.userAccountId,
        assetId: params.amount.assetId,
        entryType: 'debit',
        amount: params.amount,
        description: `Withdrawal User Debit: ${params.description}`,
      },
      {
        accountId: params.treasuryAccountId,
        assetId: params.amount.assetId,
        entryType: 'credit',
        amount: params.amount,
        description: `Withdrawal Treasury Credit: ${params.description}`,
      },
    ];
    AccountingEntryPolicy.validateEntriesBalance(entries);
    return entries;
  }

  /**
   * 3. TRANSFER: Dr Source User (-Passivo) / Cr Target User (+Passivo)
   */
  public static createTransferEntries(params: {
    sourceAccountId: number;
    destinationAccountId: number;
    amount: Money256;
    description: string;
  }): RawLedgerEntrySpec[] {
    AccountingEntryPolicy.assertPositiveAmount(params.amount);
    if (params.sourceAccountId === params.destinationAccountId) {
      throw new AccountingMatrixValidationError('Conta de origem e destino não podem ser idênticas em uma transferência.');
    }
    const entries: RawLedgerEntrySpec[] = [
      {
        accountId: params.sourceAccountId,
        assetId: params.amount.assetId,
        entryType: 'debit',
        amount: params.amount,
        description: `Transfer Debit: ${params.description}`,
      },
      {
        accountId: params.destinationAccountId,
        assetId: params.amount.assetId,
        entryType: 'credit',
        amount: params.amount,
        description: `Transfer Credit: ${params.description}`,
      },
    ];
    AccountingEntryPolicy.validateEntriesBalance(entries);
    return entries;
  }

  /**
   * 4. PAYMENT: Dr User Available (-Passivo) / Cr Payment Revenue (+Receita/Passivo Payee)
   */
  public static createPaymentEntries(params: {
    userAccountId: number;
    paymentRevenueAccountId: number;
    amount: Money256;
    description: string;
  }): RawLedgerEntrySpec[] {
    AccountingEntryPolicy.assertPositiveAmount(params.amount);
    const entries: RawLedgerEntrySpec[] = [
      {
        accountId: params.userAccountId,
        assetId: params.amount.assetId,
        entryType: 'debit',
        amount: params.amount,
        description: `Payment User Debit: ${params.description}`,
      },
      {
        accountId: params.paymentRevenueAccountId,
        assetId: params.amount.assetId,
        entryType: 'credit',
        amount: params.amount,
        description: `Payment Revenue Credit: ${params.description}`,
      },
    ];
    AccountingEntryPolicy.validateEntriesBalance(entries);
    return entries;
  }

  /**
   * 5. REFUND: Dr Refund Expense (+Despesa) / Cr User Available (+Passivo)
   */
  public static createRefundEntries(params: {
    refundExpenseAccountId: number;
    userAccountId: number;
    amount: Money256;
    description: string;
  }): RawLedgerEntrySpec[] {
    AccountingEntryPolicy.assertPositiveAmount(params.amount);
    const entries: RawLedgerEntrySpec[] = [
      {
        accountId: params.refundExpenseAccountId,
        assetId: params.amount.assetId,
        entryType: 'debit',
        amount: params.amount,
        description: `Refund Expense Debit: ${params.description}`,
      },
      {
        accountId: params.userAccountId,
        assetId: params.amount.assetId,
        entryType: 'credit',
        amount: params.amount,
        description: `Refund User Credit: ${params.description}`,
      },
    ];
    AccountingEntryPolicy.validateEntriesBalance(entries);
    return entries;
  }

  /**
   * 6. FEE: Dr User Available (-Passivo) / Cr Fees Revenue (+Receita)
   */
  public static createFeeEntries(params: {
    userAccountId: number;
    feeAccountId: number;
    amount: Money256;
    description: string;
  }): RawLedgerEntrySpec[] {
    AccountingEntryPolicy.assertPositiveAmount(params.amount);
    const entries: RawLedgerEntrySpec[] = [
      {
        accountId: params.userAccountId,
        assetId: params.amount.assetId,
        entryType: 'debit',
        amount: params.amount,
        description: `Fee User Debit: ${params.description}`,
      },
      {
        accountId: params.feeAccountId,
        assetId: params.amount.assetId,
        entryType: 'credit',
        amount: params.amount,
        description: `Fee Revenue Credit: ${params.description}`,
      },
    ];
    AccountingEntryPolicy.validateEntriesBalance(entries);
    return entries;
  }

  /**
   * 7. REWARD: Dr Reward Expense (+Despesa) / Cr User Available (+Passivo)
   */
  public static createRewardEntries(params: {
    rewardExpenseAccountId: number;
    userAccountId: number;
    amount: Money256;
    description: string;
  }): RawLedgerEntrySpec[] {
    AccountingEntryPolicy.assertPositiveAmount(params.amount);
    const entries: RawLedgerEntrySpec[] = [
      {
        accountId: params.rewardExpenseAccountId,
        assetId: params.amount.assetId,
        entryType: 'debit',
        amount: params.amount,
        description: `Reward Expense Debit: ${params.description}`,
      },
      {
        accountId: params.userAccountId,
        assetId: params.amount.assetId,
        entryType: 'credit',
        amount: params.amount,
        description: `Reward User Credit: ${params.description}`,
      },
    ];
    AccountingEntryPolicy.validateEntriesBalance(entries);
    return entries;
  }

  /**
   * 8. YIELD: Dr Yield Expense (+Despesa) / Cr User Available (+Passivo)
   */
  public static createYieldEntries(params: {
    yieldExpenseAccountId: number;
    userAccountId: number;
    amount: Money256;
    description: string;
  }): RawLedgerEntrySpec[] {
    AccountingEntryPolicy.assertPositiveAmount(params.amount);
    const entries: RawLedgerEntrySpec[] = [
      {
        accountId: params.yieldExpenseAccountId,
        assetId: params.amount.assetId,
        entryType: 'debit',
        amount: params.amount,
        description: `Yield Expense Debit: ${params.description}`,
      },
      {
        accountId: params.userAccountId,
        assetId: params.amount.assetId,
        entryType: 'credit',
        amount: params.amount,
        description: `Yield User Credit: ${params.description}`,
      },
    ];
    AccountingEntryPolicy.validateEntriesBalance(entries);
    return entries;
  }

  /**
   * 9. CONVERSION: FX Clearing Account preservando o balanço por ativo
   * FromAsset: Dr User / Cr Clearing
   * ToAsset: Dr Clearing / Cr User
   */
  public static createConversionEntries(params: {
    userAccountId: number;
    clearingAccountId: number;
    fromAmount: Money256;
    toAmount: Money256;
    description: string;
  }): RawLedgerEntrySpec[] {
    AccountingEntryPolicy.assertPositiveAmount(params.fromAmount);
    AccountingEntryPolicy.assertPositiveAmount(params.toAmount);
    if (params.fromAmount.assetId === params.toAmount.assetId) {
      throw new AccountingMatrixValidationError('Conversão exige ativos distintos.');
    }

    const entries: RawLedgerEntrySpec[] = [
      // Leg 1: FromAsset
      {
        accountId: params.userAccountId,
        assetId: params.fromAmount.assetId,
        entryType: 'debit',
        amount: params.fromAmount,
        description: `Conversion Debit FromAsset: ${params.description}`,
      },
      {
        accountId: params.clearingAccountId,
        assetId: params.fromAmount.assetId,
        entryType: 'credit',
        amount: params.fromAmount,
        description: `Conversion Clearing Credit FromAsset: ${params.description}`,
      },
      // Leg 2: ToAsset
      {
        accountId: params.clearingAccountId,
        assetId: params.toAmount.assetId,
        entryType: 'debit',
        amount: params.toAmount,
        description: `Conversion Clearing Debit ToAsset: ${params.description}`,
      },
      {
        accountId: params.userAccountId,
        assetId: params.toAmount.assetId,
        entryType: 'credit',
        amount: params.toAmount,
        description: `Conversion Credit ToAsset: ${params.description}`,
      },
    ];

    AccountingEntryPolicy.validateEntriesBalance(entries);
    return entries;
  }

  /**
   * 10. ADJUSTMENT: Lançamento de ajuste com autorização
   */
  public static createAdjustmentEntries(params: {
    debitAccountId: number;
    creditAccountId: number;
    amount: Money256;
    reason: string;
  }): RawLedgerEntrySpec[] {
    AccountingEntryPolicy.assertPositiveAmount(params.amount);
    if (!params.reason) {
      throw new AccountingMatrixValidationError('Lançamento de ajuste exige justificativa auditável.');
    }
    const entries: RawLedgerEntrySpec[] = [
      {
        accountId: params.debitAccountId,
        assetId: params.amount.assetId,
        entryType: 'debit',
        amount: params.amount,
        description: `Adjustment Debit (${params.reason})`,
      },
      {
        accountId: params.creditAccountId,
        assetId: params.amount.assetId,
        entryType: 'credit',
        amount: params.amount,
        description: `Adjustment Credit (${params.reason})`,
      },
    ];
    AccountingEntryPolicy.validateEntriesBalance(entries);
    return entries;
  }

  /**
   * 11. REVERSAL: Inversão exata dos lançamentos da transação original
   */
  public static createReversalEntries(originalEntries: RawLedgerEntrySpec[], reason: string): RawLedgerEntrySpec[] {
    if (!originalEntries || originalEntries.length === 0) {
      throw new AccountingMatrixValidationError('Não há lançamentos originais para estornar.');
    }

    const reversalEntries: RawLedgerEntrySpec[] = originalEntries.map((orig) => ({
      accountId: orig.accountId,
      assetId: orig.assetId,
      entryType: orig.entryType === 'debit' ? 'credit' : 'debit',
      amount: orig.amount,
      description: `Reversal (${reason}): ${orig.description}`,
    }));

    AccountingEntryPolicy.validateEntriesBalance(reversalEntries);
    return reversalEntries;
  }

  /**
   * 12. OPENING BALANCE (BOOTSTRAP): Dr Asset Account / Cr Opening Equity
   */
  public static createOpeningBalanceEntries(params: {
    targetAccountId: number;
    openingEquityAccountId: number;
    amount: Money256;
    description: string;
  }): RawLedgerEntrySpec[] {
    AccountingEntryPolicy.assertPositiveAmount(params.amount);
    const entries: RawLedgerEntrySpec[] = [
      {
        accountId: params.targetAccountId,
        assetId: params.amount.assetId,
        entryType: 'debit',
        amount: params.amount,
        description: `Opening Balance Debit: ${params.description}`,
      },
      {
        accountId: params.openingEquityAccountId,
        assetId: params.amount.assetId,
        entryType: 'credit',
        amount: params.amount,
        description: `Opening Equity Credit: ${params.description}`,
      },
    ];
    AccountingEntryPolicy.validateEntriesBalance(entries);
    return entries;
  }

  /**
   * Valida que sum(Debits) === sum(Credits) para cada ativo na transação (FIN-001)
   */
  public static validateEntriesBalance(entries: RawLedgerEntrySpec[]): void {
    if (!entries || entries.length === 0) {
      throw new AccountingMatrixValidationError('A lista de lançamentos contábeis não pode ser vazia.');
    }

    const assetDebits = new Map<number, bigint>();
    const assetCredits = new Map<number, bigint>();

    for (const entry of entries) {
      AccountingEntryPolicy.assertPositiveAmount(entry.amount);

      const assetId = entry.assetId;
      const currentDeb = assetDebits.get(assetId) || 0n;
      const currentCred = assetCredits.get(assetId) || 0n;

      if (entry.entryType === 'debit') {
        assetDebits.set(assetId, currentDeb + entry.amount.toBigInt());
      } else {
        assetCredits.set(assetId, currentCred + entry.amount.toBigInt());
      }
    }

    const allAssetIds = new Set([...assetDebits.keys(), ...assetCredits.keys()]);
    for (const assetId of allAssetIds) {
      const totalDeb = assetDebits.get(assetId) || 0n;
      const totalCred = assetCredits.get(assetId) || 0n;
      if (totalDeb !== totalCred) {
        throw new AccountingMatrixValidationError(
          `Lançamentos desbalanceados para o ativo #${assetId}: Total Débitos (${totalDeb}) !== Total Créditos (${totalCred})`
        );
      }
    }
  }

  /**
   * Identifica e extrai o montante reembolsável de uma transação de pagamento original
   * com base nos lançamentos contábeis de receita referentes ao ativo informado.
   */
  public static extractRefundablePaymentAmount(
    entries: Array<{ direction?: string; entryType?: string; assetId: number; amount: Money256 }>,
    assetId: number
  ): Money256 {
    const paymentCreditEntry = entries.find(
      (e) => (e.direction === 'credit' || e.entryType === 'credit') && e.assetId === assetId
    );
    if (!paymentCreditEntry) {
      throw new AccountingMatrixValidationError(
        `A transação original não possui lançamento de receita referente ao ativo #${assetId}.`
      );
    }
    return paymentCreditEntry.amount;
  }

  private static assertPositiveAmount(amount: Money256): void {
    if (!amount.isPositive()) {
      throw new AccountingMatrixValidationError(
        `Todo lançamento contábil exige um valor estritamente positivo (FIN-002/FIN-004). Recebido: ${amount.toCanonicalString()}`
      );
    }
  }
}
