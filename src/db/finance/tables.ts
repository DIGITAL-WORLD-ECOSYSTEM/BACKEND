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
 * - Financial accounts with explicit accounting classes
 * - Financial transactions
 * - Double-entry ledger
 * - Per-asset account balances
 * - Balance holds
 * - Fiat providers / accounts / payment methods / transactions
 * - Crypto transactions
 * - Exact rational exchange rates
 * - Asset conversions
 * - Financial fees
 * - External provider references
 * - Idempotency re-export
 * - Reconciliation
 *
 * ARCHITECTURAL RULE:
 * This file defines persistence structure and database-level invariants.
 * Business workflows remain in domain/application services.
 *
 * MONEY REPRESENTATION:
 * All base-unit monetary values are persisted as canonical decimal strings.
 *
 * Binding-safe limit:
 *   Number.MAX_SAFE_INTEGER = 2^53 - 1
 *                             = 9,007,199,254,740,991
 *
 * The database accepts integer strings only and rejects values above this
 * binding-safe limit. This keeps the current D1 application binding contract
 * explicit.
 * ============================================================================
 */

export const MAX_BINDING_SAFE_BASE_UNITS = 9007199254740991;
export const MAX_BINDING_SAFE_BASE_UNITS_TEXT = '9007199254740991';

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

    codeCheck: check(
      'ck_financial_assets_code_nonempty',
      sql`length(trim(${table.code})) > 0`
    ),

    symbolCheck: check(
      'ck_financial_assets_symbol_nonempty',
      sql`length(trim(${table.symbol})) > 0`
    ),

    nameCheck: check(
      'ck_financial_assets_name_nonempty',
      sql`length(trim(${table.name})) > 0`
    ),

    typeCheck: check(
      'ck_financial_assets_type',
      sql`${table.type} IN ('fiat', 'crypto')`
    ),

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
      enum: [
        'asset',
        'liability',
        'equity',
        'revenue',
        'expense',
      ],
    })
      .notNull()
      .default('liability'),

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

    nameCheck: check(
      'ck_financial_accounts_name_nonempty',
      sql`length(trim(${table.name})) > 0`
    ),

    accountTypeCheck: check(
      'ck_financial_accounts_type',
      sql`${table.accountType} IN (
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
        'refund_expense'
      )`
    ),

    accountClassCheck: check(
      'ck_financial_accounts_class',
      sql`${table.accountClass} IN (
        'asset',
        'liability',
        'equity',
        'revenue',
        'expense'
      )`
    ),

    statusCheck: check(
      'ck_financial_accounts_status',
      sql`${table.status} IN ('active', 'inactive', 'suspended')`
    ),

    /**
     * Canonical accounting classification.
     *
     * This prevents a valid enum value from being paired with an invalid
     * accounting class.
     *
     * Policy currently established by Finance domain:
     *
     * user_available         -> liability
     * treasury               -> asset
     * operating              -> asset
     * reserve                -> asset OR liability
     * fees                   -> revenue
     * escrow                 -> liability
     * reward_expense         -> expense
     * yield_expense          -> expense
     * clearing               -> asset OR liability
     * opening_balance_equity -> equity OR liability
     * payment_revenue        -> revenue
     * refund_expense         -> expense
     */
    accountTypeClassCheck: check(
      'ck_financial_accounts_type_class_matrix',
      sql`(
        (${table.accountType} = 'user_available' AND ${table.accountClass} = 'liability')
        OR
        (${table.accountType} = 'treasury' AND ${table.accountClass} = 'asset')
        OR
        (${table.accountType} = 'operating' AND ${table.accountClass} = 'asset')
        OR
        (${table.accountType} = 'reserve' AND ${table.accountClass} IN ('asset', 'liability'))
        OR
        (${table.accountType} = 'fees' AND ${table.accountClass} = 'revenue')
        OR
        (${table.accountType} = 'escrow' AND ${table.accountClass} = 'liability')
        OR
        (${table.accountType} = 'reward_expense' AND ${table.accountClass} = 'expense')
        OR
        (${table.accountType} = 'yield_expense' AND ${table.accountClass} = 'expense')
        OR
        (${table.accountType} = 'clearing' AND ${table.accountClass} IN ('asset', 'liability'))
        OR
        (
          ${table.accountType} = 'opening_balance_equity'
          AND ${table.accountClass} IN ('equity', 'liability')
        )
        OR
        (${table.accountType} = 'payment_revenue' AND ${table.accountClass} = 'revenue')
        OR
        (${table.accountType} = 'refund_expense' AND ${table.accountClass} = 'expense')
      )`
    ),

    userAccountTypeUq: uniqueIndex(
      'uq_financial_accounts_user_type_name'
    ).on(
      table.userId,
      table.accountType,
      table.name
    ),

    activeTreasurySingletonUnq: uniqueIndex(
      'uq_treasury_active_singleton'
    )
      .on(table.accountType)
      .where(
        sql`${table.accountType} = 'treasury'
          AND ${table.status} = 'active'`
      ),

    activeOperatingSingletonUnq: uniqueIndex(
      'uq_operating_active_singleton'
    )
      .on(table.accountType)
      .where(
        sql`${table.accountType} = 'operating'
          AND ${table.status} = 'active'`
      ),

    activeFeesSingletonUnq: uniqueIndex(
      'uq_fees_active_singleton'
    )
      .on(table.accountType)
      .where(
        sql`${table.accountType} = 'fees'
          AND ${table.status} = 'active'`
      ),

    userAvailableSingletonUnq: uniqueIndex(
      'uq_user_available_singleton'
    )
      .on(table.userId)
      .where(
        sql`${table.accountType} = 'user_available'`
      ),

    ownerRuleCheck: check(
      'ck_financial_accounts_owner_rule',
      sql`(
        ${table.accountType} = 'user_available'
        AND ${table.userId} IS NOT NULL
      )
      OR
      (
        ${table.accountType} != 'user_available'
        AND ${table.userId} IS NULL
      )`
    ),

    versionCheck: check(
      'ck_financial_accounts_version',
      sql`${table.version} > 0`
    ),
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

    reversalOfTransactionId: integer(
      'reversal_of_transaction_id'
    ).references(
      (): any => financialTransactions.id,
      {
        onDelete: 'restrict',
      }
    ),

    refundOfTransactionId: integer(
      'refund_of_transaction_id'
    ).references(
      (): any => financialTransactions.id,
      {
        onDelete: 'restrict',
      }
    ),

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
      enum: [
        'pending',
        'processing',
        'completed',
        'failed',
        'cancelled',
        'reversed',
        'refunded',
      ],
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
    userIdx: index('idx_financial_transactions_user').on(
      table.userId
    ),

    typeIdx: index('idx_financial_transactions_type').on(
      table.type
    ),

    statusIdx: index('idx_financial_transactions_status').on(
      table.status
    ),

    createdIdx: index('idx_financial_transactions_created').on(
      table.createdAt
    ),

    correlationIdx: index(
      'idx_financial_transactions_correlation'
    ).on(table.correlationId),

    singleReversalUnq: uniqueIndex(
      'uq_financial_tx_single_reversal'
    )
      .on(table.reversalOfTransactionId)
      .where(
        sql`${table.reversalOfTransactionId} IS NOT NULL`
      ),

    typeCheck: check(
      'ck_financial_tx_type',
      sql`${table.type} IN (
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
        'reversal'
      )`
    ),

    categoryCheck: check(
      'ck_financial_tx_category',
      sql`${table.category} IN (
        'membership',
        'rwa_yield',
        'grant',
        'operational',
        'payment',
        'trading',
        'withdrawal',
        'deposit',
        'fee',
        'other'
      )`
    ),

    statusCheck: check(
      'ck_financial_tx_status',
      sql`${table.status} IN (
        'pending',
        'processing',
        'completed',
        'failed',
        'cancelled',
        'reversed',
        'refunded'
      )`
    ),

    sourceTypeCheck: check(
      'ck_financial_tx_source_type',
      sql`${table.sourceType} IS NULL
        OR ${table.sourceType} IN (
          'contribution',
          'grant',
          'membership',
          'payroll',
          'withdrawal',
          'payment',
          'conversion',
          'system',
          'other'
        )`
    ),

    descriptionCheck: check(
      'ck_financial_tx_description_nonempty',
      sql`length(trim(${table.description})) > 0`
    ),

    /**
     * sourceType and sourceId must travel together.
     *
     * This deliberately avoids allowing:
     *
     * sourceType = 'payment' + NULL sourceId
     *
     * or:
     *
     * sourceType = NULL + sourceId = '...'
     */
    sourceCoherenceCheck: check(
      'ck_financial_tx_source_coherence',
      sql`(
        ${table.sourceType} IS NULL
        AND ${table.sourceId} IS NULL
      )
      OR
      (
        ${table.sourceType} IS NOT NULL
        AND ${table.sourceId} IS NOT NULL
        AND length(trim(${table.sourceId})) > 0
      )`
    ),

    correlationCheck: check(
      'ck_financial_tx_correlation_nonempty',
      sql`${table.correlationId} IS NULL
        OR length(trim(${table.correlationId})) > 0`
    ),

    /**
     * A reversal transaction must identify its original transaction.
     * Any transaction pointing to reversalOfTransactionId must itself be
     * of type reversal.
     */
    reversalCoherenceCheck: check(
      'ck_financial_tx_reversal_coherence',
      sql`(
        ${table.reversalOfTransactionId} IS NULL
        OR (
          ${table.type} = 'reversal'
          AND ${table.reversalOfTransactionId} != ${table.id}
        )
      )`
    ),

    /**
     * A refund transaction must identify its original transaction.
     * Any transaction pointing to refundOfTransactionId must itself be
     * of type refund.
     */
    refundCoherenceCheck: check(
      'ck_financial_tx_refund_coherence',
      sql`(
        ${table.refundOfTransactionId} IS NULL
        OR (
          ${table.type} = 'refund'
          AND ${table.refundOfTransactionId} != ${table.id}
        )
      )`
    ),

    /**
     * One transaction cannot simultaneously be a direct reversal and refund
     * of another transaction.
     */
    reversalRefundExclusiveCheck: check(
      'ck_financial_tx_reversal_refund_exclusive',
      sql`NOT (
        ${table.reversalOfTransactionId} IS NOT NULL
        AND ${table.refundOfTransactionId} IS NOT NULL
      )`
    ),

    /**
     * Conversely, a reversal/refund type without its corresponding source
     * reference is invalid.
     */
    typedSourceReferenceCheck: check(
      'ck_financial_tx_typed_reference_required',
      sql`(
        (${table.type} = 'reversal'
          AND ${table.reversalOfTransactionId} IS NOT NULL)
        OR
        (${table.type} = 'refund'
          AND ${table.refundOfTransactionId} IS NOT NULL)
        OR
        (${table.type} NOT IN ('reversal', 'refund'))
      )`
    ),

    /**
     * completedAt is meaningful only for a completed transaction.
     *
     * Reversed/refunded original transactions may retain their historical
     * completion timestamp; the state transition itself is enforced by the
     * application service.
     */
    completedStateCheck: check(
      'ck_financial_tx_completed_state',
      sql`(
        ${table.status} = 'completed'
        AND ${table.completedAt} IS NOT NULL
      )
      OR
      (
        ${table.status} != 'completed'
        AND ${table.completedAt} IS NULL
      )`
    ),

    temporalOrderCheck: check(
      'ck_financial_tx_dates',
      sql`${table.completedAt} IS NULL
        OR ${table.completedAt} >= ${table.createdAt}`
    ),

    versionCheck: check(
      'ck_financial_tx_version',
      sql`${table.version} > 0`
    ),
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

    createdAt: integer('created_at', {
      mode: 'timestamp',
    })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    transactionIdx: index(
      'idx_financial_ledger_entries_transaction'
    ).on(table.transactionId),

    accountIdx: index(
      'idx_financial_ledger_entries_account'
    ).on(table.accountId),

    assetIdx: index(
      'idx_financial_ledger_entries_asset'
    ).on(table.assetId),

    createdIdx: index(
      'idx_financial_ledger_entries_created'
    ).on(table.createdAt),

    directionCheck: check(
      'ck_financial_ledger_direction',
      sql`${table.direction} IN ('debit', 'credit')`
    ),

    /**
     * Positive canonical unsigned integer:
     *
     * - no sign
     * - no decimal point
     * - no whitespace
     * - no leading zero
     * - zero is not accepted
     * - maximum is Number.MAX_SAFE_INTEGER
     */
    amountCheck: check(
      'ck_financial_ledger_entries_amount_canonical',
      sql`
        ${table.amountBaseUnits} GLOB '[1-9]*'
        AND ${table.amountBaseUnits} NOT GLOB '*[^0-9]*'
        AND (
          length(${table.amountBaseUnits}) < 16
          OR (
            length(${table.amountBaseUnits}) = 16
            AND ${table.amountBaseUnits} <= '9007199254740991'
          )
        )
      `
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

    availableBaseUnits: text('available_base_units')
      .notNull()
      .default('0'),

    lockedBaseUnits: text('locked_base_units')
      .notNull()
      .default('0'),

    version: integer('version').notNull().default(1),

    updatedAt: integer('updated_at', {
      mode: 'timestamp',
    })
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdateFn(() => new Date()),
  },
  (table) => ({
    accountAssetUq: uniqueIndex(
      'uq_account_balances_account_asset'
    ).on(
      table.accountId,
      table.assetId
    ),

    accountIdx: index(
      'idx_account_balances_account'
    ).on(table.accountId),

    assetIdx: index(
      'idx_account_balances_asset'
    ).on(table.assetId),

    availableCheck: check(
      'ck_account_balances_available_canonical',
      sql`
        (
          ${table.availableBaseUnits} = '0'
          OR (
            ${table.availableBaseUnits} GLOB '[1-9]*'
            AND ${table.availableBaseUnits} NOT GLOB '*[^0-9]*'
          )
        )
        AND (
          length(${table.availableBaseUnits}) < 16
          OR (
            length(${table.availableBaseUnits}) = 16
            AND ${table.availableBaseUnits} <= '9007199254740991'
          )
        )
      `
    ),

    lockedCheck: check(
      'ck_account_balances_locked_canonical',
      sql`
        (
          ${table.lockedBaseUnits} = '0'
          OR (
            ${table.lockedBaseUnits} GLOB '[1-9]*'
            AND ${table.lockedBaseUnits} NOT GLOB '*[^0-9]*'
          )
        )
        AND (
          length(${table.lockedBaseUnits}) < 16
          OR (
            length(${table.lockedBaseUnits}) = 16
            AND ${table.lockedBaseUnits} <= '9007199254740991'
          )
        )
      `
    ),

    versionCheck: check(
      'ck_account_balances_version',
      sql`${table.version} > 0`
    ),
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
      enum: [
        'active',
        'released',
        'expired',
        'consumed',
      ],
    })
      .notNull()
      .default('active'),

    version: integer('version').notNull().default(1),

    expiresAt: integer('expires_at', {
      mode: 'timestamp',
    }),

    createdAt: integer('created_at', {
      mode: 'timestamp',
    })
      .notNull()
      .$defaultFn(() => new Date()),

    updatedAt: integer('updated_at', {
      mode: 'timestamp',
    })
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdateFn(() => new Date()),

    releasedAt: integer('released_at', {
      mode: 'timestamp',
    }),

    releasedByTransactionId: integer(
      'released_by_transaction_id'
    ).references(
      () => financialTransactions.id,
      {
        onDelete: 'restrict',
      }
    ),

    consumedAt: integer('consumed_at', {
      mode: 'timestamp',
    }),

    consumedByTransactionId: integer(
      'consumed_by_transaction_id'
    ).references(
      () => financialTransactions.id,
      {
        onDelete: 'restrict',
      }
    ),
  },
  (table) => ({
    accountIdx: index(
      'idx_balance_holds_account'
    ).on(table.accountId),

    assetIdx: index(
      'idx_balance_holds_asset'
    ).on(table.assetId),

    statusIdx: index(
      'idx_balance_holds_status'
    ).on(table.status),

    referenceIdx: index(
      'idx_balance_holds_reference'
    ).on(
      table.referenceType,
      table.referenceId
    ),

    releaseTransactionIdx: index(
      'idx_balance_holds_release_transaction'
    ).on(table.releasedByTransactionId),

    consumedTransactionIdx: index(
      'idx_balance_holds_consumed_transaction'
    ).on(table.consumedByTransactionId),

    statusCheck: check(
      'ck_balance_holds_status',
      sql`${table.status} IN (
        'active',
        'released',
        'expired',
        'consumed'
      )`
    ),

    reasonCheck: check(
      'ck_balance_holds_reason_nonempty',
      sql`length(trim(${table.reason})) > 0`
    ),

    referenceCoherenceCheck: check(
      'ck_balance_holds_reference_coherence',
      sql`(
        ${table.referenceType} IS NULL
        AND ${table.referenceId} IS NULL
      )
      OR
      (
        ${table.referenceType} IS NOT NULL
        AND ${table.referenceId} IS NOT NULL
        AND length(trim(${table.referenceType})) > 0
        AND length(trim(${table.referenceId})) > 0
      )`
    ),

    amountCheck: check(
      'ck_balance_holds_amount_canonical',
      sql`
        ${table.amountBaseUnits} GLOB '[1-9]*'
        AND ${table.amountBaseUnits} NOT GLOB '*[^0-9]*'
        AND (
          length(${table.amountBaseUnits}) < 16
          OR (
            length(${table.amountBaseUnits}) = 16
            AND ${table.amountBaseUnits} <= '9007199254740991'
          )
        )
      `
    ),

    releasedStateCheck: check(
      'ck_balance_holds_released_state',
      sql`(
        ${table.status} = 'released'
        AND ${table.releasedAt} IS NOT NULL
        AND ${table.releasedByTransactionId} IS NOT NULL
        AND ${table.consumedAt} IS NULL
        AND ${table.consumedByTransactionId} IS NULL
      )
      OR
      (
        ${table.status} != 'released'
        AND ${table.releasedAt} IS NULL
        AND ${table.releasedByTransactionId} IS NULL
      )`
    ),

    expiredStateCheck: check(
      'ck_balance_holds_expired_state',
      sql`(
        ${table.status} = 'expired'
        AND ${table.expiresAt} IS NOT NULL
        AND ${table.consumedAt} IS NULL
        AND ${table.releasedAt} IS NULL
      )
      OR
      ${table.status} != 'expired'`
    ),

    consumedStateCheck: check(
      'ck_balance_holds_consumed_state',
      sql`(
        ${table.status} = 'consumed'
        AND ${table.consumedAt} IS NOT NULL
        AND ${table.consumedByTransactionId} IS NOT NULL
        AND ${table.releasedAt} IS NULL
        AND ${table.releasedByTransactionId} IS NULL
      )
      OR
      (
        ${table.status} != 'consumed'
        AND ${table.consumedAt} IS NULL
        AND ${table.consumedByTransactionId} IS NULL
      )`
    ),

    activeStateCheck: check(
      'ck_balance_holds_active_state',
      sql`(
        ${table.status} = 'active'
        AND ${table.releasedAt} IS NULL
        AND ${table.releasedByTransactionId} IS NULL
        AND ${table.consumedAt} IS NULL
        AND ${table.consumedByTransactionId} IS NULL
      )
      OR
      ${table.status} != 'active'`
    ),

    expirationTemporalCheck: check(
      'ck_balance_holds_expiration_temporal',
      sql`${table.expiresAt} IS NULL
        OR ${table.expiresAt} > ${table.createdAt}`
    ),

    lifecycleTemporalCheck: check(
      'ck_balance_holds_lifecycle_temporal',
      sql`(
        (${table.releasedAt} IS NULL
          OR ${table.releasedAt} >= ${table.createdAt})
        AND
        (${table.consumedAt} IS NULL
          OR ${table.consumedAt} >= ${table.createdAt})
      )`
    ),

    versionCheck: check(
      'ck_balance_holds_version',
      sql`${table.version} > 0`
    ),
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
      enum: [
        'bank',
        'payment_provider',
        'pix_provider',
        'gateway',
      ],
    }).notNull(),

    status: text('status', {
      enum: [
        'active',
        'inactive',
        'suspended',
      ],
    })
      .notNull()
      .default('active'),

    createdAt: integer('created_at', {
      mode: 'timestamp',
    })
      .notNull()
      .$defaultFn(() => new Date()),

    updatedAt: integer('updated_at', {
      mode: 'timestamp',
    })
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdateFn(() => new Date()),
  },
  (table) => ({
    codeUq: uniqueIndex(
      'uq_fiat_providers_code'
    ).on(table.code),

    typeIdx: index(
      'idx_fiat_providers_type'
    ).on(table.type),

    statusIdx: index(
      'idx_fiat_providers_status'
    ).on(table.status),

    nameCheck: check(
      'ck_fiat_providers_name_nonempty',
      sql`length(trim(${table.name})) > 0`
    ),

    codeCheckNonempty: check(
      'ck_fiat_providers_code_nonempty',
      sql`length(trim(${table.code})) > 0`
    ),

    typeCheck: check(
      'ck_fiat_providers_type',
      sql`${table.type} IN (
        'bank',
        'payment_provider',
        'pix_provider',
        'gateway'
      )`
    ),

    statusCheck: check(
      'ck_fiat_providers_status',
      sql`${table.status} IN (
        'active',
        'inactive',
        'suspended'
      )`
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

    providerId: integer('provider_id').references(
      () => fiatProviders.id,
      {
        onDelete: 'restrict',
      }
    ),

    type: text('type', {
      enum: [
        'bank_account',
        'payment_account',
        'pix_account',
      ],
    }).notNull(),

    externalAccountId: text('external_account_id'),

    displayName: text('display_name'),

    last4: text('last4'),

    status: text('status', {
      enum: [
        'active',
        'inactive',
        'blocked',
      ],
    })
      .notNull()
      .default('active'),

    createdAt: integer('created_at', {
      mode: 'timestamp',
    })
      .notNull()
      .$defaultFn(() => new Date()),

    updatedAt: integer('updated_at', {
      mode: 'timestamp',
    })
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdateFn(() => new Date()),

    blockedAt: integer('blocked_at', {
      mode: 'timestamp',
    }),
  },
  (table) => ({
    /**
     * Composite parent key used by fiatPaymentMethods.
     *
     * SQLite requires the referenced composite columns to have a UNIQUE
     * constraint matching the foreign-key column set.
     */
    userAccountCompositeUq: uniqueIndex(
      'uq_fiat_accounts_user_id_id'
    ).on(
      table.userId,
      table.id
    ),

    userIdx: index(
      'idx_fiat_accounts_user'
    ).on(table.userId),

    providerIdx: index(
      'idx_fiat_accounts_provider'
    ).on(table.providerId),

    statusIdx: index(
      'idx_fiat_accounts_status'
    ).on(table.status),

    typeIdx: index(
      'idx_fiat_accounts_type'
    ).on(table.type),

    typeCheck: check(
      'ck_fiat_accounts_type',
      sql`${table.type} IN (
        'bank_account',
        'payment_account',
        'pix_account'
      )`
    ),

    statusCheck: check(
      'ck_fiat_accounts_status',
      sql`${table.status} IN (
        'active',
        'inactive',
        'blocked'
      )`
    ),

    externalProviderCoherenceCheck: check(
      'ck_fiat_accounts_external_provider_coherence',
      sql`(
        ${table.providerId} IS NULL
        AND ${table.externalAccountId} IS NULL
      )
      OR
      (
        ${table.providerId} IS NOT NULL
        AND ${table.externalAccountId} IS NOT NULL
        AND length(trim(${table.externalAccountId})) > 0
      )`
    ),

    displayNameCheck: check(
      'ck_fiat_accounts_display_name_nonempty',
      sql`${table.displayName} IS NULL
        OR length(trim(${table.displayName})) > 0`
    ),

    last4Check: check(
      'ck_fiat_accounts_last4',
      sql`${table.last4} IS NULL
        OR (
          length(${table.last4}) BETWEEN 2 AND 4
          AND ${table.last4} NOT GLOB '*[^0-9]*'
        )`
    ),

    blockedStateCheck: check(
      'ck_fiat_accounts_blocked_state',
      sql`(
        ${table.status} = 'blocked'
        AND ${table.blockedAt} IS NOT NULL
      )
      OR
      (
        ${table.status} != 'blocked'
        AND ${table.blockedAt} IS NULL
      )`
    ),
    
    blockedTemporalCheck: check(
      'ck_fiat_accounts_blocked_temporal',
      sql`${table.blockedAt} IS NULL
        OR ${table.blockedAt} >= ${table.createdAt}`
    ),

    externalUq: uniqueIndex(
      'uq_fiat_accounts_provider_external'
    ).on(
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

    fiatAccountId: integer('fiat_account_id').notNull(),

    type: text('type', {
      enum: [
        'pix',
        'bank_transfer',
        'boleto',
        'card',
      ],
    }).notNull(),

    label: text('label').notNull(),

    status: text('status', {
      enum: [
        'active',
        'inactive',
        'blocked',
      ],
    })
      .notNull()
      .default('active'),

    createdAt: integer('created_at', {
      mode: 'timestamp',
    })
      .notNull()
      .$defaultFn(() => new Date()),

    updatedAt: integer('updated_at', {
      mode: 'timestamp',
    })
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdateFn(() => new Date()),

    blockedAt: integer('blocked_at', {
      mode: 'timestamp',
    }),
  },
  (table) => ({
    /**
     * User-scoped composite FK.
     *
     * This prevents User A from selecting a fiat account owned by User B.
     */
    fiatAccountFk: foreignKey({
      columns: [
        table.userId,
        table.fiatAccountId,
      ],

      foreignColumns: [
        fiatAccounts.userId,
        fiatAccounts.id,
      ],

      name: 'fk_fiat_payment_methods_user_account',
    }).onDelete('restrict'),

    userIdx: index(
      'idx_fiat_payment_methods_user'
    ).on(table.userId),

    accountIdx: index(
      'idx_fiat_payment_methods_account'
    ).on(table.fiatAccountId),

    typeIdx: index(
      'idx_fiat_payment_methods_type'
    ).on(table.type),

    statusIdx: index(
      'idx_fiat_payment_methods_status'
    ).on(table.status),

    typeCheck: check(
      'ck_fiat_pm_type',
      sql`${table.type} IN (
        'pix',
        'bank_transfer',
        'boleto',
        'card'
      )`
    ),

    labelCheck: check(
      'ck_fiat_pm_label_nonempty',
      sql`length(trim(${table.label})) > 0`
    ),

    statusCheck: check(
      'ck_fiat_pm_status',
      sql`${table.status} IN (
        'active',
        'inactive',
        'blocked'
      )`
    ),

    blockedStateCheck: check(
      'ck_fiat_pm_blocked_state',
      sql`(
        ${table.status} = 'blocked'
        AND ${table.blockedAt} IS NOT NULL
      )
      OR
      (
        ${table.status} != 'blocked'
        AND ${table.blockedAt} IS NULL
      )`
    ),

    blockedTemporalCheck: check(
      'ck_fiat_pm_blocked_temporal',
      sql`${table.blockedAt} IS NULL
        OR ${table.blockedAt} >= ${table.createdAt}`
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

    financialTransactionId: integer(
      'financial_transaction_id'
    )
      .notNull()
      .references(() => financialTransactions.id, {
        onDelete: 'restrict',
      }),

    providerId: integer('provider_id')
      .notNull()
      .references(() => fiatProviders.id, {
        onDelete: 'restrict',
      }),

    paymentMethodId: integer(
      'payment_method_id'
    ).references(
      () => fiatPaymentMethods.id,
      {
        onDelete: 'restrict',
      }
    ),

    assetId: integer('asset_id')
      .notNull()
      .references(() => financialAssets.id, {
        onDelete: 'restrict',
      }),

    direction: text('direction', {
      enum: [
        'inbound',
        'outbound',
      ],
    }).notNull(),

    amountBaseUnits: text(
      'amount_base_units'
    ).notNull(),

    status: text('status', {
      enum: [
        'pending',
        'processing',
        'completed',
        'failed',
        'cancelled',
        'reversed',
      ],
    })
      .notNull()
      .default('pending'),

    version: integer('version').notNull().default(1),

    requestedAt: integer('requested_at', {
      mode: 'timestamp',
    })
      .notNull()
      .$defaultFn(() => new Date()),

    processedAt: integer('processed_at', {
      mode: 'timestamp',
    }),

    settledAt: integer('settled_at', {
      mode: 'timestamp',
    }),
  },
  (table) => ({
    transactionUq: uniqueIndex(
      'uq_fiat_transactions_financial_transaction'
    ).on(table.financialTransactionId),

    providerIdx: index(
      'idx_fiat_transactions_provider'
    ).on(table.providerId),

    paymentMethodIdx: index(
      'idx_fiat_transactions_payment_method'
    ).on(table.paymentMethodId),

    assetIdx: index(
      'idx_fiat_transactions_asset'
    ).on(table.assetId),

    statusIdx: index(
      'idx_fiat_transactions_status'
    ).on(table.status),

    requestedIdx: index(
      'idx_fiat_transactions_requested'
    ).on(table.requestedAt),

    directionCheck: check(
      'ck_fiat_tx_direction',
      sql`${table.direction} IN (
        'inbound',
        'outbound'
      )`
    ),

    statusCheck: check(
      'ck_fiat_tx_status',
      sql`${table.status} IN (
        'pending',
        'processing',
        'completed',
        'failed',
        'cancelled',
        'reversed'
      )`
    ),

    amountCheck: check(
      'ck_fiat_transactions_amount_canonical',
      sql`
        ${table.amountBaseUnits} GLOB '[1-9]*'
        AND ${table.amountBaseUnits} NOT GLOB '*[^0-9]*'
        AND (
          length(${table.amountBaseUnits}) < 16
          OR (
            length(${table.amountBaseUnits}) = 16
            AND ${table.amountBaseUnits} <= '9007199254740991'
          )
        )
      `
    ),

    processedTemporalCheck: check(
      'ck_fiat_tx_processed_at',
      sql`${table.processedAt} IS NULL
        OR ${table.processedAt} >= ${table.requestedAt}`
    ),

    settledTemporalCheck: check(
      'ck_fiat_tx_settled_at',
      sql`${table.settledAt} IS NULL
        OR ${table.settledAt} >= ${table.requestedAt}`
    ),

    settlementOrderCheck: check(
      'ck_fiat_tx_settlement_order',
      sql`${table.settledAt} IS NULL
        OR ${table.processedAt} IS NULL
        OR ${table.settledAt} >= ${table.processedAt}`
    ),

    completedLifecycleCheck: check(
      'ck_fiat_tx_completed_lifecycle',
      sql`(
        ${table.status} = 'completed'
        AND ${table.settledAt} IS NOT NULL
      )
      OR
      ${table.status} != 'completed'`
    ),

    versionCheck: check(
      'ck_fiat_tx_version',
      sql`${table.version} > 0`
    ),
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

    financialTransactionId: integer(
      'financial_transaction_id'
    )
      .notNull()
      .references(() => financialTransactions.id, {
        onDelete: 'restrict',
      }),

    assetId: integer('asset_id')
      .notNull()
      .references(() => financialAssets.id, {
        onDelete: 'restrict',
      }),

    /**
     * Provider/network transaction identifier.
     *
     * For blockchain-backed operations this normally represents the
     * transaction hash.
     */
    web3TransactionId: text(
      'web3_transaction_id'
    ),

    /**
     * Explicit network identifier.
     *
     * Examples:
     * ethereum-mainnet
     * polygon-mainnet
     * bitcoin-mainnet
     *
     * The actual allowed network catalog belongs to the application/domain.
     */
    network: text('network'),

    blockNumber: integer('block_number'),

    confirmations: integer('confirmations')
      .notNull()
      .default(0),

    direction: text('direction', {
      enum: [
        'inbound',
        'outbound',
      ],
    }).notNull(),

    amountBaseUnits: text(
      'amount_base_units'
    ).notNull(),

    feeAssetId: integer('fee_asset_id').references(
      () => financialAssets.id,
      {
        onDelete: 'restrict',
      }
    ),

    feeBaseUnits: text(
      'fee_base_units'
    )
      .notNull()
      .default('0'),

    status: text('status', {
      enum: [
        'pending',
        'processing',
        'confirmed',
        'failed',
        'reversed',
      ],
    })
      .notNull()
      .default('pending'),

    version: integer('version')
      .notNull()
      .default(1),

    requestedAt: integer('requested_at', {
      mode: 'timestamp',
    })
      .notNull()
      .$defaultFn(() => new Date()),

    settledAt: integer('settled_at', {
      mode: 'timestamp',
    }),
  },
  (table) => ({
    transactionUq: uniqueIndex(
      'uq_crypto_transactions_financial_transaction'
    ).on(table.financialTransactionId),

    web3TransactionUq: uniqueIndex(
      'uq_crypto_transactions_web3_transaction'
    ).on(table.web3TransactionId),

    assetIdx: index(
      'idx_crypto_transactions_asset'
    ).on(table.assetId),

    feeAssetIdx: index(
      'idx_crypto_transactions_fee_asset'
    ).on(table.feeAssetId),

    statusIdx: index(
      'idx_crypto_transactions_status'
    ).on(table.status),

    networkIdx: index(
      'idx_crypto_transactions_network'
    ).on(table.network),

    requestedIdx: index(
      'idx_crypto_transactions_requested'
    ).on(table.requestedAt),

    directionCheck: check(
      'ck_crypto_tx_direction',
      sql`${table.direction} IN (
        'inbound',
        'outbound'
      )`
    ),

    statusCheck: check(
      'ck_crypto_tx_status',
      sql`${table.status} IN (
        'pending',
        'processing',
        'confirmed',
        'failed',
        'reversed'
      )`
    ),

    amountCheck: check(
      'ck_crypto_transactions_amount_canonical',
      sql`
        ${table.amountBaseUnits} GLOB '[1-9]*'
        AND ${table.amountBaseUnits} NOT GLOB '*[^0-9]*'
        AND (
          length(${table.amountBaseUnits}) < 16
          OR (
            length(${table.amountBaseUnits}) = 16
            AND ${table.amountBaseUnits} <= '9007199254740991'
          )
        )
      `
    ),

    feeCheck: check(
      'ck_crypto_transactions_fee_canonical',
      sql`
        (
          ${table.feeBaseUnits} = '0'
          OR (
            ${table.feeBaseUnits} GLOB '[1-9]*'
            AND ${table.feeBaseUnits} NOT GLOB '*[^0-9]*'
          )
        )
        AND (
          length(${table.feeBaseUnits}) < 16
          OR (
            length(${table.feeBaseUnits}) = 16
            AND ${table.feeBaseUnits} <= '9007199254740991'
          )
        )
      `
    ),

    feeAssetCheck: check(
      'ck_crypto_transactions_fee_asset',
      sql`(
        ${table.feeBaseUnits} = '0'
        AND ${table.feeAssetId} IS NULL
      )
      OR
      (
        ${table.feeBaseUnits} != '0'
        AND ${table.feeAssetId} IS NOT NULL
      )`
    ),

    confirmationsCheck: check(
      'ck_crypto_transactions_confirmations',
      sql`${table.confirmations} >= 0`
    ),

    blockNumberCheck: check(
      'ck_crypto_transactions_block_number',
      sql`${table.blockNumber} IS NULL
        OR ${table.blockNumber} >= 0`
    ),

    networkCheck: check(
      'ck_crypto_transactions_network',
      sql`${table.network} IS NULL
        OR length(trim(${table.network})) > 0`
    ),

    web3IdCheck: check(
      'ck_crypto_transactions_web3_id',
      sql`${table.web3TransactionId} IS NULL
        OR length(trim(${table.web3TransactionId})) > 0`
    ),

    /**
     * A confirmed blockchain transaction must carry enough external
     * evidence to be auditable.
     */
    confirmedEvidenceCheck: check(
      'ck_crypto_transactions_confirmed_evidence',
      sql`(
        ${table.status} != 'confirmed'
      )
      OR
      (
        ${table.status} = 'confirmed'
        AND ${table.web3TransactionId} IS NOT NULL
        AND ${table.network} IS NOT NULL
        AND ${table.blockNumber} IS NOT NULL
        AND ${table.confirmations} > 0
        AND ${table.settledAt} IS NOT NULL
      )`
    ),

    temporalOrderCheck: check(
      'ck_crypto_tx_dates',
      sql`${table.settledAt} IS NULL
        OR ${table.settledAt} >= ${table.requestedAt}`
    ),

    versionCheck: check(
      'ck_crypto_tx_version',
      sql`${table.version} > 0`
    ),
  })
);

/* ============================================================================
 * 12. EXCHANGE RATES
 * ============================================================================
 *
 * IMPORTANT:
 * rateNumerator/rateDenominator are TEXT instead of SQLite INTEGER.
 *
 * Reason:
 * The Finance model treats rates as exact rational values. JavaScript
 * `number` cannot safely represent arbitrarily large integers. Persisting the
 * numerator/denominator as canonical decimal strings keeps the representation
 * exact across the database/application boundary.
 *
 * The application/domain layer is responsible for performing the rational
 * arithmetic using BigInt/Money256.
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

    rateNumerator: text(
      'rate_numerator'
    ).notNull(),

    rateDenominator: text(
      'rate_denominator'
    ).notNull(),

    source: text('source').notNull(),

    quotedAt: integer('quoted_at', {
      mode: 'timestamp',
    })
      .notNull()
      .$defaultFn(() => new Date()),

    expiresAt: integer('expires_at', {
      mode: 'timestamp',
    }),
  },
  (table) => ({
    pairIdx: index(
      'idx_exchange_rates_pair'
    ).on(
      table.baseAssetId,
      table.quoteAssetId
    ),

    quotedIdx: index(
      'idx_exchange_rates_quoted'
    ).on(table.quotedAt),

    expiryIdx: index(
      'idx_exchange_rates_expires'
    ).on(table.expiresAt),

    pairDifferentCheck: check(
      'ck_exchange_rates_different_assets',
      sql`${table.baseAssetId} <> ${table.quoteAssetId}`
    ),

    rateNumeratorCheck: check(
      'ck_exchange_rates_numerator_canonical',
      sql`
        ${table.rateNumerator} GLOB '[1-9]*'
        AND ${table.rateNumerator} NOT GLOB '*[^0-9]*'
        AND (
          length(${table.rateNumerator}) < 16
          OR (
            length(${table.rateNumerator}) = 16
            AND ${table.rateNumerator} <= '9007199254740991'
          )
        )
      `
    ),

    rateDenominatorCheck: check(
      'ck_exchange_rates_denominator_canonical',
      sql`
        ${table.rateDenominator} GLOB '[1-9]*'
        AND ${table.rateDenominator} NOT GLOB '*[^0-9]*'
        AND (
          length(${table.rateDenominator}) < 16
          OR (
            length(${table.rateDenominator}) = 16
            AND ${table.rateDenominator} <= '9007199254740991'
          )
        )
      `
    ),

    sourceCheck: check(
      'ck_exchange_rates_source_nonempty',
      sql`length(trim(${table.source})) > 0`
    ),

    expiresCheck: check(
      'ck_exchange_rates_expires_after_quoted',
      sql`${table.expiresAt} IS NULL
        OR ${table.expiresAt} >= ${table.quotedAt}`
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

    financialTransactionId: integer(
      'financial_transaction_id'
    )
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

    fromAmountBaseUnits: text(
      'from_amount_base_units'
    ).notNull(),

    toAmountBaseUnits: text(
      'to_amount_base_units'
    ).notNull(),

    /**
     * Exact rational conversion rate.
     */
    rateNumerator: text(
      'rate_numerator'
    ).notNull(),

    rateDenominator: text(
      'rate_denominator'
    ).notNull(),

    rateSource: text('rate_source'),

    quotedAt: integer('quoted_at', {
      mode: 'timestamp',
    }),

    feeAmountBaseUnits: text(
      'fee_amount_base_units'
    )
      .notNull()
      .default('0'),

    status: text('status', {
      enum: [
        'pending',
        'processing',
        'completed',
        'failed',
        'cancelled',
      ],
    })
      .notNull()
      .default('pending'),

    createdAt: integer('created_at', {
      mode: 'timestamp',
    })
      .notNull()
      .$defaultFn(() => new Date()),

    completedAt: integer('completed_at', {
      mode: 'timestamp',
    }),
  },
  (table) => ({
    transactionUq: uniqueIndex(
      'uq_asset_conversions_transaction'
    ).on(table.financialTransactionId),

    fromAssetIdx: index(
      'idx_asset_conversions_from_asset'
    ).on(table.fromAssetId),

    toAssetIdx: index(
      'idx_asset_conversions_to_asset'
    ).on(table.toAssetId),

    statusIdx: index(
      'idx_asset_conversions_status'
    ).on(table.status),

    createdIdx: index(
      'idx_asset_conversions_created'
    ).on(table.createdAt),

    statusCheck: check(
      'ck_asset_conversions_status',
      sql`${table.status} IN (
        'pending',
        'processing',
        'completed',
        'failed',
        'cancelled'
      )`
    ),

    fromAmountCheck: check(
      'ck_asset_conversions_from_amount_canonical',
      sql`
        ${table.fromAmountBaseUnits} GLOB '[1-9]*'
        AND ${table.fromAmountBaseUnits} NOT GLOB '*[^0-9]*'
        AND (
          length(${table.fromAmountBaseUnits}) < 16
          OR (
            length(${table.fromAmountBaseUnits}) = 16
            AND ${table.fromAmountBaseUnits} <= '9007199254740991'
          )
        )
      `
    ),

    toAmountCheck: check(
      'ck_asset_conversions_to_amount_canonical',
      sql`
        ${table.toAmountBaseUnits} GLOB '[1-9]*'
        AND ${table.toAmountBaseUnits} NOT GLOB '*[^0-9]*'
        AND (
          length(${table.toAmountBaseUnits}) < 16
          OR (
            length(${table.toAmountBaseUnits}) = 16
            AND ${table.toAmountBaseUnits} <= '9007199254740991'
          )
        )
      `
    ),

    feeCheck: check(
      'ck_asset_conversions_fee_canonical',
      sql`
        (
          ${table.feeAmountBaseUnits} = '0'
          OR (
            ${table.feeAmountBaseUnits} GLOB '[1-9]*'
            AND ${table.feeAmountBaseUnits} NOT GLOB '*[^0-9]*'
          )
        )
        AND (
          length(${table.feeAmountBaseUnits}) < 16
          OR (
            length(${table.feeAmountBaseUnits}) = 16
            AND ${table.feeAmountBaseUnits} <= '9007199254740991'
          )
        )
      `
    ),

    assetsDifferentCheck: check(
      'ck_asset_conversions_different_assets',
      sql`${table.fromAssetId} <> ${table.toAssetId}`
    ),

    rateNumeratorCheck: check(
      'ck_asset_conversions_numerator_canonical',
      sql`
        ${table.rateNumerator} GLOB '[1-9]*'
        AND ${table.rateNumerator} NOT GLOB '*[^0-9]*'
        AND (
          length(${table.rateNumerator}) < 16
          OR (
            length(${table.rateNumerator}) = 16
            AND ${table.rateNumerator} <= '9007199254740991'
          )
        )
      `
    ),

    rateDenominatorCheck: check(
      'ck_asset_conversions_denominator_canonical',
      sql`
        ${table.rateDenominator} GLOB '[1-9]*'
        AND ${table.rateDenominator} NOT GLOB '*[^0-9]*'
        AND (
          length(${table.rateDenominator}) < 16
          OR (
            length(${table.rateDenominator}) = 16
            AND ${table.rateDenominator} <= '9007199254740991'
          )
        )
      `
    ),

    rateSourceCheck: check(
      'ck_asset_conversions_rate_source',
      sql`${table.rateSource} IS NULL
        OR length(trim(${table.rateSource})) > 0`
    ),

    quotedAtCheck: check(
      'ck_asset_conversions_quoted_at',
      sql`(
        ${table.quotedAt} IS NULL
        OR ${table.quotedAt} >= ${table.createdAt}
      )`
    ),

    completedLifecycleCheck: check(
      'ck_asset_conversions_completed_state',
      sql`(
        ${table.status} = 'completed'
        AND ${table.completedAt} IS NOT NULL
      )
      OR
      (
        ${table.status} != 'completed'
        AND ${table.completedAt} IS NULL
      )`
    ),

    completedTemporalCheck: check(
      'ck_asset_conversions_completed_temporal',
      sql`${table.completedAt} IS NULL
        OR ${table.completedAt} >= ${table.createdAt}`
    ),
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

    recipientAccountId: integer(
      'recipient_account_id'
    ).references(
      () => financialAccounts.id,
      {
        onDelete: 'restrict',
      }
    ),

    feeType: text('fee_type', {
      enum: [
        'platform',
        'withdrawal',
        'payment',
        'conversion',
        'network',
        'other',
      ],
    }).notNull(),

    amountBaseUnits: text(
      'amount_base_units'
    ).notNull(),

    createdAt: integer('created_at', {
      mode: 'timestamp',
    })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    transactionIdx: index(
      'idx_financial_fees_transaction'
    ).on(table.transactionId),

    assetIdx: index(
      'idx_financial_fees_asset'
    ).on(table.assetId),

    recipientIdx: index(
      'idx_financial_fees_recipient_account'
    ).on(table.recipientAccountId),

    feeTypeIdx: index(
      'idx_financial_fees_type'
    ).on(table.feeType),

    feeTypeCheck: check(
      'ck_financial_fees_type',
      sql`${table.feeType} IN (
        'platform',
        'withdrawal',
        'payment',
        'conversion',
        'network',
        'other'
      )`
    ),

    amountCheck: check(
      'ck_financial_fees_amount_canonical',
      sql`
        ${table.amountBaseUnits} GLOB '[1-9]*'
        AND ${table.amountBaseUnits} NOT GLOB '*[^0-9]*'
        AND (
          length(${table.amountBaseUnits}) < 16
          OR (
            length(${table.amountBaseUnits}) = 16
            AND ${table.amountBaseUnits} <= '9007199254740991'
          )
        )
      `
    ),
  })
);

/* ============================================================================
 * 15. EXTERNAL FIAT TRANSACTIONS
 * ============================================================================
 *
 * External transactions are provider-scoped references.
 *
 * providerId is mandatory because an external transaction without a provider
 * cannot be reliably reconciled or traced back to its external system.
 * ============================================================================
 */

export const fiatExternalTransactions = sqliteTable(
  'fiat_external_transactions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),

    financialTransactionId: integer(
      'financial_transaction_id'
    )
      .notNull()
      .references(() => financialTransactions.id, {
        onDelete: 'restrict',
      }),

    providerId: integer('provider_id')
      .notNull()
      .references(() => fiatProviders.id, {
        onDelete: 'restrict',
      }),

    externalTransactionId: text(
      'external_transaction_id'
    ).notNull(),

    type: text('type', {
      enum: [
        'deposit',
        'withdrawal',
        'transfer',
        'payment',
        'refund',
        'fee',
        'other',
      ],
    }).notNull(),

    /**
     * Normalized internal status.
     */
    status: text('status', {
      enum: [
        'pending',
        'processing',
        'completed',
        'failed',
        'cancelled',
        'reversed',
        'unknown',
      ],
    }).notNull(),

    /**
     * Original provider-specific status.
     */
    providerStatus: text('provider_status'),

    createdAt: integer('created_at', {
      mode: 'timestamp',
    })
      .notNull()
      .$defaultFn(() => new Date()),

    updatedAt: integer('updated_at', {
      mode: 'timestamp',
    })
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdateFn(() => new Date()),

    settledAt: integer('settled_at', {
      mode: 'timestamp',
    }),
  },
  (table) => ({
    providerExternalUq: uniqueIndex(
      'uq_fiat_external_transactions_provider_external'
    ).on(
      table.providerId,
      table.externalTransactionId
    ),

    transactionIdx: index(
      'idx_fiat_external_transactions_transaction'
    ).on(table.financialTransactionId),

    providerIdx: index(
      'idx_fiat_external_transactions_provider'
    ).on(table.providerId),

    statusIdx: index(
      'idx_fiat_external_transactions_status'
    ).on(table.status),

    externalIdCheck: check(
      'ck_fiat_external_transaction_id_nonempty',
      sql`length(trim(${table.externalTransactionId})) > 0`
    ),

    typeCheck: check(
      'ck_fiat_external_transaction_type',
      sql`${table.type} IN (
        'deposit',
        'withdrawal',
        'transfer',
        'payment',
        'refund',
        'fee',
        'other'
      )`
    ),

    statusCheck: check(
      'ck_fiat_external_transaction_status',
      sql`${table.status} IN (
        'pending',
        'processing',
        'completed',
        'failed',
        'cancelled',
        'reversed',
        'unknown'
      )`
    ),

    providerStatusCheck: check(
      'ck_fiat_external_provider_status',
      sql`${table.providerStatus} IS NULL
        OR length(trim(${table.providerStatus})) > 0`
    ),

    settledTemporalCheck: check(
      'ck_fiat_external_transaction_settled_at',
      sql`${table.settledAt} IS NULL
        OR ${table.settledAt} >= ${table.createdAt}`
    ),

    completedSettlementCheck: check(
      'ck_fiat_external_completed_settlement',
      sql`(
        ${table.status} = 'completed'
        AND ${table.settledAt} IS NOT NULL
      )
      OR
      ${table.status} != 'completed'`
    ),
  })
);

/* ============================================================================
 * 16. IDEMPOTENCY KEYS
 * ============================================================================
 *
 * Canonical table is owned by infrastructure.
 * Finance re-exports it to preserve Finance schema aggregation.
 * ============================================================================
 */

export { idempotencyKeys } from '../infrastructure/tables';

/* ============================================================================
 * 17. RECONCILIATION RECORDS
 * ============================================================================
 *
 * Reconciliation lifecycle:
 *
 * pending
 *    |
 *    +---- difference = 0 ----> matched
 *    |
 *    +---- difference != 0 ---> mismatch
 *                                  |
 *                                  v
 *                               resolved
 *
 * IMPORTANT:
 * status no longer defaults to "matched".
 *
 * A record should be created as pending and materialized by the reconciliation
 * service only after expected/actual/difference have been computed.
 * ============================================================================
 */

export const reconciliationRecords = sqliteTable(
  'reconciliation_records',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),

    providerId: integer('provider_id').references(
      () => fiatProviders.id,
      {
        onDelete: 'restrict',
      }
    ),

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

    expectedBalanceBaseUnits: text(
      'expected_balance_base_units'
    ).notNull(),

    actualBalanceBaseUnits: text(
      'actual_balance_base_units'
    ).notNull(),

    /**
     * Signed value:
     *
     * difference = actual - expected
     *
     * Canonical representation:
     *   0
     *   123
     *   -123
     */
    differenceBaseUnits: text(
      'difference_base_units'
    ).notNull(),

    status: text('status', {
      enum: [
        'pending',
        'matched',
        'mismatch',
        'resolved',
      ],
    })
      .notNull()
      .default('pending'),

    reconciliationRunId: text(
      'reconciliation_run_id'
    ).notNull(),

    version: integer('version')
      .notNull()
      .default(1),

    reconciliationDate: integer(
      'reconciliation_date',
      { mode: 'timestamp' }
    )
      .notNull()
      .$defaultFn(() => new Date()),

    resolvedAt: integer('resolved_at', {
      mode: 'timestamp',
    }),

    resolvedByUserId: integer(
      'resolved_by_user_id'
    ).references(
      () => users.id,
      {
        onDelete: 'restrict',
      }
    ),

    resolutionReason: text(
      'resolution_reason'
    ),

    resolutionReference: text(
      'resolution_reference'
    ),
  },
  (table) => ({
    /**
     * One reconciliation snapshot per run/account/asset/provider.
     */
    runScopeUq: uniqueIndex(
      'uq_reconciliation_run_scope'
    ).on(
      table.reconciliationRunId,
      table.providerId,
      table.accountId,
      table.assetId
    ),

    accountIdx: index(
      'idx_reconciliation_records_account'
    ).on(table.accountId),

    assetIdx: index(
      'idx_reconciliation_records_asset'
    ).on(table.assetId),

    providerIdx: index(
      'idx_reconciliation_records_provider'
    ).on(table.providerId),

    runIdx: index(
      'idx_reconciliation_records_run'
    ).on(table.reconciliationRunId),

    statusIdx: index(
      'idx_reconciliation_records_status'
    ).on(table.status),

    reconciliationDateIdx: index(
      'idx_reconciliation_records_date'
    ).on(table.reconciliationDate),

    runIdCheck: check(
      'ck_reconciliation_run_id_nonempty',
      sql`length(trim(${table.reconciliationRunId})) > 0`
    ),

    statusCheck: check(
      'ck_reconciliation_status',
      sql`${table.status} IN (
        'pending',
        'matched',
        'mismatch',
        'resolved'
      )`
    ),

    expectedCheck: check(
      'ck_reconciliation_expected_canonical',
      sql`
        (
          ${table.expectedBalanceBaseUnits} = '0'
          OR (
            ${table.expectedBalanceBaseUnits} GLOB '[1-9]*'
            AND ${table.expectedBalanceBaseUnits} NOT GLOB '*[^0-9]*'
          )
        )
        AND (
          length(${table.expectedBalanceBaseUnits}) < 16
          OR (
            length(${table.expectedBalanceBaseUnits}) = 16
            AND ${table.expectedBalanceBaseUnits} <= '9007199254740991'
          )
        )
      `
    ),

    actualCheck: check(
      'ck_reconciliation_actual_canonical',
      sql`
        (
          ${table.actualBalanceBaseUnits} = '0'
          OR (
            ${table.actualBalanceBaseUnits} GLOB '[1-9]*'
            AND ${table.actualBalanceBaseUnits} NOT GLOB '*[^0-9]*'
          )
        )
        AND (
          length(${table.actualBalanceBaseUnits}) < 16
          OR (
            length(${table.actualBalanceBaseUnits}) = 16
            AND ${table.actualBalanceBaseUnits} <= '9007199254740991'
          )
        )
      `
    ),

    /**
     * Signed canonical integer.
     *
     * Allows:
     *   0
     *   positive decimal
     *   negative decimal
     *
     * Disallows:
     *   -0
     *   +1
     *   001
     *   01
     *   1.5
     */
    differenceCheck: check(
      'ck_reconciliation_difference_canonical',
      sql`
        (
          ${table.differenceBaseUnits} = '0'
          OR
          (
            ${table.differenceBaseUnits} GLOB '[1-9]*'
            AND ${table.differenceBaseUnits} NOT GLOB '*[^0-9]*'
          )
          OR
          (
            substr(${table.differenceBaseUnits}, 1, 1) = '-'
            AND substr(${table.differenceBaseUnits}, 2) GLOB '[1-9]*'
            AND substr(${table.differenceBaseUnits}, 2) NOT GLOB '*[^0-9]*'
          )
        )
        AND (
          ${table.differenceBaseUnits} = '0'
          OR
          (
            substr(${table.differenceBaseUnits}, 1, 1) != '-'
            AND (
              length(${table.differenceBaseUnits}) < 16
              OR (
                length(${table.differenceBaseUnits}) = 16
                AND ${table.differenceBaseUnits} <= '9007199254740991'
              )
            )
          )
          OR
          (
            substr(${table.differenceBaseUnits}, 1, 1) = '-'
            AND (
              length(${table.differenceBaseUnits}) < 17
              OR (
                length(${table.differenceBaseUnits}) = 17
                AND substr(${table.differenceBaseUnits}, 2) <= '9007199254740991'
              )
            )
          )
        )
      `
    ),

    /**
     * The reconciliation state must agree with the materialized difference.
     *
     * pending:
     *   calculation/resolution process is not finalized.
     *
     * matched:
     *   actual == expected -> difference == 0.
     *
     * mismatch:
     *   actual != expected -> difference != 0.
     *
     * resolved:
     *   mismatch has been acknowledged/resolved by an explicit resolution
     *   record. The original difference is retained for auditability.
     */
    statusDifferenceCheck: check(
      'ck_reconciliation_status_difference',
      sql`(
        ${table.status} = 'pending'
      )
      OR
      (
        ${table.status} = 'matched'
        AND ${table.differenceBaseUnits} = '0'
      )
      OR
      (
        ${table.status} = 'mismatch'
        AND ${table.differenceBaseUnits} != '0'
      )
      OR
      (
        ${table.status} = 'resolved'
        AND ${table.resolutionReason} IS NOT NULL
        AND ${table.resolutionReference} IS NOT NULL
      )`
    ),

    resolvedStateCheck: check(
      'ck_reconciliation_resolved_state',
      sql`(
        ${table.status} = 'resolved'
        AND ${table.resolvedAt} IS NOT NULL
        AND ${table.resolutionReason} IS NOT NULL
        AND ${table.resolutionReference} IS NOT NULL
      )
      OR
      (
        ${table.status} != 'resolved'
        AND ${table.resolvedAt} IS NULL
        AND ${table.resolvedByUserId} IS NULL
        AND ${table.resolutionReason} IS NULL
        AND ${table.resolutionReference} IS NULL
      )`
    ),

    resolutionReasonCheck: check(
      'ck_reconciliation_resolution_reason',
      sql`${table.resolutionReason} IS NULL
        OR length(trim(${table.resolutionReason})) > 0`
    ),

    resolutionReferenceCheck: check(
      'ck_reconciliation_resolution_reference',
      sql`${table.resolutionReference} IS NULL
        OR length(trim(${table.resolutionReference})) > 0`
    ),

    resolvedTemporalCheck: check(
      'ck_reconciliation_resolved_temporal',
      sql`${table.resolvedAt} IS NULL
        OR ${table.resolvedAt} >= ${table.reconciliationDate}`
    ),

    versionCheck: check(
      'ck_reconciliation_records_version',
      sql`${table.version} > 0`
    ),
  })
);
