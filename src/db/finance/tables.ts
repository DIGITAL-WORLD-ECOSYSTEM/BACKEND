import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
  check,
  foreignKey,
} from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

import { users } from '../user/tables';

/**
 * ============================================================================
 * FINANCE DOMAIN
 * ============================================================================
 *
 * Responsibilities:
 * - Financial assets supported by the platform
 * - Financial accounts (with explicit accountClass)
 * - Financial transactions
 * - Double-entry ledger (per-asset balance invariant)
 * - Account balances (D1 binding safe max 9,007,199,254,740,991)
 * - Balance holds
 * - Fiat providers / accounts / payment operations
 * - Crypto financial operations
 * - Asset conversions (exact rational rates)
 * - Fees
 * - External transaction references
 * - Idempotency
 * - Reconciliation
 * ============================================================================
 */

export const MAX_BINDING_SAFE_BASE_UNITS = 9007199254740991; // Number.MAX_SAFE_INTEGER (2^53 - 1)

/* ============================================================================
 * 1. FINANCIAL ASSETS
 * ============================================================================
 */
export const financialAssets = sqliteTable(
  'financial_assets',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    code: text('code').notNull(),
    symbol: text('symbol').notNull(),
    name: text('name').notNull(),
    type: text('type', {
      enum: ['fiat', 'crypto'],
    }).notNull(),
    decimals: integer('decimals').notNull(),
    status: text('status', {
      enum: ['active', 'inactive'],
    })
      .notNull()
      .default('active'),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdateFn(() => new Date()),
  },
  (table) => ({
    codeUq: uniqueIndex('uq_financial_assets_code').on(table.code),
    typeIdx: index('idx_financial_assets_type').on(table.type),
    statusIdx: index('idx_financial_assets_status').on(table.status),
    typeCheck: check('ck_financial_assets_type', sql`${table.type} IN ('fiat', 'crypto')`),
    statusCheck: check(
      'ck_financial_assets_status',
      sql`${table.status} IN ('active', 'inactive')`
    ),
    decimalsCheck: check(
      'ck_financial_assets_decimals',
      sql`${table.decimals} >= 0 AND ${table.decimals} <= 18`
    ),
  })
);

/* ============================================================================
 * 2. FINANCIAL ACCOUNTS
 * ============================================================================
 */
export const financialAccounts = sqliteTable(
  'financial_accounts',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id').references(() => users.id, {
      onDelete: 'restrict',
    }),
    accountType: text('account_type', {
      enum: [
        'user_available',
        'treasury',
        'operating',
        'reserve',
        'fees',
        'escrow',
        'reward_expense',
        'yield_expense',
        'clearing',
        'opening_balance_equity',
        'payment_revenue',
        'refund_expense',
      ],
    }).notNull(),
    accountClass: text('account_class', {
      enum: ['asset', 'liability', 'equity', 'revenue', 'expense'],
    }).notNull().default('liability'),
    status: text('status', {
      enum: ['active', 'inactive', 'suspended'],
    })
      .notNull()
      .default('active'),
    name: text('name').notNull(),
    version: integer('version').notNull().default(1),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdateFn(() => new Date()),
  },
  (table) => ({
    userIdx: index('idx_financial_accounts_user').on(table.userId),
    typeIdx: index('idx_financial_accounts_type').on(table.accountType),
    classIdx: index('idx_financial_accounts_class').on(table.accountClass),
    statusIdx: index('idx_financial_accounts_status').on(table.status),
    accountTypeCheck: check(
      'ck_financial_accounts_type',
      sql`${table.accountType} IN ('user_available', 'treasury', 'operating', 'reserve', 'fees', 'escrow', 'reward_expense', 'yield_expense', 'clearing', 'opening_balance_equity', 'payment_revenue', 'refund_expense')`
    ),
    accountClassCheck: check(
      'ck_financial_accounts_class',
      sql`${table.accountClass} IN ('asset', 'liability', 'equity', 'revenue', 'expense')`
    ),
    statusCheck: check(
      'ck_financial_accounts_status',
      sql`${table.status} IN ('active', 'inactive', 'suspended')`
    ),
    userAccountTypeUq: uniqueIndex('uq_financial_accounts_user_type_name').on(
      table.userId,
      table.accountType,
      table.name
    ),
    activeTreasurySingletonUnq: uniqueIndex('uq_treasury_active_singleton')
      .on(table.accountType)
      .where(sql`${table.accountType} = 'treasury' AND ${table.status} = 'active'`),
    activeOperatingSingletonUnq: uniqueIndex('uq_operating_active_singleton')
      .on(table.accountType)
      .where(sql`${table.accountType} = 'operating' AND ${table.status} = 'active'`),
    activeFeesSingletonUnq: uniqueIndex('uq_fees_active_singleton')
      .on(table.accountType)
      .where(sql`${table.accountType} = 'fees' AND ${table.status} = 'active'`),
    userAvailableSingletonUnq: uniqueIndex('uq_user_available_singleton')
      .on(table.userId)
      .where(sql`${table.accountType} = 'user_available'`),
    ownerRuleCheck: check(
      'ck_financial_accounts_owner_rule',
      sql`(${table.accountType} = 'user_available' AND ${table.userId} IS NOT NULL) OR (${table.accountType} != 'user_available' AND ${table.userId} IS NULL)`
    ),
    versionCheck: check('ck_financial_accounts_version', sql`${table.version} > 0`),
  })
);

/* ============================================================================
 * 3. FINANCIAL TRANSACTIONS
 * ============================================================================
 */
export const financialTransactions = sqliteTable(
  'financial_transactions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id').references(() => users.id, {
      onDelete: 'restrict',
    }),
    reversalOfTransactionId: integer('reversal_of_transaction_id'),
    type: text('type', {
      enum: [
        'deposit',
        'withdrawal',
        'transfer',
        'payment',
        'refund',
        'fee',
        'reward',
        'yield',
        'conversion',
        'adjustment',
        'reversal',
        'inbound',
        'outbound',
      ],
    }).notNull(),
    category: text('category', {
      enum: [
        'membership',
        'rwa_yield',
        'grant',
        'operational',
        'payment',
        'trading',
        'withdrawal',
        'deposit',
        'fee',
        'other',
      ],
    })
      .notNull()
      .default('other'),
    status: text('status', {
      enum: ['pending', 'processing', 'completed', 'failed', 'cancelled', 'reversed', 'refunded'],
    })
      .notNull()
      .default('pending'),
    sourceType: text('source_type', {
      enum: [
        'contribution',
        'grant',
        'membership',
        'payroll',
        'withdrawal',
        'payment',
        'conversion',
        'system',
        'other',
      ],
    }),
    sourceId: text('source_id'),
    correlationId: text('correlation_id'),
    description: text('description').notNull(),
    version: integer('version').notNull().default(1),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdateFn(() => new Date()),
    completedAt: integer('completed_at', { mode: 'timestamp' }),
  },
  (table) => ({
    userIdx: index('idx_financial_transactions_user').on(table.userId),
    typeIdx: index('idx_financial_transactions_type').on(table.type),
    statusIdx: index('idx_financial_transactions_status').on(table.status),
    createdIdx: index('idx_financial_transactions_created').on(table.createdAt),
    correlationIdx: index('idx_financial_transactions_correlation').on(table.correlationId),
    singleReversalUnq: uniqueIndex('uq_financial_tx_single_reversal')
      .on(table.reversalOfTransactionId)
      .where(sql`${table.reversalOfTransactionId} IS NOT NULL`),
    typeCheck: check(
      'ck_financial_tx_type',
      sql`${table.type} IN ('deposit', 'withdrawal', 'transfer', 'payment', 'refund', 'fee', 'reward', 'yield', 'conversion', 'adjustment', 'reversal', 'inbound', 'outbound')`
    ),
    categoryCheck: check(
      'ck_financial_tx_category',
      sql`${table.category} IN ('membership', 'rwa_yield', 'grant', 'operational', 'payment', 'trading', 'withdrawal', 'deposit', 'fee', 'other')`
    ),
    statusCheck: check(
      'ck_financial_tx_status',
      sql`${table.status} IN ('pending', 'processing', 'completed', 'failed', 'cancelled', 'reversed', 'refunded')`
    ),
    sourceTypeCheck: check(
      'ck_financial_tx_source_type',
      sql`${table.sourceType} IS NULL OR ${table.sourceType} IN ('contribution', 'grant', 'membership', 'payroll', 'withdrawal', 'payment', 'conversion', 'system', 'other')`
    ),
    completedStateCheck: check(
      'ck_financial_tx_completed_state',
      sql`${table.status} != 'completed' OR ${table.completedAt} IS NOT NULL`
    ),
    temporalOrderCheck: check(
      'ck_financial_tx_dates',
      sql`${table.completedAt} IS NULL OR ${table.completedAt} >= ${table.createdAt}`
    ),
    versionCheck: check('ck_financial_tx_version', sql`${table.version} > 0`),
  })
);

/* ============================================================================
 * 4. FINANCIAL LEDGER ENTRIES
 * ============================================================================
 */
export const financialLedgerEntries = sqliteTable(
  'financial_ledger_entries',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    transactionId: integer('transaction_id')
      .notNull()
      .references(() => financialTransactions.id, {
        onDelete: 'restrict',
      }),
    accountId: integer('account_id')
      .notNull()
      .references(() => financialAccounts.id, {
        onDelete: 'restrict',
      }),
    assetId: integer('asset_id')
      .notNull()
      .references(() => financialAssets.id, {
        onDelete: 'restrict',
      }),
    direction: text('direction', {
      enum: ['debit', 'credit'],
    }).notNull(),
    amountBaseUnits: text('amount_base_units').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    transactionIdx: index('idx_financial_ledger_entries_transaction').on(table.transactionId),
    accountIdx: index('idx_financial_ledger_entries_account').on(table.accountId),
    assetIdx: index('idx_financial_ledger_entries_asset').on(table.assetId),
    createdIdx: index('idx_financial_ledger_entries_created').on(table.createdAt),
    directionCheck: check(
      'ck_financial_ledger_direction',
      sql`${table.direction} IN ('debit', 'credit')`
    ),
    amountCheck: check(
      'ck_financial_ledger_entries_amount_range',
      sql`length(${table.amountBaseUnits}) > 0`
    ),
  })
);

/* ============================================================================
 * 5. ACCOUNT BALANCES
 * ============================================================================
 */
export const accountBalances = sqliteTable(
  'account_balances',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    accountId: integer('account_id')
      .notNull()
      .references(() => financialAccounts.id, {
        onDelete: 'restrict',
      }),
    assetId: integer('asset_id')
      .notNull()
      .references(() => financialAssets.id, {
        onDelete: 'restrict',
      }),
    availableBaseUnits: text('available_base_units').notNull().default('0'),
    lockedBaseUnits: text('locked_base_units').notNull().default('0'),
    version: integer('version').notNull().default(1),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdateFn(() => new Date()),
  },
  (table) => ({
    accountAssetUq: uniqueIndex('uq_account_balances_account_asset').on(
      table.accountId,
      table.assetId
    ),
    accountIdx: index('idx_account_balances_account').on(table.accountId),
    assetIdx: index('idx_account_balances_asset').on(table.assetId),
    availableCheck: check(
      'ck_account_balances_available_range',
      sql`length(${table.availableBaseUnits}) > 0`
    ),
    lockedCheck: check(
      'ck_account_balances_locked_range',
      sql`length(${table.lockedBaseUnits}) > 0`
    ),
    versionCheck: check('ck_account_balances_version', sql`${table.version} > 0`),
  })
);

/* ============================================================================
 * 6. BALANCE HOLDS
 * ============================================================================
 */
export const balanceHolds = sqliteTable(
  'balance_holds',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    accountId: integer('account_id')
      .notNull()
      .references(() => financialAccounts.id, {
        onDelete: 'restrict',
      }),
    assetId: integer('asset_id')
      .notNull()
      .references(() => financialAssets.id, {
        onDelete: 'restrict',
      }),
    amountBaseUnits: text('amount_base_units').notNull(),
    reason: text('reason').notNull(),
    referenceType: text('reference_type'),
    referenceId: text('reference_id'),
    status: text('status', {
      enum: ['active', 'released', 'expired', 'consumed'],
    })
      .notNull()
      .default('active'),
    version: integer('version').notNull().default(1),
    expiresAt: integer('expires_at', { mode: 'timestamp' }),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdateFn(() => new Date()),
    releasedAt: integer('released_at', { mode: 'timestamp' }),
  },
  (table) => ({
    accountIdx: index('idx_balance_holds_account').on(table.accountId),
    assetIdx: index('idx_balance_holds_asset').on(table.assetId),
    statusIdx: index('idx_balance_holds_status').on(table.status),
    referenceIdx: index('idx_balance_holds_reference').on(table.referenceType, table.referenceId),
    statusCheck: check(
      'ck_balance_holds_status',
      sql`${table.status} IN ('active', 'released', 'expired', 'consumed')`
    ),
    amountCheck: check(
      'ck_balance_holds_amount_range',
      sql`${table.amountBaseUnits} != ''`
    ),
    releasedStateCheck: check(
      'ck_balance_holds_released_state',
      sql`${table.status} != 'released' OR ${table.releasedAt} IS NOT NULL`
    ),
    expiredStateCheck: check(
      'ck_balance_holds_expired_state',
      sql`${table.status} != 'expired' OR ${table.expiresAt} IS NOT NULL`
    ),
    versionCheck: check('ck_balance_holds_version', sql`${table.version} > 0`),
  })
);

/* ============================================================================
 * 7. FIAT PROVIDERS
 * ============================================================================
 */
export const fiatProviders = sqliteTable(
  'fiat_providers',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    code: text('code').notNull(),
    type: text('type', {
      enum: ['bank', 'payment_provider', 'pix_provider', 'gateway'],
    }).notNull(),
    status: text('status', {
      enum: ['active', 'inactive', 'suspended'],
    })
      .notNull()
      .default('active'),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdateFn(() => new Date()),
  },
  (table) => ({
    codeUq: uniqueIndex('uq_fiat_providers_code').on(table.code),
    typeIdx: index('idx_fiat_providers_type').on(table.type),
    statusIdx: index('idx_fiat_providers_status').on(table.status),
    typeCheck: check(
      'ck_fiat_providers_type',
      sql`${table.type} IN ('bank', 'payment_provider', 'pix_provider', 'gateway')`
    ),
    statusCheck: check(
      'ck_fiat_providers_status',
      sql`${table.status} IN ('active', 'inactive', 'suspended')`
    ),
  })
);

/* ============================================================================
 * 8. FIAT ACCOUNTS
 * ============================================================================
 */
export const fiatAccounts = sqliteTable(
  'fiat_accounts',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, {
        onDelete: 'restrict',
      }),
    assetId: integer('asset_id')
      .notNull()
      .references(() => financialAssets.id, {
        onDelete: 'restrict',
      }),
    providerId: integer('provider_id').references(() => fiatProviders.id, {
      onDelete: 'restrict',
    }),
    type: text('type', {
      enum: ['bank_account', 'payment_account', 'pix_account'],
    }).notNull(),
    externalAccountId: text('external_account_id'),
    displayName: text('display_name'),
    last4: text('last4'),
    status: text('status', {
      enum: ['active', 'inactive', 'blocked'],
    })
      .notNull()
      .default('active'),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdateFn(() => new Date()),
    blockedAt: integer('blocked_at', { mode: 'timestamp' }),
  },
  (table) => ({
    userIdx: index('idx_fiat_accounts_user').on(table.userId),
    providerIdx: index('idx_fiat_accounts_provider').on(table.providerId),
    statusIdx: index('idx_fiat_accounts_status').on(table.status),
    typeCheck: check(
      'ck_fiat_accounts_type',
      sql`${table.type} IN ('bank_account', 'payment_account', 'pix_account')`
    ),
    statusCheck: check(
      'ck_fiat_accounts_status',
      sql`${table.status} IN ('active', 'inactive', 'blocked')`
    ),
    blockedStateCheck: check(
      'ck_fiat_accounts_blocked_state',
      sql`${table.status} != 'blocked' OR ${table.blockedAt} IS NOT NULL`
    ),
    externalUq: uniqueIndex('uq_fiat_accounts_provider_external').on(
      table.providerId,
      table.externalAccountId
    ),
  })
);

/* ============================================================================
 * 9. FIAT PAYMENT METHODS
 * ============================================================================
 */
export const fiatPaymentMethods = sqliteTable(
  'fiat_payment_methods',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, {
        onDelete: 'restrict',
      }),
    fiatAccountId: integer('fiat_account_id'),
    type: text('type', {
      enum: ['pix', 'bank_transfer', 'boleto', 'card'],
    }).notNull(),
    label: text('label').notNull(),
    status: text('status', {
      enum: ['active', 'inactive', 'blocked'],
    })
      .notNull()
      .default('active'),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdateFn(() => new Date()),
    blockedAt: integer('blocked_at', { mode: 'timestamp' }),
  },
  (table) => ({
    fiatAccountFk: foreignKey({
      columns: [table.userId, table.fiatAccountId],
      foreignColumns: [fiatAccounts.userId, fiatAccounts.id],
      name: 'fk_fiat_payment_methods_user_account',
    }).onDelete('restrict'),
    userIdx: index('idx_fiat_payment_methods_user').on(table.userId),
    accountIdx: index('idx_fiat_payment_methods_account').on(table.fiatAccountId),
    typeIdx: index('idx_fiat_payment_methods_type').on(table.type),
    statusIdx: index('idx_fiat_payment_methods_status').on(table.status),
    typeCheck: check(
      'ck_fiat_pm_type',
      sql`${table.type} IN ('pix', 'bank_transfer', 'boleto', 'card')`
    ),
    statusCheck: check(
      'ck_fiat_pm_status',
      sql`${table.status} IN ('active', 'inactive', 'blocked')`
    ),
    blockedStateCheck: check(
      'ck_fiat_pm_blocked_state',
      sql`${table.status} != 'blocked' OR ${table.blockedAt} IS NOT NULL`
    ),
  })
);

/* ============================================================================
 * 10. FIAT TRANSACTIONS
 * ============================================================================
 */
export const fiatTransactions = sqliteTable(
  'fiat_transactions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    financialTransactionId: integer('financial_transaction_id')
      .notNull()
      .references(() => financialTransactions.id, {
        onDelete: 'restrict',
      }),
    providerId: integer('provider_id').references(() => fiatProviders.id, {
      onDelete: 'restrict',
    }),
    paymentMethodId: integer('payment_method_id').references(() => fiatPaymentMethods.id, {
      onDelete: 'restrict',
    }),
    assetId: integer('asset_id')
      .notNull()
      .references(() => financialAssets.id, {
        onDelete: 'restrict',
      }),
    direction: text('direction', {
      enum: ['inbound', 'outbound'],
    }).notNull(),
    amountBaseUnits: text('amount_base_units').notNull(),
    status: text('status', {
      enum: ['pending', 'processing', 'completed', 'failed', 'cancelled', 'reversed'],
    })
      .notNull()
      .default('pending'),
    version: integer('version').notNull().default(1),
    requestedAt: integer('requested_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    processedAt: integer('processed_at', { mode: 'timestamp' }),
    settledAt: integer('settled_at', { mode: 'timestamp' }),
  },
  (table) => ({
    transactionUq: uniqueIndex('uq_fiat_transactions_financial_transaction').on(
      table.financialTransactionId
    ),
    providerIdx: index('idx_fiat_transactions_provider').on(table.providerId),
    paymentMethodIdx: index('idx_fiat_transactions_payment_method').on(table.paymentMethodId),
    assetIdx: index('idx_fiat_transactions_asset').on(table.assetId),
    statusIdx: index('idx_fiat_transactions_status').on(table.status),
    directionCheck: check(
      'ck_fiat_tx_direction',
      sql`${table.direction} IN ('inbound', 'outbound')`
    ),
    statusCheck: check(
      'ck_fiat_tx_status',
      sql`${table.status} IN ('pending', 'processing', 'completed', 'failed', 'cancelled', 'reversed')`
    ),
    amountCheck: check(
      'ck_fiat_transactions_amount_range',
      sql`${table.amountBaseUnits} != ''`
    ),
    temporalOrderCheck: check(
      'ck_fiat_tx_dates',
      sql`${table.settledAt} IS NULL OR ${table.settledAt} >= ${table.requestedAt}`
    ),
    versionCheck: check('ck_fiat_tx_version', sql`${table.version} > 0`),
  })
);

/* ============================================================================
 * 11. CRYPTO TRANSACTIONS
 * ============================================================================
 */
export const cryptoTransactions = sqliteTable(
  'crypto_transactions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    financialTransactionId: integer('financial_transaction_id')
      .notNull()
      .references(() => financialTransactions.id, {
        onDelete: 'restrict',
      }),
    assetId: integer('asset_id')
      .notNull()
      .references(() => financialAssets.id, {
        onDelete: 'restrict',
      }),
    web3TransactionId: text('web3_transaction_id'),
    direction: text('direction', {
      enum: ['inbound', 'outbound'],
    }).notNull(),
    amountBaseUnits: text('amount_base_units').notNull(),
    feeAssetId: integer('fee_asset_id').references(() => financialAssets.id, {
      onDelete: 'restrict',
    }),
    feeBaseUnits: text('fee_base_units').notNull().default('0'),
    status: text('status', {
      enum: ['pending', 'processing', 'confirmed', 'failed', 'reversed'],
    })
      .notNull()
      .default('pending'),
    version: integer('version').notNull().default(1),
    requestedAt: integer('requested_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    settledAt: integer('settled_at', { mode: 'timestamp' }),
  },
  (table) => ({
    transactionUq: uniqueIndex('uq_crypto_transactions_financial_transaction').on(
      table.financialTransactionId
    ),
    web3TransactionUq: uniqueIndex('uq_crypto_transactions_web3_transaction').on(
      table.web3TransactionId
    ),
    assetIdx: index('idx_crypto_transactions_asset').on(table.assetId),
    statusIdx: index('idx_crypto_transactions_status').on(table.status),
    directionCheck: check(
      'ck_crypto_tx_direction',
      sql`${table.direction} IN ('inbound', 'outbound')`
    ),
    statusCheck: check(
      'ck_crypto_tx_status',
      sql`${table.status} IN ('pending', 'processing', 'confirmed', 'failed', 'reversed')`
    ),
    amountCheck: check(
      'ck_crypto_transactions_amount_range',
      sql`${table.amountBaseUnits} != ''`
    ),
    feeCheck: check(
      'ck_crypto_transactions_fee_range',
      sql`${table.feeBaseUnits} != ''`
    ),
    feeAssetCheck: check(
      'ck_crypto_transactions_fee_asset',
      sql`${table.feeBaseUnits} = '0' OR ${table.feeAssetId} IS NOT NULL`
    ),
    temporalOrderCheck: check(
      'ck_crypto_tx_dates',
      sql`${table.settledAt} IS NULL OR ${table.settledAt} >= ${table.requestedAt}`
    ),
    versionCheck: check('ck_crypto_tx_version', sql`${table.version} > 0`),
  })
);

/* ============================================================================
 * 12. EXCHANGE RATES
 * ============================================================================
 */
export const exchangeRates = sqliteTable(
  'exchange_rates',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    baseAssetId: integer('base_asset_id')
      .notNull()
      .references(() => financialAssets.id, {
        onDelete: 'restrict',
      }),
    quoteAssetId: integer('quote_asset_id')
      .notNull()
      .references(() => financialAssets.id, {
        onDelete: 'restrict',
      }),
    rateNumerator: integer('rate_numerator', { mode: 'number' }).notNull(),
    rateDenominator: integer('rate_denominator', { mode: 'number' }).notNull(),
    source: text('source').notNull(),
    quotedAt: integer('quoted_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    expiresAt: integer('expires_at', { mode: 'timestamp' }),
  },
  (table) => ({
    pairIdx: index('idx_exchange_rates_pair').on(table.baseAssetId, table.quoteAssetId),
    quotedIdx: index('idx_exchange_rates_quoted').on(table.quotedAt),
    pairDifferentCheck: check(
      'ck_exchange_rates_different_assets',
      sql`${table.baseAssetId} <> ${table.quoteAssetId}`
    ),
    rateNumeratorCheck: check('ck_exchange_rates_numerator_positive', sql`${table.rateNumerator} > 0`),
    rateDenominatorCheck: check('ck_exchange_rates_denominator_positive', sql`${table.rateDenominator} > 0`),
    expiresCheck: check(
      'ck_exchange_rates_expires_after_quoted',
      sql`${table.expiresAt} IS NULL OR ${table.expiresAt} >= ${table.quotedAt}`
    ),
  })
);

/* ============================================================================
 * 13. ASSET CONVERSIONS
 * ============================================================================
 */
export const assetConversions = sqliteTable(
  'asset_conversions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    financialTransactionId: integer('financial_transaction_id')
      .notNull()
      .references(() => financialTransactions.id, {
        onDelete: 'restrict',
      }),
    fromAssetId: integer('from_asset_id')
      .notNull()
      .references(() => financialAssets.id, {
        onDelete: 'restrict',
      }),
    toAssetId: integer('to_asset_id')
      .notNull()
      .references(() => financialAssets.id, {
        onDelete: 'restrict',
      }),
    fromAmountBaseUnits: text('from_amount_base_units').notNull(),
    toAmountBaseUnits: text('to_amount_base_units').notNull(),
    rateNumerator: integer('rate_numerator', { mode: 'number' }).notNull(),
    rateDenominator: integer('rate_denominator', { mode: 'number' }).notNull(),
    rateSource: text('rate_source'),
    quotedAt: integer('quoted_at', { mode: 'timestamp' }),
    feeAmountBaseUnits: text('fee_amount_base_units').notNull().default('0'),
    status: text('status', {
      enum: ['pending', 'processing', 'completed', 'failed', 'cancelled'],
    })
      .notNull()
      .default('pending'),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    completedAt: integer('completed_at', { mode: 'timestamp' }),
  },
  (table) => ({
    transactionUq: uniqueIndex('uq_asset_conversions_transaction').on(table.financialTransactionId),
    fromAssetIdx: index('idx_asset_conversions_from_asset').on(table.fromAssetId),
    toAssetIdx: index('idx_asset_conversions_to_asset').on(table.toAssetId),
    statusCheck: check(
      'ck_asset_conversions_status',
      sql`${table.status} IN ('pending', 'processing', 'completed', 'failed', 'cancelled')`
    ),
    fromAmountCheck: check(
      'ck_asset_conversions_from_amount_range',
      sql`${table.fromAmountBaseUnits} != ''`
    ),
    toAmountCheck: check(
      'ck_asset_conversions_to_amount_range',
      sql`${table.toAmountBaseUnits} != ''`
    ),
    feeCheck: check(
      'ck_asset_conversions_fee_range',
      sql`${table.feeAmountBaseUnits} != ''`
    ),
    assetsDifferentCheck: check(
      'ck_asset_conversions_different_assets',
      sql`${table.fromAssetId} <> ${table.toAssetId}`
    ),
    rateNumeratorCheck: check('ck_asset_conversions_numerator_positive', sql`${table.rateNumerator} > 0`),
    rateDenominatorCheck: check('ck_asset_conversions_denominator_positive', sql`${table.rateDenominator} > 0`),
  })
);

/* ============================================================================
 * 14. FINANCIAL FEES
 * ============================================================================
 */
export const financialFees = sqliteTable(
  'financial_fees',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    transactionId: integer('transaction_id')
      .notNull()
      .references(() => financialTransactions.id, {
        onDelete: 'restrict',
      }),
    assetId: integer('asset_id')
      .notNull()
      .references(() => financialAssets.id, {
        onDelete: 'restrict',
      }),
    recipientAccountId: integer('recipient_account_id').references(() => financialAccounts.id, {
      onDelete: 'restrict',
    }),
    feeType: text('fee_type', {
      enum: ['platform', 'withdrawal', 'payment', 'conversion', 'network', 'other'],
    }).notNull(),
    amountBaseUnits: text('amount_base_units').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    transactionIdx: index('idx_financial_fees_transaction').on(table.transactionId),
    assetIdx: index('idx_financial_fees_asset').on(table.assetId),
    recipientIdx: index('idx_financial_fees_recipient_account').on(table.recipientAccountId),
    feeTypeCheck: check(
      'ck_financial_fees_type',
      sql`${table.feeType} IN ('platform', 'withdrawal', 'payment', 'conversion', 'network', 'other')`
    ),
    amountCheck: check(
      'ck_financial_fees_amount_range',
      sql`${table.amountBaseUnits} != ''`
    ),
  })
);

/* ============================================================================
 * 15. EXTERNAL TRANSACTIONS
 * ============================================================================
 */
export const fiatExternalTransactions = sqliteTable(
  'fiat_external_transactions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    financialTransactionId: integer('financial_transaction_id')
      .notNull()
      .references(() => financialTransactions.id, {
        onDelete: 'restrict',
      }),
    providerId: integer('provider_id').references(() => fiatProviders.id, {
      onDelete: 'restrict',
    }),
    externalTransactionId: text('external_transaction_id').notNull(),
    type: text('type').notNull(),
    status: text('status').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdateFn(() => new Date()),
  },
  (table) => ({
    providerExternalUq: uniqueIndex('uq_fiat_external_transactions_provider_external').on(
      table.providerId,
      table.externalTransactionId
    ),
    transactionIdx: index('idx_fiat_external_transactions_transaction').on(
      table.financialTransactionId
    ),
    providerIdx: index('idx_fiat_external_transactions_provider').on(table.providerId),
    statusIdx: index('idx_fiat_external_transactions_status').on(table.status),
  })
);

/* ============================================================================
 * 16. IDEMPOTENCY KEYS
 * ============================================================================
 */
export { idempotencyKeys } from '../infrastructure/tables';

/* ============================================================================
 * 17. RECONCILIATION RECORDS
 * ============================================================================
 */
export const reconciliationRecords = sqliteTable(
  'reconciliation_records',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    providerId: integer('provider_id').references(() => fiatProviders.id, {
      onDelete: 'restrict',
    }),
    accountId: integer('account_id')
      .notNull()
      .references(() => financialAccounts.id, {
        onDelete: 'restrict',
      }),
    assetId: integer('asset_id')
      .notNull()
      .references(() => financialAssets.id, {
        onDelete: 'restrict',
      }),
    expectedBalanceBaseUnits: text('expected_balance_base_units').notNull(),
    actualBalanceBaseUnits: text('actual_balance_base_units').notNull(),
    differenceBaseUnits: text('difference_base_units').notNull(),
    status: text('status', {
      enum: ['matched', 'mismatch', 'resolved'],
    })
      .notNull()
      .default('matched'),
    reconciliationRunId: text('reconciliation_run_id').notNull(),
    version: integer('version').notNull().default(1),
    reconciliationDate: integer('reconciliation_date', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    resolvedAt: integer('resolved_at', { mode: 'timestamp' }),
  },
  (table) => ({
    accountIdx: index('idx_reconciliation_records_account').on(table.accountId),
    assetIdx: index('idx_reconciliation_records_asset').on(table.assetId),
    providerIdx: index('idx_reconciliation_records_provider').on(table.providerId),
    statusIdx: index('idx_reconciliation_records_status').on(table.status),
    statusCheck: check(
      'ck_reconciliation_status',
      sql`${table.status} IN ('matched', 'mismatch', 'resolved')`
    ),
    resolvedStateCheck: check(
      'ck_reconciliation_resolved_state',
      sql`${table.status} != 'resolved' OR ${table.resolvedAt} IS NOT NULL`
    ),
    versionCheck: check('ck_reconciliation_records_version', sql`${table.version} > 0`),
    expectedCheck: check(
      'ck_reconciliation_expected_range',
      sql`${table.expectedBalanceBaseUnits} != ''`
    ),
    actualCheck: check(
      'ck_reconciliation_actual_range',
      sql`${table.actualBalanceBaseUnits} != ''`
    ),
  })
);

