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
  idempotencyKeys,
  reconciliationRecords,
} from './tables';

/**
 * ============================================================================
 * FINANCE DOMAIN RELATIONS
 * ============================================================================
 * ARCHITECTURAL NOTE:
 * Navigation from users to finance entities is intentionally one-directional
 * (child → parent only), per Section 05 boundary isolation matrix.
 * Direct queries on finance tables should be executed with { with: { user: true } }
 * instead of querying bidirectionally from users.
 * ============================================================================
 */

// financialAssets
export const financialAssetsRelations = relations(financialAssets, ({ many }) => ({
  financialLedgerEntries: many(financialLedgerEntries),
  accountBalances: many(accountBalances),
  balanceHolds: many(balanceHolds),
  cryptoTransactionsAsAsset: many(cryptoTransactions, { relationName: 'cryptoTransactionAsset' }),
  cryptoTransactionsAsFeeAsset: many(cryptoTransactions, {
    relationName: 'cryptoTransactionFeeAsset',
  }),
  exchangeRatesAsBase: many(exchangeRates, { relationName: 'exchangeRateBaseAsset' }),
  exchangeRatesAsQuote: many(exchangeRates, { relationName: 'exchangeRateQuoteAsset' }),
  assetConversionsAsFrom: many(assetConversions, { relationName: 'assetConversionFromAsset' }),
  assetConversionsAsTo: many(assetConversions, { relationName: 'assetConversionToAsset' }),
  financialFees: many(financialFees),
  reconciliationRecords: many(reconciliationRecords),
}));

// financialAccounts
export const financialAccountsRelations = relations(financialAccounts, ({ one, many }) => ({
  user: one(users, {
    fields: [financialAccounts.userId],
    references: [users.id],
  }),
  financialLedgerEntries: many(financialLedgerEntries),
  accountBalances: many(accountBalances),
  balanceHolds: many(balanceHolds),
  financialFeesReceived: many(financialFees),
  reconciliationRecords: many(reconciliationRecords),
}));

// financialTransactions
export const financialTransactionsRelations = relations(financialTransactions, ({ one, many }) => ({
  user: one(users, {
    fields: [financialTransactions.userId],
    references: [users.id],
  }),
  ledgerEntries: many(financialLedgerEntries),
  fiatTransaction: one(fiatTransactions),
  cryptoTransaction: one(cryptoTransactions),
  assetConversion: one(assetConversions),
  fees: many(financialFees),
  idempotencyKeys: many(idempotencyKeys),
}));

// financialLedgerEntries
export const financialLedgerEntriesRelations = relations(financialLedgerEntries, ({ one }) => ({
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
}));

// accountBalances
export const accountBalancesRelations = relations(accountBalances, ({ one }) => ({
  account: one(financialAccounts, {
    fields: [accountBalances.accountId],
    references: [financialAccounts.id],
  }),
  asset: one(financialAssets, {
    fields: [accountBalances.assetId],
    references: [financialAssets.id],
  }),
}));

// balanceHolds
export const balanceHoldsRelations = relations(balanceHolds, ({ one }) => ({
  account: one(financialAccounts, {
    fields: [balanceHolds.accountId],
    references: [financialAccounts.id],
  }),
  asset: one(financialAssets, {
    fields: [balanceHolds.assetId],
    references: [financialAssets.id],
  }),
}));

// fiatProviders
export const fiatProvidersRelations = relations(fiatProviders, ({ many }) => ({
  fiatAccounts: many(fiatAccounts),
  fiatTransactions: many(fiatTransactions),
  fiatExternalTransactions: many(fiatExternalTransactions),
  reconciliationRecords: many(reconciliationRecords),
}));

// fiatAccounts
export const fiatAccountsRelations = relations(fiatAccounts, ({ one, many }) => ({
  user: one(users, {
    fields: [fiatAccounts.userId],
    references: [users.id],
  }),
  provider: one(fiatProviders, {
    fields: [fiatAccounts.providerId],
    references: [fiatProviders.id],
  }),
  asset: one(financialAssets, {
    fields: [fiatAccounts.assetId],
    references: [financialAssets.id],
  }),
  paymentMethods: many(fiatPaymentMethods),
}));

// fiatPaymentMethods
export const fiatPaymentMethodsRelations = relations(fiatPaymentMethods, ({ one }) => ({
  user: one(users, {
    fields: [fiatPaymentMethods.userId],
    references: [users.id],
  }),
  fiatAccount: one(fiatAccounts, {
    fields: [fiatPaymentMethods.fiatAccountId],
    references: [fiatAccounts.id],
  }),
}));

// fiatTransactions
export const fiatTransactionsRelations = relations(fiatTransactions, ({ one }) => ({
  transaction: one(financialTransactions, {
    fields: [fiatTransactions.financialTransactionId],
    references: [financialTransactions.id],
  }),
  paymentMethod: one(fiatPaymentMethods, {
    fields: [fiatTransactions.paymentMethodId],
    references: [fiatPaymentMethods.id],
  }),
  asset: one(financialAssets, {
    fields: [fiatTransactions.assetId],
    references: [financialAssets.id],
  }),
  provider: one(fiatProviders, {
    fields: [fiatTransactions.providerId],
    references: [fiatProviders.id],
  }),
}));

// cryptoTransactions
export const cryptoTransactionsRelations = relations(cryptoTransactions, ({ one }) => ({
  transaction: one(financialTransactions, {
    fields: [cryptoTransactions.financialTransactionId],
    references: [financialTransactions.id],
  }),
  asset: one(financialAssets, {
    fields: [cryptoTransactions.assetId],
    references: [financialAssets.id],
    relationName: 'cryptoTransactionAsset',
  }),
  feeAsset: one(financialAssets, {
    fields: [cryptoTransactions.feeAssetId],
    references: [financialAssets.id],
    relationName: 'cryptoTransactionFeeAsset',
  }),
}));

// exchangeRates
export const exchangeRatesRelations = relations(exchangeRates, ({ one }) => ({
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
}));

// assetConversions
export const assetConversionsRelations = relations(assetConversions, ({ one }) => ({
  transaction: one(financialTransactions, {
    fields: [assetConversions.financialTransactionId],
    references: [financialTransactions.id],
  }),
  fromAsset: one(financialAssets, {
    fields: [assetConversions.fromAssetId],
    references: [financialAssets.id],
    relationName: 'assetConversionFromAsset',
  }),
  toAsset: one(financialAssets, {
    fields: [assetConversions.toAssetId],
    references: [financialAssets.id],
    relationName: 'assetConversionToAsset',
  }),
}));

// financialFees
export const financialFeesRelations = relations(financialFees, ({ one }) => ({
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
}));

// fiatExternalTransactions
export const fiatExternalTransactionsRelations = relations(fiatExternalTransactions, ({ one }) => ({
  transaction: one(financialTransactions, {
    fields: [fiatExternalTransactions.financialTransactionId],
    references: [financialTransactions.id],
  }),
  provider: one(fiatProviders, {
    fields: [fiatExternalTransactions.providerId],
    references: [fiatProviders.id],
  }),
}));

// idempotencyKeys
export const idempotencyKeysRelations = relations(idempotencyKeys, ({ one }) => ({
  user: one(users, {
    fields: [idempotencyKeys.userId],
    references: [users.id],
  }),
  financialTransaction: one(financialTransactions, {
    fields: [idempotencyKeys.financialTransactionId],
    references: [financialTransactions.id],
  }),
}));

// reconciliationRecords
export const reconciliationRecordsRelations = relations(reconciliationRecords, ({ one }) => ({
  account: one(financialAccounts, {
    fields: [reconciliationRecords.accountId],
    references: [financialAccounts.id],
  }),
  asset: one(financialAssets, {
    fields: [reconciliationRecords.assetId],
    references: [financialAssets.id],
  }),
  provider: one(fiatProviders, {
    fields: [reconciliationRecords.providerId],
    references: [fiatProviders.id],
  }),
}));
