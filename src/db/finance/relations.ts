import { relations } from 'drizzle-orm';
import { users } from '../user/tables';

import {
  financialAssets,
  financialAccounts,
  financialTransactions,
  financialLedgerEntries,
  accountBalances,
  balanceHolds,
  fiatProviders,
  fiatAccounts,
  fiatPaymentMethods,
  fiatTransactions,
  cryptoTransactions,
  exchangeRates,
  assetConversions,
  financialFees,
  fiatExternalTransactions,
  reconciliationRecords,
} from './tables';

import { idempotencyKeys } from '../infrastructure/tables';

/**
 * ============================================================================
 * FINANCE DOMAIN RELATIONS
 * ============================================================================
 *
 * PURPOSE:
 *   Define somente navegação ORM entre entidades.
 *
 * IMPORTANT:
 *   Regras de negócio, invariantes contábeis, autorização, validação de saldo,
 *   idempotência, lifecycle e reconciliação continuam pertencendo às camadas
 *   apropriadas do domínio/aplicação/infraestrutura.
 *
 * ARCHITECTURAL NOTE:
 *   A navegação Finance -> User é intencionalmente unidirecional.
 *   Não é necessário declarar relações Finance dentro de users para consultar
 *   Finance.
 *
 * FINANCIAL MODEL:
 *
 *   User
 *     ├── Financial Accounts
 *     ├── Financial Transactions
 *     ├── Fiat Accounts
 *     ├── Fiat Payment Methods
 *     └── Reconciliation Records (as resolver)
 *
 *   Financial Asset
 *     ├── Ledger Entries
 *     ├── Account Balances
 *     ├── Balance Holds
 *     ├── Fiat Accounts
 *     ├── Fiat Transactions
 *     ├── Crypto Transactions (as primary asset)
 *     ├── Crypto Transactions (as fee asset)
 *     ├── Exchange Rates
 *     ├── Asset Conversions
 *     ├── Financial Fees
 *     └── Reconciliation Records
 *
 *   Financial Account
 *     ├── Ledger Entries
 *     ├── Account Balances
 *     ├── Balance Holds
 *     ├── Financial Fees
 *     └── Reconciliation Records
 *
 *   Financial Transaction
 *     ├── Ledger Entries
 *     ├── Idempotency Keys
 *     ├── Fiat Transaction (1:1)
 *     ├── Crypto Transaction (1:1)
 *     ├── Asset Conversion (1:1)
 *     ├── Financial Fees
 *     ├── External Transactions
 *     ├── Reversal Source / Reversals
 *     ├── Refund Source / Refunds
 *     ├── Balance Holds Released (by this transaction)
 *     └── Balance Holds Consumed (by this transaction)
 *
 *   Fiat Provider
 *     ├── Fiat Accounts
 *     ├── Fiat Transactions
 *     ├── External Transactions
 *     └── Reconciliation Records
 *
 * ============================================================================
 * AUDIT CHANGELOG (applied on top of the previous revision)
 * ============================================================================
 * 1. cryptoTransactions has TWO foreign keys into financialAssets (assetId
 *    and feeAssetId), but only `assetId` was modeled, and the reverse
 *    relation on financialAssetsRelations had no relationName — an
 *    ambiguous relation exactly like the one already solved for
 *    exchangeRates (base/quote) and assetConversions (from/to). Fixed by
 *    adding `feeAsset` here and splitting the reverse `many()` into two
 *    disambiguated relations on financialAssetsRelations.
 * 2. balanceHolds has two additional FKs into financialTransactions
 *    (releasedByTransactionId, consumedByTransactionId) that were not
 *    modeled at all. Added, disambiguated with relationName since both
 *    point at financialTransactions alongside no competing relation there
 *    previously — relationName added defensively for clarity and to allow
 *    the reverse `many()` on financialTransactionsRelations.
 * 3. reconciliationRecords.resolvedByUserId (FK into users) was not
 *    modeled. Added as `resolvedByUser`.
 * 4. financialTransactionsRelations gained the reverse `many()` sides for
 *    the two new balanceHolds relations (#2 above), matching the existing
 *    pattern used for reversals/refunds self-references.
 * ============================================================================
 */

/* ============================================================================
 * FINANCIAL ASSETS
 * ========================================================================== */

export const financialAssetsRelations = relations(
  financialAssets,
  ({ many }) => ({
    financialLedgerEntries: many(financialLedgerEntries),

    accountBalances: many(accountBalances),

    balanceHolds: many(balanceHolds),

    fiatAccounts: many(fiatAccounts),

    fiatTransactions: many(fiatTransactions),

    /**
     * [AUDIT FIX #1]
     * cryptoTransactions references financialAssets twice (assetId and
     * feeAssetId). Split into two disambiguated reverse relations mirroring
     * the `relationName`s declared on cryptoTransactionsRelations below.
     */
    cryptoTransactionsAsAsset: many(cryptoTransactions, {
      relationName: 'cryptoTransactionAsset',
    }),

    cryptoTransactionsAsFeeAsset: many(cryptoTransactions, {
      relationName: 'cryptoTransactionFeeAsset',
    }),

    baseExchangeRates: many(exchangeRates, {
      relationName: 'exchangeRateBaseAsset',
    }),

    quoteExchangeRates: many(exchangeRates, {
      relationName: 'exchangeRateQuoteAsset',
    }),

    sourceAssetConversions: many(assetConversions, {
      relationName: 'conversionFromAsset',
    }),

    destinationAssetConversions: many(assetConversions, {
      relationName: 'conversionToAsset',
    }),

    financialFees: many(financialFees),

    reconciliationRecords: many(reconciliationRecords),
  }),
);

/* ============================================================================
 * FINANCIAL ACCOUNTS
 * ========================================================================== */

export const financialAccountsRelations = relations(
  financialAccounts,
  ({ one, many }) => ({
    user: one(users, {
      fields: [financialAccounts.userId],
      references: [users.id],
    }),

    financialLedgerEntries: many(financialLedgerEntries),

    accountBalances: many(accountBalances),

    balanceHolds: many(balanceHolds),

    financialFees: many(financialFees),

    reconciliationRecords: many(reconciliationRecords),
  }),
);

/* ============================================================================
 * FINANCIAL TRANSACTIONS
 * ========================================================================== */

export const financialTransactionsRelations = relations(
  financialTransactions,
  ({ one, many }) => ({
    /* ------------------------------------------------------------------------
     * Owner
     * ---------------------------------------------------------------------- */

    user: one(users, {
      fields: [financialTransactions.userId],
      references: [users.id],
    }),

    /* ------------------------------------------------------------------------
     * Double-entry ledger
     * ---------------------------------------------------------------------- */

    ledgerEntries: many(financialLedgerEntries),

    /* ------------------------------------------------------------------------
     * Idempotency
     * ---------------------------------------------------------------------- */

    idempotencyKeys: many(idempotencyKeys),

    /* ------------------------------------------------------------------------
     * Self-reference: reversal
     *
     * reversalOfTransactionId -> original transaction
     *
     * original transaction -> reversals
     * ---------------------------------------------------------------------- */

    reversalOfTransaction: one(financialTransactions, {
      fields: [financialTransactions.reversalOfTransactionId],
      references: [financialTransactions.id],
      relationName: 'transactionReversal',
    }),

    reversals: many(financialTransactions, {
      relationName: 'transactionReversal',
    }),

    /* ------------------------------------------------------------------------
     * Self-reference: refund
     *
     * refundOfTransactionId -> original transaction
     *
     * original transaction -> refunds
     * ---------------------------------------------------------------------- */

    refundOfTransaction: one(financialTransactions, {
      fields: [financialTransactions.refundOfTransactionId],
      references: [financialTransactions.id],
      relationName: 'transactionRefund',
    }),

    refunds: many(financialTransactions, {
      relationName: 'transactionRefund',
    }),

    /* ------------------------------------------------------------------------
     * Specialized financial operations
     * ---------------------------------------------------------------------- */

    fiatTransaction: one(fiatTransactions, {
      fields: [financialTransactions.id],
      references: [fiatTransactions.financialTransactionId],
    }),

    cryptoTransaction: one(cryptoTransactions, {
      fields: [financialTransactions.id],
      references: [cryptoTransactions.financialTransactionId],
    }),

    assetConversion: one(assetConversions, {
      fields: [financialTransactions.id],
      references: [assetConversions.financialTransactionId],
    }),

    /* ------------------------------------------------------------------------
     * Fees
     * ---------------------------------------------------------------------- */

    financialFees: many(financialFees),

    /* ------------------------------------------------------------------------
     * Provider / external tracking
     * ---------------------------------------------------------------------- */

    fiatExternalTransactions: many(fiatExternalTransactions),

    /* ------------------------------------------------------------------------
     * [AUDIT FIX #4]
     * Reverse sides of balanceHolds.releasedByTransactionId /
     * consumedByTransactionId (see AUDIT FIX #2 on balanceHoldsRelations).
     * A financial transaction may be the one that released or consumed one
     * or more balance holds (e.g. a payment transaction consuming a hold
     * previously placed on the payer's account).
     * ---------------------------------------------------------------------- */

    releasedBalanceHolds: many(balanceHolds, {
      relationName: 'balanceHoldRelease',
    }),

    consumedBalanceHolds: many(balanceHolds, {
      relationName: 'balanceHoldConsume',
    }),
  }),
);

/* ============================================================================
 * FINANCIAL LEDGER ENTRIES
 * ========================================================================== */

export const financialLedgerEntriesRelations = relations(
  financialLedgerEntries,
  ({ one }) => ({
    transaction: one(financialTransactions, {
      fields: [financialLedgerEntries.transactionId],
      references: [financialTransactions.id],
    }),

    account: one(financialAccounts, {
      fields: [financialLedgerEntries.accountId],
      references: [financialAccounts.id],
    }),

    asset: one(financialAssets, {
      fields: [financialLedgerEntries.assetId],
      references: [financialAssets.id],
    }),
  }),
);

/* ============================================================================
 * ACCOUNT BALANCES
 * ========================================================================== */

export const accountBalancesRelations = relations(
  accountBalances,
  ({ one }) => ({
    account: one(financialAccounts, {
      fields: [accountBalances.accountId],
      references: [financialAccounts.id],
    }),

    asset: one(financialAssets, {
      fields: [accountBalances.assetId],
      references: [financialAssets.id],
    }),
  }),
);

/* ============================================================================
 * BALANCE HOLDS
 * ========================================================================== */

export const balanceHoldsRelations = relations(
  balanceHolds,
  ({ one }) => ({
    account: one(financialAccounts, {
      fields: [balanceHolds.accountId],
      references: [financialAccounts.id],
    }),

    asset: one(financialAssets, {
      fields: [balanceHolds.assetId],
      references: [financialAssets.id],
    }),

    /**
     * [AUDIT FIX #2]
     * Both FKs point at financialTransactions, so each needs its own
     * relationName to disambiguate — mirroring the pattern already used for
     * the reversal/refund self-references on financialTransactionsRelations.
     */
    releasedByTransaction: one(financialTransactions, {
      fields: [balanceHolds.releasedByTransactionId],
      references: [financialTransactions.id],
      relationName: 'balanceHoldRelease',
    }),

    consumedByTransaction: one(financialTransactions, {
      fields: [balanceHolds.consumedByTransactionId],
      references: [financialTransactions.id],
      relationName: 'balanceHoldConsume',
    }),
  }),
);

/* ============================================================================
 * FIAT PROVIDERS
 * ========================================================================== */

export const fiatProvidersRelations = relations(
  fiatProviders,
  ({ many }) => ({
    fiatAccounts: many(fiatAccounts),

    fiatTransactions: many(fiatTransactions),

    fiatExternalTransactions: many(fiatExternalTransactions),

    reconciliationRecords: many(reconciliationRecords),
  }),
);

/* ============================================================================
 * FIAT ACCOUNTS
 * ========================================================================== */

export const fiatAccountsRelations = relations(
  fiatAccounts,
  ({ one, many }) => ({
    user: one(users, {
      fields: [fiatAccounts.userId],
      references: [users.id],
    }),

    asset: one(financialAssets, {
      fields: [fiatAccounts.assetId],
      references: [financialAssets.id],
    }),

    provider: one(fiatProviders, {
      fields: [fiatAccounts.providerId],
      references: [fiatProviders.id],
    }),

    paymentMethods: many(fiatPaymentMethods),
  }),
);

/* ============================================================================
 * FIAT PAYMENT METHODS
 * ========================================================================== */

export const fiatPaymentMethodsRelations = relations(
  fiatPaymentMethods,
  ({ one, many }) => ({
    user: one(users, {
      fields: [fiatPaymentMethods.userId],
      references: [users.id],
    }),

    /**
     * Composite FK:
     *
     *   fiatPaymentMethods.userId
     *   fiatPaymentMethods.fiatAccountId
     *
     * -> fiatAccounts.userId + fiatAccounts.id
     *
     * This preserves ownership coherence at the ORM relation level and
     * mirrors the composite foreign key defined in the table.
     */
    fiatAccount: one(fiatAccounts, {
      fields: [
        fiatPaymentMethods.userId,
        fiatPaymentMethods.fiatAccountId,
      ],
      references: [
        fiatAccounts.userId,
        fiatAccounts.id,
      ],
    }),

    fiatTransactions: many(fiatTransactions),
  }),
);

/* ============================================================================
 * FIAT TRANSACTIONS
 * ========================================================================== */

export const fiatTransactionsRelations = relations(
  fiatTransactions,
  ({ one }) => ({
    financialTransaction: one(financialTransactions, {
      fields: [fiatTransactions.financialTransactionId],
      references: [financialTransactions.id],
    }),

    provider: one(fiatProviders, {
      fields: [fiatTransactions.providerId],
      references: [fiatProviders.id],
    }),

    paymentMethod: one(fiatPaymentMethods, {
      fields: [fiatTransactions.paymentMethodId],
      references: [fiatPaymentMethods.id],
    }),

    asset: one(financialAssets, {
      fields: [fiatTransactions.assetId],
      references: [financialAssets.id],
    }),
  }),
);

/* ============================================================================
 * CRYPTO TRANSACTIONS
 * ========================================================================== */

export const cryptoTransactionsRelations = relations(
  cryptoTransactions,
  ({ one }) => ({
    financialTransaction: one(financialTransactions, {
      fields: [cryptoTransactions.financialTransactionId],
      references: [financialTransactions.id],
    }),

    /**
     * [AUDIT FIX #1]
     * Primary asset moved (transferred) by this crypto transaction.
     * relationName required because feeAsset below also targets
     * financialAssets.
     */
    asset: one(financialAssets, {
      fields: [cryptoTransactions.assetId],
      references: [financialAssets.id],
      relationName: 'cryptoTransactionAsset',
    }),

    /**
     * [AUDIT FIX #1]
     * Asset the network fee was paid in, when different from (or the same
     * as) the primary asset. Previously unmodeled entirely.
     */
    feeAsset: one(financialAssets, {
      fields: [cryptoTransactions.feeAssetId],
      references: [financialAssets.id],
      relationName: 'cryptoTransactionFeeAsset',
    }),
  }),
);

/* ============================================================================
 * EXCHANGE RATES
 * ========================================================================== */

export const exchangeRatesRelations = relations(
  exchangeRates,
  ({ one, many }) => ({
    baseAsset: one(financialAssets, {
      fields: [exchangeRates.baseAssetId],
      references: [financialAssets.id],
      relationName: 'exchangeRateBaseAsset',
    }),

    quoteAsset: one(financialAssets, {
      fields: [exchangeRates.quoteAssetId],
      references: [financialAssets.id],
      relationName: 'exchangeRateQuoteAsset',
    }),

    /**
     * Reverse side of assetConversions.sourceExchangeRateId: conversions
     * that snapshotted their rate from this exchangeRates row.
     */
    sourcedAssetConversions: many(assetConversions),
  }),
);

/* ============================================================================
 * ASSET CONVERSIONS
 * ========================================================================== */

export const assetConversionsRelations = relations(
  assetConversions,
  ({ one }) => ({
    financialTransaction: one(financialTransactions, {
      fields: [assetConversions.financialTransactionId],
      references: [financialTransactions.id],
    }),

    fromAsset: one(financialAssets, {
      fields: [assetConversions.fromAssetId],
      references: [financialAssets.id],
      relationName: 'conversionFromAsset',
    }),

    toAsset: one(financialAssets, {
      fields: [assetConversions.toAssetId],
      references: [financialAssets.id],
      relationName: 'conversionToAsset',
    }),

    /**
     * Optional traceability pointer back to the exchangeRates snapshot used
     * to price this conversion (see tables.ts AUDIT FIX #6).
     */
    sourceExchangeRate: one(exchangeRates, {
      fields: [assetConversions.sourceExchangeRateId],
      references: [exchangeRates.id],
    }),
  }),
);

/* ============================================================================
 * FINANCIAL FEES
 * ========================================================================== */

export const financialFeesRelations = relations(
  financialFees,
  ({ one }) => ({
    transaction: one(financialTransactions, {
      fields: [financialFees.transactionId],
      references: [financialTransactions.id],
    }),

    asset: one(financialAssets, {
      fields: [financialFees.assetId],
      references: [financialAssets.id],
    }),

    recipientAccount: one(financialAccounts, {
      fields: [financialFees.recipientAccountId],
      references: [financialAccounts.id],
    }),
  }),
);

/* ============================================================================
 * FIAT EXTERNAL TRANSACTIONS
 * ========================================================================== */

export const fiatExternalTransactionsRelations = relations(
  fiatExternalTransactions,
  ({ one }) => ({
    financialTransaction: one(financialTransactions, {
      fields: [fiatExternalTransactions.financialTransactionId],
      references: [financialTransactions.id],
    }),

    provider: one(fiatProviders, {
      fields: [fiatExternalTransactions.providerId],
      references: [fiatProviders.id],
    }),
  }),
);

/* ============================================================================
 * RECONCILIATION RECORDS
 * ========================================================================== */

export const reconciliationRecordsRelations = relations(
  reconciliationRecords,
  ({ one }) => ({
    provider: one(fiatProviders, {
      fields: [reconciliationRecords.providerId],
      references: [fiatProviders.id],
    }),

    account: one(financialAccounts, {
      fields: [reconciliationRecords.accountId],
      references: [financialAccounts.id],
    }),

    asset: one(financialAssets, {
      fields: [reconciliationRecords.assetId],
      references: [financialAssets.id],
    }),

    /**
     * [AUDIT FIX #3]
     * Reverse side of reconciliationRecords.resolvedByUserId — previously
     * unmodeled. Only populated once status = 'resolved' (see
     * ck_reconciliation_resolved_state in tables.ts).
     */
    resolvedByUser: one(users, {
      fields: [reconciliationRecords.resolvedByUserId],
      references: [users.id],
    }),
  }),
);

/* ============================================================================
 * IDEMPOTENCY KEYS
 * ========================================================================== */

export const idempotencyKeysRelations = relations(
  idempotencyKeys,
  ({ one }) => ({
    user: one(users, {
      fields: [idempotencyKeys.userId],
      references: [users.id],
    }),

    financialTransaction: one(financialTransactions, {
      fields: [idempotencyKeys.financialTransactionId],
      references: [financialTransactions.id],
    }),
  }),
);
