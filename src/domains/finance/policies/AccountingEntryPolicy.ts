import {
  Money256,
  parsePositiveSafeIntegerId,
} from '../value-objects/Money256';

import {
  MAX_UINT256,
  MAX_LEDGER_ENTRIES,
  MAX_LEDGER_DESCRIPTION_LENGTH,
} from '../constants/FinancialLimits';

import {
  type LedgerEntryDirection,
  isLedgerEntryDirection,
} from '../value-objects/BaseUnits';

import { FinancialTextPolicy } from './FinancialTextPolicy';

import { FinancialError } from '../errors/FinancialError';

import type { FinancialLedgerEntryRecord } from '../contracts/FinancialLedgerEntryRecord';

import type {
  FinancialTransactionType,
  FinancialTransactionCategory,
} from '../entities/LedgerTransaction';

export { type LedgerEntryDirection, isLedgerEntryDirection };
export { MAX_LEDGER_DESCRIPTION_LENGTH };

export interface RawLedgerEntrySpec {
  readonly accountId: number;
  readonly assetId: number;
  readonly entryType: LedgerEntryDirection;
  readonly amount: Money256;
  readonly description: string;
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
  constructor(message: string, details?: Record<string, unknown>) {
    super(
      message,
      'ACCOUNTING_MATRIX_VALIDATION_FAILED',
      false,
      details
    );
  }
}


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
    originalEntries: ReadonlyArray<RawLedgerEntrySpec> | RawLedgerEntrySpec[],
    reason: string
  ): ReadonlyArray<RawLedgerEntrySpec> {
    if (
      !Array.isArray(originalEntries) ||
      originalEntries.length < 2
    ) {
      throw new AccountingMatrixValidationError(
        'Estorno exige ao menos 2 lançamentos originais.'
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
      originalEntries.map((orig, index) => {
        if (!orig || typeof orig !== 'object') {
          throw new AccountingMatrixValidationError(
            `Lançamento original na posição ${index} é inválido.`
          );
        }

        AccountingEntryPolicy.assertRawEntryShape(
          orig
        );

        const rawDirection = (orig as any).entryType ?? (orig as any).direction;

        if (!isLedgerEntryDirection(rawDirection)) {
          throw new AccountingMatrixValidationError(
            `Lançamento original na posição ${index} possui entryType inválido.`
          );
        }

        const entryType: LedgerEntryDirection =
          rawDirection === 'debit' ? 'credit' : 'debit';

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

        const reversalDescription =
          FinancialTextPolicy.formatReversalDescription(
            normalizedReason,
            orig.description
          );

        return AccountingEntryPolicy.createEntry({
          accountId,
          assetId,
          entryType,
          amount,
          description: reversalDescription,
        });
      });

    AccountingEntryPolicy.validateEntriesBalance(
      reversalEntries
    );

    return Object.freeze(reversalEntries);
  }

  /**
   * Saldo de abertura para contas com natureza devedora (Normal Debit: Ativos).
   * Dr Target Account (+Ativo)
   * Cr Opening Equity Account (+PL Abertura)
   */
  public static createAssetOpeningBalanceEntries(params: {
    targetAccountId: number;
    openingEquityAccountId: number;
    amount: Money256;
    description: string;
    authorizedByUserId: number;
  }): RawLedgerEntrySpec[] {
    return AccountingEntryPolicy.buildOpeningBalanceEntries({
      ...params,
      targetDirection: 'debit',
      equityDirection: 'credit',
      label: 'Asset',
    });
  }

  /**
   * Saldo de abertura para contas com natureza credora (Normal Credit: Passivos).
   * Dr Opening Equity Account (-PL Abertura)
   * Cr Target Account (+Passivo)
   */
  public static createLiabilityOpeningBalanceEntries(params: {
    targetAccountId: number;
    openingEquityAccountId: number;
    amount: Money256;
    description: string;
    authorizedByUserId: number;
  }): RawLedgerEntrySpec[] {
    return AccountingEntryPolicy.buildOpeningBalanceEntries({
      ...params,
      targetDirection: 'credit',
      equityDirection: 'debit',
      label: 'Liability',
    });
  }

  /**
   * Saldo de abertura para contas com natureza credora (Normal Credit: Patrimônio Líquido).
   * Dr Opening Equity Account (-PL Abertura)
   * Cr Target Account (+PL)
   */
  public static createEquityOpeningBalanceEntries(params: {
    targetAccountId: number;
    openingEquityAccountId: number;
    amount: Money256;
    description: string;
    authorizedByUserId: number;
  }): RawLedgerEntrySpec[] {
    return AccountingEntryPolicy.buildOpeningBalanceEntries({
      ...params,
      targetDirection: 'credit',
      equityDirection: 'debit',
      label: 'Equity',
    });
  }

  /**
   * 12. OPENING BALANCE:
   *
   * Fábrica despachante com suporte explícito a contas de Ativo (debit),
   * Passivo (credit) e Patrimônio Líquido (credit).
   * Assume 'asset' (ou 'debit') por default para retrocompatibilidade total.
   */
  public static createOpeningBalanceEntries(params: {
    targetAccountId: number;
    openingEquityAccountId: number;
    amount: Money256;
    description: string;
    authorizedByUserId: number;
    accountNature?: 'asset' | 'liability' | 'equity';
    normalBalance?: 'debit' | 'credit';
  }): RawLedgerEntrySpec[] {
    if (params.accountNature !== undefined) {
      if (
        params.accountNature !== 'asset' &&
        params.accountNature !== 'liability' &&
        params.accountNature !== 'equity'
      ) {
        throw new AccountingMatrixValidationError(
          'Natureza contábil inválida para abertura de saldo.'
        );
      }
    }

    if (params.normalBalance !== undefined) {
      if (params.normalBalance !== 'debit' && params.normalBalance !== 'credit') {
        throw new AccountingMatrixValidationError(
          'normalBalance inválido para abertura de saldo.'
        );
      }
    }

    if (params.accountNature === 'liability') {
      return AccountingEntryPolicy.createLiabilityOpeningBalanceEntries(params);
    }
    if (params.accountNature === 'equity') {
      return AccountingEntryPolicy.createEquityOpeningBalanceEntries(params);
    }
    if (params.accountNature === 'asset') {
      return AccountingEntryPolicy.createAssetOpeningBalanceEntries(params);
    }

    if (params.normalBalance === 'credit') {
      return AccountingEntryPolicy.createLiabilityOpeningBalanceEntries(params);
    }

    return AccountingEntryPolicy.createAssetOpeningBalanceEntries(params);
  }

  private static buildOpeningBalanceEntries(params: {
    targetAccountId: number;
    openingEquityAccountId: number;
    amount: Money256;
    description: string;
    authorizedByUserId: number;
    targetDirection: LedgerEntryDirection;
    equityDirection: LedgerEntryDirection;
    label: string;
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

    const targetDesc = `Opening ${params.label} ${
      params.targetDirection === 'debit' ? 'Debit' : 'Credit'
    } (AuthUser #${authorizedBy}): ${description}`;

    const equityDesc = `Opening Equity ${
      params.equityDirection === 'debit' ? 'Debit' : 'Credit'
    } (AuthUser #${authorizedBy}): ${description}`;

    const entries: RawLedgerEntrySpec[] = [
      AccountingEntryPolicy.createEntry({
        accountId: targetAcc,
        assetId: amount.assetId,
        entryType: params.targetDirection,
        amount,
        description: targetDesc,
      }),
      AccountingEntryPolicy.createEntry({
        accountId: equityAcc,
        assetId: amount.assetId,
        entryType: params.equityDirection,
        amount,
        description: equityDesc,
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
    entries: ReadonlyArray<RawLedgerEntrySpec> | RawLedgerEntrySpec[]
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
          'Tipo de lançamento inválido.'
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

    Object.freeze(entries);
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

    for (const entry of entries) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        throw new AccountingMatrixValidationError(
          'A transação original contém lançamentos contábeis malformados.'
        );
      }
      try {
        parsePositiveSafeIntegerId(entry.accountId, 'accountId');
        parsePositiveSafeIntegerId(entry.assetId, 'assetId');
      } catch {
        throw new AccountingMatrixValidationError(
          'Identificador físico inválido no lançamento contábil.'
        );
      }
      if (entry.direction !== 'debit' && entry.direction !== 'credit') {
        throw new AccountingMatrixValidationError(
          'Direção do lançamento contábil original inválida.'
        );
      }
      if (
        typeof entry.amountBaseUnits !== 'string' ||
        !/^(0|[1-9]\d*)$/.test(entry.amountBaseUnits)
      ) {
        throw new AccountingMatrixValidationError(
          'O valor-base do lançamento de receita é inválido.'
        );
      }
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

    const direction = raw.entryType ?? (raw as any).direction;

    if (!isLedgerEntryDirection(direction)) {
      throw new AccountingMatrixValidationError(
        'Tipo de lançamento inválido.'
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
        'entryType inválido.'
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

    return Object.freeze({
      accountId,
      assetId,
      entryType: params.entryType,
      amount,
      description,
    });
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
    try {
      return FinancialTextPolicy.normalizeSafeDescription(
        value,
        MAX_LEDGER_DESCRIPTION_LENGTH,
        'descrição do lançamento contábil'
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Descrição inválida.';
      throw new AccountingMatrixValidationError(msg);
    }
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

  /**
   * Calcula o delta assinado canônico Delta_normal(entry) de acordo com a classe contábil.
   *
   * Asset / Expense:
   *   debit  => +amount
   *   credit => -amount
   *
   * Liability / Equity / Revenue:
   *   credit => +amount
   *   debit  => -amount
   */
  public static calculateNormalDelta(
    accountClass: 'asset' | 'expense' | 'liability' | 'equity' | 'revenue',
    direction: 'debit' | 'credit',
    amount: bigint
  ): bigint {
    const isDebit = direction === 'debit';
    if (accountClass === 'asset' || accountClass === 'expense') {
      return isDebit ? amount : -amount;
    }
    return isDebit ? -amount : amount;
  }
}

