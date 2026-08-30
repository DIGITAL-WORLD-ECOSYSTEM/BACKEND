import { relations } from 'drizzle-orm';
import { users } from '../user/tables';
import {
  financialAssets,
  financialAccounts,
  financialTransactions,
  financialLedgerEntries,
  accountBalances,
  balanceHolds,
} from './tables';
import { idempotencyKeys } from '../infrastructure/tables';

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
}));

// financialTransactions
export const financialTransactionsRelations = relations(financialTransactions, ({ one, many }) => ({
  user: one(users, {
    fields: [financialTransactions.userId],
    references: [users.id],
  }),
  ledgerEntries: many(financialLedgerEntries),
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

// idempotencyKeys (Cross-domain relation setup)
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
