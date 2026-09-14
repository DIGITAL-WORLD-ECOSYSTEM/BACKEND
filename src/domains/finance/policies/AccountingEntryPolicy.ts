import {
  Money256,
  parsePositiveSafeIntegerId,
} from '../value-objects/Money256';

import { FinancialError } from '../errors/FinancialError';

import type { FinancialLedgerEntryRecord } from '../contracts/FinancialLedgerEntryRecord';

import type {
  FinancialTransactionType,
  FinancialTransactionCategory,
} from '../entities/LedgerTransaction';

export type LedgerEntryDirection = 'debit' | 'credit';

export interface RawLedgerEntrySpec {
  accountId: number;
  assetId: number;
  entryType: LedgerEntryDirection;
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
    super(
      message,
      'ACCOUNTING_MATRIX_VALIDATION_FAILED',
      false,
      422
    );
  }
}

const MAX_UINT256 = (1n << 256n) - 1n;

const MAX_LEDGER_ENTRIES = 100;

const MAX_DESCRIPTION_LENGTH = 2000;

export class AccountingEntryPolicy {
  /**
   * 1. DEPOSIT:
   *
   * Dr Treasury Asset (+Ativo)
   * Cr User Available (+Passivo)
   */
  public static createDepositEntries(params: {
    treasuryAccountId: number;
    userAccountId: number;
    amount: Money256;
    description: string;
  }): RawLedgerEntrySpec[] {
    AccountingEntryPolicy.assertOperationParams(params);

    AccountingEntryPolicy.assertPositiveAmount(params.amount);

    const amount =
      AccountingEntryPolicy.assertMoney256(params.amount);

    const description =
      AccountingEntryPolicy.normalizeDescription(
        params.description
      );

    const treasuryAccountId =
      parsePositiveSafeIntegerId(
        params.treasuryAccountId,
        'treasuryAccountId'
      );

    const userAccountId =
      parsePositiveSafeIntegerId(
        params.userAccountId,
        'userAccountId'
      );

    AccountingEntryPolicy.assertDistinctAccounts(
      treasuryAccountId,
      userAccountId,
      'A conta de treasury e a conta do usuário não podem ser idênticas em um depósito.'
    );

    const entries: RawLedgerEntrySpec[] = [
      AccountingEntryPolicy.createEntry({
        accountId: treasuryAccountId,
        assetId: amount.assetId,
        entryType: 'debit',
        amount,
        description:
          `Deposit Treasury Debit: ${description}`,
      }),
      AccountingEntryPolicy.createEntry({
        accountId: userAccountId,
        assetId: amount.assetId,
        entryType: 'credit',
        amount,
        description:
          `Deposit User Credit: ${description}`,
      }),
    ];

    AccountingEntryPolicy.validateEntriesBalance(entries);

    return entries;
  }

  /**
   * 2. WITHDRAWAL:
   *
   * Dr User Available (-Passivo)
   * Cr Treasury Asset (-Ativo)
   */
  public static createWithdrawalEntries(params: {
    treasuryAccountId: number;
    userAccountId: number;
    amount: Money256;
    description: string;
  }): RawLedgerEntrySpec[] {
    AccountingEntryPolicy.assertOperationParams(params);

    AccountingEntryPolicy.assertPositiveAmount(params.amount);

    const amount =
      AccountingEntryPolicy.assertMoney256(params.amount);

    const description =
      AccountingEntryPolicy.normalizeDescription(
        params.description
      );

    const treasuryAccountId =
      parsePositiveSafeIntegerId(
        params.treasuryAccountId,
        'treasuryAccountId'
      );

    const userAccountId =
      parsePositiveSafeIntegerId(
        params.userAccountId,
        'userAccountId'
      );

    AccountingEntryPolicy.assertDistinctAccounts(
      treasuryAccountId,
      userAccountId,
      'A conta de treasury e a conta do usuário não podem ser idênticas em uma retirada.'
    );

    const entries: RawLedgerEntrySpec[] = [
      AccountingEntryPolicy.createEntry({
        accountId: userAccountId,
        assetId: amount.assetId,
        entryType: 'debit',
        amount,
        description:
          `Withdrawal User Debit: ${description}`,
      }),
      AccountingEntryPolicy.createEntry({
        accountId: treasuryAccountId,
        assetId: amount.assetId,
        entryType: 'credit',
        amount,
        description:
          `Withdrawal Treasury Credit: ${description}`,
      }),
    ];

    AccountingEntryPolicy.validateEntriesBalance(entries);

    return entries;
  }

  /**
   * 3. TRANSFER:
   *
   * Dr Source User (-Passivo)
   * Cr Target User (+Passivo)
   */
  public static createTransferEntries(params: {
    sourceAccountId: number;
    destinationAccountId: number;
    amount: Money256;
    description: string;
  }): RawLedgerEntrySpec[] {
    AccountingEntryPolicy.assertOperationParams(params);

    AccountingEntryPolicy.assertPositiveAmount(params.amount);

    const amount =
      AccountingEntryPolicy.assertMoney256(params.amount);

    const description =
      AccountingEntryPolicy.normalizeDescription(
        params.description
      );

    const sourceAcc =
      parsePositiveSafeIntegerId(
        params.sourceAccountId,
        'sourceAccountId'
      );

    const destAcc =
      parsePositiveSafeIntegerId(
        params.destinationAccountId,
        'destinationAccountId'
      );

    AccountingEntryPolicy.assertDistinctAccounts(
      sourceAcc,
      destAcc,
      'Conta de origem e destino não podem ser idênticas em uma transferência.'
    );

    const entries: RawLedgerEntrySpec[] = [
      AccountingEntryPolicy.createEntry({
        accountId: sourceAcc,
        assetId: amount.assetId,
        entryType: 'debit',
        amount,
        description:
          `Transfer Debit: ${description}`,
      }),
      AccountingEntryPolicy.createEntry({
        accountId: destAcc,
        assetId: amount.assetId,
        entryType: 'credit',
        amount,
        description:
          `Transfer Credit: ${description}`,
      }),
    ];

    AccountingEntryPolicy.validateEntriesBalance(entries);

    return entries;
  }

  /**
   * 4. PAYMENT:
   *
   * Dr User Available (-Passivo)
   * Cr Payment Revenue (+Receita)
   */
  public static createPaymentEntries(params: {
    userAccountId: number;
    paymentRevenueAccountId: number;
    amount: Money256;
    description: string;
  }): RawLedgerEntrySpec[] {
    AccountingEntryPolicy.assertOperationParams(params);

    AccountingEntryPolicy.assertPositiveAmount(params.amount);

    const amount =
      AccountingEntryPolicy.assertMoney256(params.amount);

    const description =
      AccountingEntryPolicy.normalizeDescription(
        params.description
      );

    const userAccountId =
      parsePositiveSafeIntegerId(
        params.userAccountId,
        'userAccountId'
      );

    const paymentRevenueAccountId =
      parsePositiveSafeIntegerId(
        params.paymentRevenueAccountId,
        'paymentRevenueAccountId'
      );

    AccountingEntryPolicy.assertDistinctAccounts(
      userAccountId,
      paymentRevenueAccountId,
      'A conta do usuário e a conta de receita do pagamento não podem ser idênticas.'
    );

    const entries: RawLedgerEntrySpec[] = [
      AccountingEntryPolicy.createEntry({
        accountId: userAccountId,
        assetId: amount.assetId,
        entryType: 'debit',
        amount,
        description:
          `Payment User Debit: ${description}`,
      }),
      AccountingEntryPolicy.createEntry({
        accountId: paymentRevenueAccountId,
        assetId: amount.assetId,
        entryType: 'credit',
        amount,
        description:
          `Payment Revenue Credit: ${description}`,
      }),
    ];

    AccountingEntryPolicy.validateEntriesBalance(entries);

    return entries;
  }

  /**
   * 5. REFUND:
   *
   * Dr Refund Expense (+Despesa)
   * Cr User Available (+Passivo)
   */
  public static createRefundEntries(params: {
    refundExpenseAccountId: number;
    userAccountId: number;
    amount: Money256;
    description: string;
  }): RawLedgerEntrySpec[] {
    AccountingEntryPolicy.assertOperationParams(params);

    AccountingEntryPolicy.assertPositiveAmount(params.amount);

    const amount =
      AccountingEntryPolicy.assertMoney256(params.amount);

    const description =
      AccountingEntryPolicy.normalizeDescription(
        params.description
      );

    const refundExpenseAccountId =
      parsePositiveSafeIntegerId(
        params.refundExpenseAccountId,
        'refundExpenseAccountId'
      );

    const userAccountId =
      parsePositiveSafeIntegerId(
        params.userAccountId,
        'userAccountId'
      );

    AccountingEntryPolicy.assertDistinctAccounts(
      refundExpenseAccountId,
      userAccountId,
      'A conta de despesa de refund e a conta do usuário não podem ser idênticas.'
    );

    const entries: RawLedgerEntrySpec[] = [
      AccountingEntryPolicy.createEntry({
        accountId: refundExpenseAccountId,
        assetId: amount.assetId,
        entryType: 'debit',
        amount,
        description:
          `Refund Expense Debit: ${description}`,
      }),
      AccountingEntryPolicy.createEntry({
        accountId: userAccountId,
        assetId: amount.assetId,
        entryType: 'credit',
        amount,
        description:
          `Refund User Credit: ${description}`,
      }),
    ];

    AccountingEntryPolicy.validateEntriesBalance(entries);

    return entries;
  }

  /**
   * 6. FEE:
   *
   * Dr User Available (-Passivo)
   * Cr Fees Revenue (+Receita)
   */
  public static createFeeEntries(params: {
    userAccountId: number;
    feeAccountId: number;
    amount: Money256;
    description: string;
  }): RawLedgerEntrySpec[] {
    AccountingEntryPolicy.assertOperationParams(params);

    AccountingEntryPolicy.assertPositiveAmount(params.amount);

    const amount =
      AccountingEntryPolicy.assertMoney256(params.amount);

    const description =
      AccountingEntryPolicy.normalizeDescription(
        params.description
      );

    const userAccountId =
      parsePositiveSafeIntegerId(
        params.userAccountId,
        'userAccountId'
      );

    const feeAccountId =
      parsePositiveSafeIntegerId(
        params.feeAccountId,
        'feeAccountId'
      );

    AccountingEntryPolicy.assertDistinctAccounts(
      userAccountId,
      feeAccountId,
      'A conta do usuário e a conta de receitas de fee não podem ser idênticas.'
    );

    const entries: RawLedgerEntrySpec[] = [
      AccountingEntryPolicy.createEntry({
        accountId: userAccountId,
        assetId: amount.assetId,
        entryType: 'debit',
        amount,
        description:
          `Fee User Debit: ${description}`,
      }),
      AccountingEntryPolicy.createEntry({
        accountId: feeAccountId,
        assetId: amount.assetId,
        entryType: 'credit',
        amount,
        description:
          `Fee Revenue Credit: ${description}`,
      }),
    ];

    AccountingEntryPolicy.validateEntriesBalance(entries);

    return entries;
  }

  /**
   * 7. REWARD:
   *
   * Dr Reward Expense (+Despesa)
   * Cr User Available (+Passivo)
   */
  public static createRewardEntries(params: {
    rewardExpenseAccountId: number;
    userAccountId: number;
    amount: Money256;
    description: string;
  }): RawLedgerEntrySpec[] {
    AccountingEntryPolicy.assertOperationParams(params);

    AccountingEntryPolicy.assertPositiveAmount(params.amount);

    const amount =
      AccountingEntryPolicy.assertMoney256(params.amount);

    const description =
      AccountingEntryPolicy.normalizeDescription(
        params.description
      );

    const rewardExpenseAccountId =
      parsePositiveSafeIntegerId(
        params.rewardExpenseAccountId,
        'rewardExpenseAccountId'
      );

    const userAccountId =
      parsePositiveSafeIntegerId(
        params.userAccountId,
        'userAccountId'
      );

    AccountingEntryPolicy.assertDistinctAccounts(
      rewardExpenseAccountId,
      userAccountId,
      'A conta de despesa de reward e a conta do usuário não podem ser idênticas.'
    );

    const entries: RawLedgerEntrySpec[] = [
      AccountingEntryPolicy.createEntry({
        accountId: rewardExpenseAccountId,
        assetId: amount.assetId,
        entryType: 'debit',
        amount,
        description:
          `Reward Expense Debit: ${description}`,
      }),
      AccountingEntryPolicy.createEntry({
        accountId: userAccountId,
        assetId: amount.assetId,
        entryType: 'credit',
        amount,
        description:
          `Reward User Credit: ${description}`,
      }),
    ];

    AccountingEntryPolicy.validateEntriesBalance(entries);

    return entries;
  }

  /**
   * 8. YIELD:
   *
   * Dr Yield Expense (+Despesa)
   * Cr User Available (+Passivo)
   */
  public static createYieldEntries(params: {
    yieldExpenseAccountId: number;
    userAccountId: number;
    amount: Money256;
    description: string;
  }): RawLedgerEntrySpec[] {
    AccountingEntryPolicy.assertOperationParams(params);

    AccountingEntryPolicy.assertPositiveAmount(params.amount);

    const amount =
      AccountingEntryPolicy.assertMoney256(params.amount);

    const description =
      AccountingEntryPolicy.normalizeDescription(
        params.description
      );

    const yieldExpenseAccountId =
      parsePositiveSafeIntegerId(
        params.yieldExpenseAccountId,
        'yieldExpenseAccountId'
      );

    const userAccountId =
      parsePositiveSafeIntegerId(
        params.userAccountId,
        'userAccountId'
      );

    AccountingEntryPolicy.assertDistinctAccounts(
      yieldExpenseAccountId,
      userAccountId,
      'A conta de despesa de yield e a conta do usuário não podem ser idênticas.'
    );

    const entries: RawLedgerEntrySpec[] = [
      AccountingEntryPolicy.createEntry({
        accountId: yieldExpenseAccountId,
        assetId: amount.assetId,
        entryType: 'debit',
        amount,
        description:
          `Yield Expense Debit: ${description}`,
      }),
      AccountingEntryPolicy.createEntry({
        accountId: userAccountId,
        assetId: amount.assetId,
        entryType: 'credit',
        amount,
        description:
          `Yield User Credit: ${description}`,
      }),
    ];

    AccountingEntryPolicy.validateEntriesBalance(entries);

    return entries;
  }

  /**
   * 9. CONVERSION:
   *
   * Leg 1 (FromAsset):
   *   Dr User / Cr Clearing
   *
   * Leg 2 (ToAsset):
   *   Dr Clearing / Cr User
   *
   * A cotação, slippage, taxa e demais regras econômicas da conversão
   * continuam pertencendo ao Use Case Forex especializado.
   */
  public static createConversionEntries(params: {
    userAccountId: number;
    clearingAccountId: number;
    fromAmount: Money256;
    toAmount: Money256;
    description: string;
  }): RawLedgerEntrySpec[] {
    AccountingEntryPolicy.assertOperationParams(params);

    AccountingEntryPolicy.assertPositiveAmount(
      params.fromAmount
    );

    AccountingEntryPolicy.assertPositiveAmount(
      params.toAmount
    );

    const fromAmount =
      AccountingEntryPolicy.assertMoney256(
        params.fromAmount
      );

    const toAmount =
      AccountingEntryPolicy.assertMoney256(
        params.toAmount
      );

    if (fromAmount.assetId === toAmount.assetId) {
      throw new AccountingMatrixValidationError(
        'Conversão exige ativos distintos.'
      );
    }

    const description =
      AccountingEntryPolicy.normalizeDescription(
        params.description
      );

    const userAcc =
      parsePositiveSafeIntegerId(
        params.userAccountId,
        'userAccountId'
      );

    const clearingAcc =
      parsePositiveSafeIntegerId(
        params.clearingAccountId,
        'clearingAccountId'
      );

    AccountingEntryPolicy.assertDistinctAccounts(
      userAcc,
      clearingAcc,
      'A conta do usuário e a conta de clearing não podem ser idênticas em uma conversão.'
    );

    const entries: RawLedgerEntrySpec[] = [
      AccountingEntryPolicy.createEntry({
        accountId: userAcc,
        assetId: fromAmount.assetId,
        entryType: 'debit',
        amount: fromAmount,
        description:
          `Conversion Debit FromAsset: ${description}`,
      }),
      AccountingEntryPolicy.createEntry({
        accountId: clearingAcc,
        assetId: fromAmount.assetId,
        entryType: 'credit',
        amount: fromAmount,
        description:
          `Conversion Clearing Credit FromAsset: ${description}`,
      }),
      AccountingEntryPolicy.createEntry({
        accountId: clearingAcc,
        assetId: toAmount.assetId,
        entryType: 'debit',
        amount: toAmount,
        description:
          `Conversion Clearing Debit ToAsset: ${description}`,
      }),
      AccountingEntryPolicy.createEntry({
        accountId: userAcc,
        assetId: toAmount.assetId,
        entryType: 'credit',
        amount: toAmount,
        description:
          `Conversion Credit ToAsset: ${description}`,
      }),
    ];

    AccountingEntryPolicy.validateEntriesBalance(entries);

    return entries;
  }

  /**
   * 10. ADJUSTMENT:
   *
   * Lançamento de ajuste com identificação auditável explícita.
   *
   * IMPORTANTE:
   * authorizedByUserId representa a identidade declarada do autor.
   * Não representa, sozinho, autorização.
   *
   * A autorização efetiva deve ser garantida pelo Use Case/RBAC.
   */
  public static createAdjustmentEntries(params: {
    debitAccountId: number;
    creditAccountId: number;
    amount: Money256;
    reason: string;
    authorizedByUserId: number;
  }): RawLedgerEntrySpec[] {
    AccountingEntryPolicy.assertOperationParams(params);

    AccountingEntryPolicy.assertPositiveAmount(params.amount);

    const reason =
      AccountingEntryPolicy.normalizeRequiredReason(
        params.reason,
        'Lançamento de ajuste exige justificativa auditável.'
      );

    const authorizedBy =
      parsePositiveSafeIntegerId(
        params.authorizedByUserId,
        'authorizedByUserId'
      );

    const debAcc =
      parsePositiveSafeIntegerId(
        params.debitAccountId,
        'debitAccountId'
      );

    const credAcc =
      parsePositiveSafeIntegerId(
        params.creditAccountId,
        'creditAccountId'
      );

    AccountingEntryPolicy.assertDistinctAccounts(
      debAcc,
      credAcc,
      'Conta de débito e conta de crédito não podem ser idênticas em um ajuste.'
    );

    const amount =
      AccountingEntryPolicy.assertMoney256(params.amount);

    const entries: RawLedgerEntrySpec[] = [
      AccountingEntryPolicy.createEntry({
        accountId: debAcc,
        assetId: amount.assetId,
        entryType: 'debit',
        amount,
        description:
          `Adjustment Debit (AuthUser #${authorizedBy}): ${reason}`,
      }),
      AccountingEntryPolicy.createEntry({
        accountId: credAcc,
        assetId: amount.assetId,
        entryType: 'credit',
        amount,
        description:
          `Adjustment Credit (AuthUser #${authorizedBy}): ${reason}`,
      }),
    ];

    AccountingEntryPolicy.validateEntriesBalance(entries);

    return entries;
  }

  /**
   * 11. REVERSAL:
   *
   * Inversão exata dos lançamentos da transação original.
   *
   * A decisão de que determinada transação pode ser revertida
   * pertence à ReversalPolicy / State Machine / Orchestrator.
   */
  public static createReversalEntries(
    originalEntries: RawLedgerEntrySpec[],
    reason: string
  ): RawLedgerEntrySpec[] {
    if (
      !Array.isArray(originalEntries) ||
      originalEntries.length === 0
    ) {
      throw new AccountingMatrixValidationError(
        'Não há lançamentos originais para estornar.'
      );
    }

    if (
      originalEntries.length > MAX_LEDGER_ENTRIES
    ) {
      throw new AccountingMatrixValidationError(
        `A transação não pode possuir mais de ${MAX_LEDGER_ENTRIES} lançamentos.`
      );
    }

    const normalizedReason =
      AccountingEntryPolicy.normalizeRequiredReason(
        reason,
        'Estorno contábil exige justificativa auditável.'
      );

    const reversalEntries =
      originalEntries.map((orig) => {
        AccountingEntryPolicy.assertRawEntryShape(
          orig
        );

        let entryType: LedgerEntryDirection;

        if (orig.entryType === 'debit') {
          entryType = 'credit';
        } else if (orig.entryType === 'credit') {
          entryType = 'debit';
        } else {
          throw new AccountingMatrixValidationError(
            `Lançamento original possui entryType inválido: ${String(
              orig.entryType
            )}.`
          );
        }

        const accountId =
          parsePositiveSafeIntegerId(
            orig.accountId,
            'orig.accountId'
          );

        const assetId =
          parsePositiveSafeIntegerId(
            orig.assetId,
            'orig.assetId'
          );

        const amount =
          AccountingEntryPolicy.assertMoney256(
            orig.amount
          );

        if (amount.assetId !== assetId) {
          throw new AccountingMatrixValidationError(
            `Incoerência de ativo no lançamento original: assetId (${assetId}) !== amount.assetId (${amount.assetId}).`
          );
        }

        const description =
          AccountingEntryPolicy.normalizeDescription(
            orig.description
          );

        return {
          accountId,
          assetId,
          entryType,
          amount,
          description:
            `Reversal (${normalizedReason}): ${description}`,
        };
      });

    AccountingEntryPolicy.validateEntriesBalance(
      reversalEntries
    );

    return reversalEntries;
  }

  /**
   * 12. OPENING BALANCE:
   *
   * Dr Asset Account
   * Cr Opening Equity
   *
   * A autorização administrativa efetiva deve ser garantida
   * antes da chamada deste método.
   */
  public static createOpeningBalanceEntries(params: {
    targetAccountId: number;
    openingEquityAccountId: number;
    amount: Money256;
    description: string;
    authorizedByUserId: number;
  }): RawLedgerEntrySpec[] {
    AccountingEntryPolicy.assertOperationParams(params);

    AccountingEntryPolicy.assertPositiveAmount(params.amount);

    const amount =
      AccountingEntryPolicy.assertMoney256(params.amount);

    const description =
      AccountingEntryPolicy.normalizeDescription(
        params.description
      );

    const authorizedBy =
      parsePositiveSafeIntegerId(
        params.authorizedByUserId,
        'authorizedByUserId'
      );

    const targetAcc =
      parsePositiveSafeIntegerId(
        params.targetAccountId,
        'targetAccountId'
      );

    const equityAcc =
      parsePositiveSafeIntegerId(
        params.openingEquityAccountId,
        'openingEquityAccountId'
      );

    AccountingEntryPolicy.assertDistinctAccounts(
      targetAcc,
      equityAcc,
      'A conta de destino e a conta de opening equity não podem ser idênticas.'
    );

    const entries: RawLedgerEntrySpec[] = [
      AccountingEntryPolicy.createEntry({
        accountId: targetAcc,
        assetId: amount.assetId,
        entryType: 'debit',
        amount,
        description:
          `Opening Balance Debit (AuthUser #${authorizedBy}): ${description}`,
      }),
      AccountingEntryPolicy.createEntry({
        accountId: equityAcc,
        assetId: amount.assetId,
        entryType: 'credit',
        amount,
        description:
          `Opening Equity Credit (AuthUser #${authorizedBy}): ${description}`,
      }),
    ];

    AccountingEntryPolicy.validateEntriesBalance(entries);

    return entries;
  }

  /**
   * Valida que:
   *
   *   sum(Debits) === sum(Credits)
   *
   * para cada ativo individualmente.
   *
   * Também funciona como barreira defensiva de runtime para
   * RawLedgerEntrySpec.
   */
  public static validateEntriesBalance(
    entries: RawLedgerEntrySpec[]
  ): void {
    if (
      !Array.isArray(entries) ||
      entries.length === 0
    ) {
      throw new AccountingMatrixValidationError(
        'A lista de lançamentos contábeis não pode ser vazia.'
      );
    }

    if (
      entries.length > MAX_LEDGER_ENTRIES
    ) {
      throw new AccountingMatrixValidationError(
        `A lista de lançamentos não pode possuir mais de ${MAX_LEDGER_ENTRIES} itens.`
      );
    }

    const assetDebits = new Map<number, bigint>();
    const assetCredits = new Map<number, bigint>();

    for (const entry of entries) {
      AccountingEntryPolicy.assertRawEntryShape(
        entry
      );

      const amount =
        AccountingEntryPolicy.assertMoney256(
          entry.amount
        );

      parsePositiveSafeIntegerId(
        entry.accountId,
        'entry.accountId'
      );

      const assetId =
        parsePositiveSafeIntegerId(
          entry.assetId,
          'entry.assetId'
        );

      if (amount.assetId !== assetId) {
        throw new AccountingMatrixValidationError(
          `Incoerência de ativo no lançamento contábil: ` +
            `spec.assetId (${assetId}) !== ` +
            `amount.assetId (${amount.assetId}).`
        );
      }

      AccountingEntryPolicy.assertPositiveAmount(
        amount
      );

      const amountBigInt = amount.toBigInt();

      if (
        amountBigInt <= 0n ||
        amountBigInt > MAX_UINT256
      ) {
        throw new AccountingMatrixValidationError(
          `Valor contábil fora do intervalo permitido uint256 positivo no lançamento da conta #${entry.accountId}.`
        );
      }

      if (entry.entryType === 'debit') {
        const current =
          assetDebits.get(assetId) ?? 0n;

        const next =
          current + amountBigInt;

        if (next > MAX_UINT256) {
          throw new AccountingMatrixValidationError(
            `Overflow uint256 no acumulado de débitos do ativo #${assetId}.`
          );
        }

        assetDebits.set(assetId, next);
      } else if (entry.entryType === 'credit') {
        const current =
          assetCredits.get(assetId) ?? 0n;

        const next =
          current + amountBigInt;

        if (next > MAX_UINT256) {
          throw new AccountingMatrixValidationError(
            `Overflow uint256 no acumulado de créditos do ativo #${assetId}.`
          );
        }

        assetCredits.set(assetId, next);
      } else {
        /**
         * Nunca usar "else = credit".
         *
         * Qualquer valor diferente de debit/credit é inválido.
         */
        throw new AccountingMatrixValidationError(
          `Tipo de lançamento inválido: ${String(
            entry.entryType
          )}.`
        );
      }
    }

    const allAssetIds = new Set([
      ...assetDebits.keys(),
      ...assetCredits.keys(),
    ]);

    for (const assetId of allAssetIds) {
      const totalDebits =
        assetDebits.get(assetId) ?? 0n;

      const totalCredits =
        assetCredits.get(assetId) ?? 0n;

      if (totalDebits !== totalCredits) {
        throw new AccountingMatrixValidationError(
          `Lançamentos desbalanceados para o ativo #${assetId}: ` +
            `Total Débitos (${totalDebits}) !== ` +
            `Total Créditos (${totalCredits})`
        );
      }
    }
  }

  /**
   * Identifica e extrai o montante reembolsável de uma transação
   * de pagamento original.
   *
   * Mantemos o parâmetro opcional na assinatura para não quebrar
   * compile-time callers existentes, porém, em runtime, a conta
   * de receita é obrigatória para uma seleção semanticamente segura.
   */
  public static extractRefundablePaymentAmount(
    entries: FinancialLedgerEntryRecord[],
    assetId: number,
    revenueAccountId?: number
  ): Money256 {
    if (
      !Array.isArray(entries) ||
      entries.length === 0
    ) {
      throw new AccountingMatrixValidationError(
        'A transação original não possui lançamentos contábeis.'
      );
    }

    if (revenueAccountId === undefined) {
      throw new AccountingMatrixValidationError(
        'revenueAccountId é obrigatório para identificar o lançamento de receita de forma segura.'
      );
    }

    const normalizedAssetId =
      parsePositiveSafeIntegerId(
        assetId,
        'assetId'
      );

    const normalizedRevenueAccountId =
      parsePositiveSafeIntegerId(
        revenueAccountId,
        'revenueAccountId'
      );

    const paymentCreditEntries =
      entries.filter(
        (entry) =>
          entry !== null &&
          typeof entry === 'object' &&
          entry.direction === 'credit' &&
          entry.assetId === normalizedAssetId &&
          entry.accountId ===
            normalizedRevenueAccountId
      );

    if (paymentCreditEntries.length === 0) {
      throw new AccountingMatrixValidationError(
        `A transação original não possui lançamento de receita referente ao ativo #${normalizedAssetId} e conta #${normalizedRevenueAccountId}.`
      );
    }

    if (paymentCreditEntries.length > 1) {
      throw new AccountingMatrixValidationError(
        `A transação original possui múltiplos lançamentos de receita para o ativo #${normalizedAssetId} e conta #${normalizedRevenueAccountId}; não é possível determinar um valor reembolsável de forma segura.`
      );
    }

    const paymentCreditEntry =
      paymentCreditEntries[0];

    if (
      typeof paymentCreditEntry.amountBaseUnits !==
        'string' ||
      paymentCreditEntry.amountBaseUnits
        .trim()
        .length === 0
    ) {
      throw new AccountingMatrixValidationError(
        'O valor-base do lançamento de receita é inválido.'
      );
    }

    return Money256.fromString(
      paymentCreditEntry.amountBaseUnits,
      normalizedAssetId
    );
  }

  /**
   * Garante que um amount recebido em runtime realmente seja
   * uma instância válida de Money256.
   */
  private static assertMoney256(
    amount: unknown
  ): Money256 {
    if (!(amount instanceof Money256)) {
      throw new AccountingMatrixValidationError(
        'O valor do lançamento deve ser uma instância válida de Money256.'
      );
    }

    return amount;
  }

  /**
   * Garante valor estritamente positivo.
   */
  private static assertPositiveAmount(
    amount: Money256
  ): void {
    const validatedAmount =
      AccountingEntryPolicy.assertMoney256(
        amount
      );

    if (!validatedAmount.isPositive()) {
      throw new AccountingMatrixValidationError(
        `Todo lançamento contábil exige um valor estritamente positivo (FIN-002/FIN-004). Recebido: ${validatedAmount.toCanonicalString()}`
      );
    }
  }

  /**
   * Valida estrutura mínima de um RawLedgerEntrySpec
   * recebida em runtime.
   */
  private static assertRawEntryShape(
    entry: unknown
  ): asserts entry is RawLedgerEntrySpec {
    if (
      entry === null ||
      typeof entry !== 'object' ||
      Array.isArray(entry)
    ) {
      throw new AccountingMatrixValidationError(
        'Lançamento contábil inválido: objeto esperado.'
      );
    }

    const raw =
      entry as Partial<RawLedgerEntrySpec>;

    if (
      typeof raw.entryType !== 'string' ||
      (
        raw.entryType !== 'debit' &&
        raw.entryType !== 'credit'
      )
    ) {
      throw new AccountingMatrixValidationError(
        `Tipo de lançamento inválido: ${String(
          raw.entryType
        )}.`
      );
    }

    if (
      !Object.prototype.hasOwnProperty.call(
        raw,
        'amount'
      ) ||
      !(raw.amount instanceof Money256)
    ) {
      throw new AccountingMatrixValidationError(
        'O lançamento contábil deve possuir um amount válido do tipo Money256.'
      );
    }

    if (
      typeof raw.description !== 'string'
    ) {
      throw new AccountingMatrixValidationError(
        'A descrição do lançamento contábil deve ser uma string.'
      );
    }

    AccountingEntryPolicy.normalizeDescription(
      raw.description
    );
  }

  /**
   * Valida o objeto de parâmetros antes que um builder
   * tente acessar suas propriedades.
   *
   * Evita TypeError em casos de null/undefined/malformed runtime input.
   */
  private static assertOperationParams(
    params: unknown
  ): asserts params is object {
    if (
      params === null ||
      typeof params !== 'object' ||
      Array.isArray(params)
    ) {
      throw new AccountingMatrixValidationError(
        'Parâmetros da operação contábil inválidos.'
      );
    }
  }

  /**
   * Impede lançamentos economicamente sem efeito causados
   * pela utilização da mesma conta nos dois lados da operação.
   */
  private static assertDistinctAccounts(
    firstAccountId: number,
    secondAccountId: number,
    message: string
  ): void {
    if (firstAccountId === secondAccountId) {
      throw new AccountingMatrixValidationError(
        message
      );
    }
  }

  /**
   * Construtor interno de entries.
   *
   * Centraliza invariantes comuns:
   * - accountId;
   * - assetId;
   * - entryType;
   * - Money256;
   * - positividade;
   * - consistência do ativo;
   * - descrição.
   */
  private static createEntry(params: {
    accountId: number;
    assetId: number;
    entryType: LedgerEntryDirection;
    amount: Money256;
    description: string;
  }): RawLedgerEntrySpec {
    const accountId =
      parsePositiveSafeIntegerId(
        params.accountId,
        'accountId'
      );

    const assetId =
      parsePositiveSafeIntegerId(
        params.assetId,
        'assetId'
      );

    const amount =
      AccountingEntryPolicy.assertMoney256(
        params.amount
      );

    if (
      params.entryType !== 'debit' &&
      params.entryType !== 'credit'
    ) {
      throw new AccountingMatrixValidationError(
        `entryType inválido: ${String(
          params.entryType
        )}.`
      );
    }

    if (amount.assetId !== assetId) {
      throw new AccountingMatrixValidationError(
        `Asset inconsistente: ${assetId} !== ${amount.assetId}.`
      );
    }

    AccountingEntryPolicy.assertPositiveAmount(
      amount
    );

    const description =
      AccountingEntryPolicy.normalizeDescription(
        params.description
      );

    return {
      accountId,
      assetId,
      entryType: params.entryType,
      amount,
      description,
    };
  }

  /**
   * Normalização/validação textual compartilhada.
   *
   * Protege contra:
   * - null/undefined;
   * - strings vazias;
   * - caracteres ASCII de controle;
   * - texto excessivamente grande.
   */
  private static normalizeDescription(
    value: string
  ): string {
    if (typeof value !== 'string') {
      throw new AccountingMatrixValidationError(
        'A descrição do lançamento contábil deve ser uma string.'
      );
    }

    const normalized = value
      .normalize('NFC')
      .trim();

    if (normalized.length === 0) {
      throw new AccountingMatrixValidationError(
        'A descrição do lançamento contábil não pode ser vazia.'
      );
    }

    if (
      normalized.length >
      MAX_DESCRIPTION_LENGTH
    ) {
      throw new AccountingMatrixValidationError(
        `A descrição do lançamento contábil não pode exceder ${MAX_DESCRIPTION_LENGTH} caracteres.`
      );
    }

    for (
      let index = 0;
      index < normalized.length;
      index += 1
    ) {
      const codeUnit =
        normalized.charCodeAt(index);

      if (
        (codeUnit >= 0 &&
          codeUnit <= 8) ||
        (codeUnit >= 11 &&
          codeUnit <= 12) ||
        (codeUnit >= 14 &&
          codeUnit <= 31) ||
        codeUnit === 127
      ) {
        throw new AccountingMatrixValidationError(
          'A descrição do lançamento contábil contém caractere de controle inválido.'
        );
      }
    }

    return normalized;
  }

  /**
   * Validação de justificativas críticas.
   */
  private static normalizeRequiredReason(
    value: string,
    emptyMessage: string
  ): string {
    if (
      typeof value !== 'string' ||
      value.trim().length === 0
    ) {
      throw new AccountingMatrixValidationError(
        emptyMessage
      );
    }

    return AccountingEntryPolicy.normalizeDescription(
      value
    );
  }
}
