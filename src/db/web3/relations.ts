import { relations } from 'drizzle-orm';
import { web3Networks, smartContracts, wallets, web3Transactions } from './tables';
import { users } from '../user/tables';

/**
 * ============================================================================
 * WEB3 NETWORKS
 * ============================================================================
 */
export const web3NetworksRelations = relations(web3Networks, ({ many }) => ({
  wallets: many(wallets, { relationName: 'networkWallets' }),
  smartContracts: many(smartContracts, { relationName: 'networkContracts' }),
  transactions: many(web3Transactions, { relationName: 'networkTransactions' }),
}));

/**
 * ============================================================================
 * SMART CONTRACTS
 * ============================================================================
 */
export const smartContractsRelations = relations(smartContracts, ({ one }) => ({
  network: one(web3Networks, {
    fields: [smartContracts.networkId],
    references: [web3Networks.id],
    relationName: 'networkContracts',
  }),
}));

/**
 * ============================================================================
 * WALLETS
 * ============================================================================
 */
export const walletsRelations = relations(wallets, ({ one, many }) => ({
  user: one(users, {
    fields: [wallets.userId],
    references: [users.id],
    relationName: 'walletOwner',
  }),
  verifiedByUser: one(users, {
    fields: [wallets.verifiedBy],
    references: [users.id],
    relationName: 'walletVerifier',
  }),
  network: one(web3Networks, {
    fields: [wallets.networkId],
    references: [web3Networks.id],
    relationName: 'networkWallets',
  }),
  
  /**
   * Controller wallet mapping (Composite FK linking networkId)
   */
  controllerWallet: one(wallets, {
    fields: [wallets.controllerWalletId, wallets.networkId],
    references: [wallets.id, wallets.networkId],
    relationName: 'walletController',
  }),

  /**
   * Smart-contract wallets controlled by this wallet.
   */
  controlledWallets: many(wallets, {
    relationName: 'walletController',
  }),
  
  transactions: many(web3Transactions, {
    relationName: 'walletTransactions',
  }),
}));

/**
 * ============================================================================
 * WEB3 TRANSACTIONS
 * ============================================================================
 */
export const web3TransactionsRelations = relations(
  web3Transactions,
  ({ one, many }) => ({
    /**
     * Network on which the transaction exists.
     */
    network: one(web3Networks, {
      fields: [web3Transactions.networkId],
      references: [web3Networks.id],
      relationName: 'networkTransactions',
    }),

    /**
     * Wallet responsible for the transaction.
     */
    wallet: one(wallets, {
      fields: [
        web3Transactions.walletId,
        web3Transactions.networkId,
      ],
      references: [
        wallets.id,
        wallets.networkId,
      ],
      relationName: 'walletTransactions',
    }),

    /**
     * Transaction that this transaction replaces.
     */
    replacementOf: one(web3Transactions, {
      fields: [
        web3Transactions.replacementOfTransactionId,
      ],
      references: [
        web3Transactions.id,
      ],
      relationName: 'transactionReplacement',
    }),

    /**
     * Transactions that replaced this transaction.
     */
    replacedTransactions: many(web3Transactions, {
      relationName: 'transactionReplacement',
    }),
  }),
);
