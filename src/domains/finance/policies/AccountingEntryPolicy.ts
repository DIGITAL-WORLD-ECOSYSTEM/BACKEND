import { Money256, parsePositiveSafeIntegerId } from '../value-objects/Money256';
import { FinancialError } from '../errors/FinancialError';
import { FinancialLedgerEntryRecord } from '../contracts/FinancialLedgerEntryRecord';
import { FinancialTransactionType, FinancialTransactionCategory } from '../entities/LedgerTransaction';

export interface RawLedgerEntrySpec {
  accountId: number;
  assetId: number;
  entryType: 'debit' | 'credit';
  amount: Money256;
  description: string;
}

export interface AccountingContext {
  transactionType: FinancialTransactionType;
  category?: FinancialTransactionCategory;
  source?: string;
  destination?: string;
  assetId: number;
  feeType?: string;
  businessReason?: string;
  authorizedByUserId?: number;
  auditRef?: string;
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
        accountId: parsePositiveSafeIntegerId(params.treasuryAccountId, 'treasuryAccountId'),
        assetId: params.amount.assetId,
        entryType: 'debit',
        amount: params.amount,
        description: `Deposit Treasury Debit: ${params.description}`,
      },
      {
        accountId: parsePositiveSafeIntegerId(params.userAccountId, 'userAccountId'),
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
        accountId: parsePositiveSafeIntegerId(params.userAccountId, 'userAccountId'),
        assetId: params.amount.assetId,
        entryType: 'debit',
        amount: params.amount,
        description: `Withdrawal User Debit: ${params.description}`,
      },
      {
        accountId: parsePositiveSafeIntegerId(params.treasuryAccountId, 'treasuryAccountId'),
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
    const sourceAcc = parsePositiveSafeIntegerId(params.sourceAccountId, 'sourceAccountId');
    const destAcc = parsePositiveSafeIntegerId(params.destinationAccountId, 'destinationAccountId');

    if (sourceAcc === destAcc) {
      throw new AccountingMatrixValidationError('Conta de origem e destino não podem ser idênticas em uma transferência.');
    }
    const entries: RawLedgerEntrySpec[] = [
      {
        accountId: sourceAcc,
        assetId: params.amount.assetId,
        entryType: 'debit',
        amount: params.amount,
        description: `Transfer Debit: ${params.description}`,
      },
      {
        accountId: destAcc,
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
        accountId: parsePositiveSafeIntegerId(params.userAccountId, 'userAccountId'),
        assetId: params.amount.assetId,
        entryType: 'debit',
        amount: params.amount,
        description: `Payment User Debit: ${params.description}`,
      },
      {
        accountId: parsePositiveSafeIntegerId(params.paymentRevenueAccountId, 'paymentRevenueAccountId'),
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
        accountId: parsePositiveSafeIntegerId(params.refundExpenseAccountId, 'refundExpenseAccountId'),
        assetId: params.amount.assetId,
        entryType: 'debit',
        amount: params.amount,
        description: `Refund Expense Debit: ${params.description}`,
      },
      {
        accountId: parsePositiveSafeIntegerId(params.userAccountId, 'userAccountId'),
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
        accountId: parsePositiveSafeIntegerId(params.userAccountId, 'userAccountId'),
        assetId: params.amount.assetId,
        entryType: 'debit',
        amount: params.amount,
        description: `Fee User Debit: ${params.description}`,
      },
      {
        accountId: parsePositiveSafeIntegerId(params.feeAccountId, 'feeAccountId'),
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
        accountId: parsePositiveSafeIntegerId(params.rewardExpenseAccountId, 'rewardExpenseAccountId'),
        assetId: params.amount.assetId,
        entryType: 'debit',
        amount: params.amount,
        description: `Reward Expense Debit: ${params.description}`,
      },
      {
        accountId: parsePositiveSafeIntegerId(params.userAccountId, 'userAccountId'),
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
        accountId: parsePositiveSafeIntegerId(params.yieldExpenseAccountId, 'yieldExpenseAccountId'),
        assetId: params.amount.assetId,
        entryType: 'debit',
        amount: params.amount,
        description: `Yield Expense Debit: ${params.description}`,
      },
      {
        accountId: parsePositiveSafeIntegerId(params.userAccountId, 'userAccountId'),
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
   * 9. CONVERSION: FX Clearing Account preservando o balanço por ativo.
   * A cotação, slippage e taxa de câmbio são validadas pelo Use Case Forex especializado.
   * Leg 1 (FromAsset): Dr User / Cr Clearing
   * Leg 2 (ToAsset): Dr Clearing / Cr User
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

    const userAcc = parsePositiveSafeIntegerId(params.userAccountId, 'userAccountId');
    const clearingAcc = parsePositiveSafeIntegerId(params.clearingAccountId, 'clearingAccountId');

    const entries: RawLedgerEntrySpec[] = [
      // Leg 1: FromAsset
      {
        accountId: userAcc,
        assetId: params.fromAmount.assetId,
        entryType: 'debit',
        amount: params.fromAmount,
        description: `Conversion Debit FromAsset: ${params.description}`,
      },
      {
        accountId: clearingAcc,
        assetId: params.fromAmount.assetId,
        entryType: 'credit',
        amount: params.fromAmount,
        description: `Conversion Clearing Credit FromAsset: ${params.description}`,
      },
      // Leg 2: ToAsset
      {
        accountId: clearingAcc,
        assetId: params.toAmount.assetId,
        entryType: 'debit',
        amount: params.toAmount,
        description: `Conversion Clearing Debit ToAsset: ${params.description}`,
      },
      {
        accountId: userAcc,
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
   * 10. ADJUSTMENT: Lançamento de ajuste com autorização auditável explícita.
   */
  public static createAdjustmentEntries(params: {
    debitAccountId: number;
    creditAccountId: number;
    amount: Money256;
    reason: string;
    authorizedByUserId: number;
  }): RawLedgerEntrySpec[] {
    AccountingEntryPolicy.assertPositiveAmount(params.amount);
    if (!params.reason || params.reason.trim().length === 0) {
      throw new AccountingMatrixValidationError('Lançamento de ajuste exige justificativa auditável.');
    }
    const authorizedBy = parsePositiveSafeIntegerId(params.authorizedByUserId, 'authorizedByUserId');
    const debAcc = parsePositiveSafeIntegerId(params.debitAccountId, 'debitAccountId');
    const credAcc = parsePositiveSafeIntegerId(params.creditAccountId, 'creditAccountId');

    const entries: RawLedgerEntrySpec[] = [
      {
        accountId: debAcc,
        assetId: params.amount.assetId,
        entryType: 'debit',
        amount: params.amount,
        description: `Adjustment Debit (AuthUser #${authorizedBy}): ${params.reason}`,
      },
      {
        accountId: credAcc,
        assetId: params.amount.assetId,
        entryType: 'credit',
        amount: params.amount,
        description: `Adjustment Credit (AuthUser #${authorizedBy}): ${params.reason}`,
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
    if (!reason || reason.trim().length === 0) {
      throw new AccountingMatrixValidationError('Estorno contábil exige justificativa auditável.');
    }

    const reversalEntries: RawLedgerEntrySpec[] = originalEntries.map((orig) => ({
      accountId: parsePositiveSafeIntegerId(orig.accountId, 'orig.accountId'),
      assetId: orig.assetId,
      entryType: orig.entryType === 'debit' ? 'credit' : 'debit',
      amount: orig.amount,
      description: `Reversal (${reason}): ${orig.description}`,
    }));

    AccountingEntryPolicy.validateEntriesBalance(reversalEntries);
    return reversalEntries;
  }

  /**
   * 12. OPENING BALANCE (BOOTSTRAP): Dr Asset Account / Cr Opening Equity com autorização administrativa.
   */
  public static createOpeningBalanceEntries(params: {
    targetAccountId: number;
    openingEquityAccountId: number;
    amount: Money256;
    description: string;
    authorizedByUserId: number;
  }): RawLedgerEntrySpec[] {
    AccountingEntryPolicy.assertPositiveAmount(params.amount);
    const authorizedBy = parsePositiveSafeIntegerId(params.authorizedByUserId, 'authorizedByUserId');
    const targetAcc = parsePositiveSafeIntegerId(params.targetAccountId, 'targetAccountId');
    const equityAcc = parsePositiveSafeIntegerId(params.openingEquityAccountId, 'openingEquityAccountId');

    const entries: RawLedgerEntrySpec[] = [
      {
        accountId: targetAcc,
        assetId: params.amount.assetId,
        entryType: 'debit',
        amount: params.amount,
        description: `Opening Balance Debit (AuthUser #${authorizedBy}): ${params.description}`,
      },
      {
        accountId: equityAcc,
        assetId: params.amount.assetId,
        entryType: 'credit',
        amount: params.amount,
        description: `Opening Equity Credit (AuthUser #${authorizedBy}): ${params.description}`,
      },
    ];
    AccountingEntryPolicy.validateEntriesBalance(entries);
    return entries;
  }

  /**
   * Valida que sum(Debits) === sum(Credits) para cada ativo na transação (FIN-001),
   * além de validar coerência de assetId e integridade dos identificadores de conta.
   */
  public static validateEntriesBalance(entries: RawLedgerEntrySpec[]): void {
    if (!entries || entries.length === 0) {
      throw new AccountingMatrixValidationError('A lista de lançamentos contábeis não pode ser vazia.');
    }

    const assetDebits = new Map<number, bigint>();
    const assetCredits = new Map<number, bigint>();

    for (const entry of entries) {
      AccountingEntryPolicy.assertPositiveAmount(entry.amount);

      parsePositiveSafeIntegerId(entry.accountId, 'entry.accountId');

      if (entry.assetId !== entry.amount.assetId) {
        throw new AccountingMatrixValidationError(
          `Incoerência de ativo no lançamento contábil: spec.assetId (${entry.assetId}) !== amount.assetId (${entry.amount.assetId}).`
        );
      }

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
   * com base nos lançamentos contábeis de receita referentes ao ativo e conta informados.
   */
  public static extractRefundablePaymentAmount(
    entries: FinancialLedgerEntryRecord[],
    assetId: number,
    revenueAccountId?: number
  ): Money256 {
    const paymentCreditEntry = entries.find(
      (e) =>
        e.direction === 'credit' &&
        e.assetId === assetId &&
        (revenueAccountId === undefined || e.accountId === revenueAccountId)
    );
    if (!paymentCreditEntry) {
      throw new AccountingMatrixValidationError(
        `A transação original não possui lançamento de receita referente ao ativo #${assetId}${
          revenueAccountId ? ` e conta #${revenueAccountId}` : ''
        }.`
      );
    }
    return Money256.fromString(paymentCreditEntry.amountBaseUnits, assetId);
  }

  private static assertPositiveAmount(amount: Money256): void {
    if (!amount.isPositive()) {
      throw new AccountingMatrixValidationError(
        `Todo lançamento contábil exige um valor estritamente positivo (FIN-002/FIN-004). Recebido: ${amount.toCanonicalString()}`
      );
    }
  }
}
