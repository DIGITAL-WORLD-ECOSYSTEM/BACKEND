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
 *     └── Fiat Payment Methods
 *
 *   Financial Asset
 *     ├── Ledger Entries
 *     ├── Account Balances
 *     ├── Balance Holds
 *     ├── Fiat Accounts
 *     ├── Fiat Transactions
 *     ├── Crypto Transactions
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
 *     └── Refund Source / Refunds
 *
 *   Fiat Provider
 *     ├── Fiat Accounts
 *     ├── Fiat Transactions
 *     ├── External Transactions
 *     └── Reconciliation Records
 *
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

    cryptoTransactions: many(cryptoTransactions),

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

    asset: one(financialAssets, {
      fields: [cryptoTransactions.assetId],
      references: [financialAssets.id],
    }),
  }),
);

/* ============================================================================
 * EXCHANGE RATES
 * ========================================================================== */

export const exchangeRatesRelations = relations(
  exchangeRates,
  ({ one }) => ({
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
