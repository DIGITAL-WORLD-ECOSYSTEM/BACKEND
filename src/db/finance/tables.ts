import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
  check,
  foreignKey,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core';

import { sql, type SQL } from 'drizzle-orm';

import { users } from '../user/tables';

/**
 * ============================================================================
 * FINANCE DOMAIN
 * ============================================================================
 *
 * Responsibilities:
 * - Financial assets
 * - Financial accounts
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
 * UINT256:
 *   Monetary values use the complete unsigned uint256 range:
 *
 *   0 .. 2^256 - 1
 *
 *   The database MUST NOT impose JavaScript's Number.MAX_SAFE_INTEGER limit.
 *
 * IMPORTANT:
 *   No monetary value is converted through:
 *
 *     number
 *     Number(...)
 *     parseFloat(...)
 *     REAL
 *     FLOAT
 *     DOUBLE
 *     CAST(... AS INTEGER)
 *
 *   SQLite INTEGER is signed 64-bit and is therefore unsuitable for
 *   uint256 arithmetic.
 *
 * ============================================================================
 * DOMAIN VS DATABASE INVARIANTS
 * ============================================================================
 *
 * Database-enforceable:
 *   - canonical representation
 *   - unsigned/signed range
 *   - FK existence
 *   - uniqueness
 *   - row-local state coherence
 *   - temporal relationships
 *
 * Domain/application-enforced:
 *   - FIN-001 aggregate double-entry balance
 *   - exact difference = actual - expected
 *   - cross-table ownership coherence
 *   - aggregate lifecycle transitions
 *   - ledger asset coherence with specialized operation records
 *
 * We deliberately do NOT encode these cross-row/cross-table rules using
 * unsafe SQLite arithmetic.
 *
 * HARDENING CONTRACT:
 *   Cross-row/cross-table invariants remain explicit application/repository
 *   contracts. The authoritative write path MUST atomically enforce:
 *   - FIN-001 double-entry balance per (transactionId, assetId)
 *   - ledger append-only semantics
 *   - transaction/account/user ownership coherence
 *   - specialized transaction/type coherence
 *   - fiat asset/account/provider coherence
 *   - payment-method/account ownership and type coherence
 *   - conversion/exchange-rate pair coherence
 *   - fee/account/asset coherence
 *   - reconciliation scope coherence
 *   - optimistic concurrency through version compare-and-swap
 *
 * These are intentionally not represented as fake row-local SQLite checks.
 * ============================================================================
 */

/**
 * ============================================================================
 * UINT256 CONSTANTS
 * ============================================================================
 */

export const MAX_UINT256_BASE_UNITS_TEXT =
  '115792089237316195423570985008687907853269984665640564039457584007913129639935';

const MAX_UINT256_DECIMAL_DIGITS = 78;

const SIGNED_UINT256_MAX_DECIMAL_DIGITS =
  MAX_UINT256_DECIMAL_DIGITS + 1;

/**
 * ============================================================================
 * SHARED CANONICAL-AMOUNT SQL HELPERS
 * ============================================================================
 */

/**
 * Applies the uint256 upper-bound rule to a canonical decimal string.
 *
 * This helper MUST only be used after the caller has constrained the value
 * to the relevant sign/digit syntax.
 */
function uint256UpperBoundSql(column: AnySQLiteColumn): SQL {
  return sql`
    (
      length(${column}) < ${MAX_UINT256_DECIMAL_DIGITS}
      OR (
        length(${column}) = ${MAX_UINT256_DECIMAL_DIGITS}
        AND ${column} <= ${MAX_UINT256_BASE_UNITS_TEXT}
      )
    )
  `;
}

/**
 * Strictly positive canonical unsigned uint256.
 *
 * Accepted:
 *   1
 *   10
 *   MAX_UINT256
 *
 * Rejected:
 *   0
 *   00
 *   001
 *   +1
 *   -1
 *   1.0
 */
function canonicalUnsignedAmountSql(column: AnySQLiteColumn): SQL {
  return sql`
    ${column} GLOB '[1-9]*'
    AND ${column} NOT GLOB '*[^0-9]*'
    AND ${uint256UpperBoundSql(column)}
  `;
}

/**
 * Canonical unsigned uint256 where zero is also allowed.
 */
function canonicalUnsignedOrZeroAmountSql(
  column: AnySQLiteColumn,
): SQL {
  return sql`
    (
      ${column} = '0'
      OR (
        ${column} GLOB '[1-9]*'
        AND ${column} NOT GLOB '*[^0-9]*'
      )
    )
    AND ${uint256UpperBoundSql(column)}
  `;
}

/**
 * Canonical signed delta.
 *
 * Accepted:
 *   0
 *   1
 *   MAX_UINT256
 *   -1
 *   -MAX_UINT256
 *
 * Rejected:
 *   -0
 *   +1
 *   leading zeros
 *   decimal notation
 *   values whose magnitude > MAX_UINT256
 */
function canonicalSignedAmountSql(
  column: AnySQLiteColumn,
): SQL {
  return sql`
    (
      ${column} = '0'

      OR

      (
        ${column} GLOB '[1-9]*'
        AND ${column} NOT GLOB '*[^0-9]*'
        AND ${uint256UpperBoundSql(column)}
      )

      OR

      (
        substr(${column}, 1, 1) = '-'
        AND substr(${column}, 2) GLOB '[1-9]*'
        AND substr(${column}, 2) NOT GLOB '*[^0-9]*'
        AND (
          length(${column}) < ${SIGNED_UINT256_MAX_DECIMAL_DIGITS}
          OR (
            length(${column}) = ${SIGNED_UINT256_MAX_DECIMAL_DIGITS}
            AND substr(${column}, 2) <= ${MAX_UINT256_BASE_UNITS_TEXT}
          )
        )
      )
    )
  `;
}

/* ============================================================================
 * 1. FINANCIAL ASSETS
 * ========================================================================== */

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

    createdAt: integer('created_at', {
      mode: 'timestamp_ms',
    })
      .notNull()
      .$defaultFn(() => new Date()),

    updatedAt: integer('updated_at', {
      mode: 'timestamp_ms',
    })
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdateFn(() => new Date()),
  },

  (table) => ({
    codeUq: uniqueIndex(
      'uq_financial_assets_code',
    ).on(table.code),

    typeIdx: index(
      'idx_financial_assets_type',
    ).on(table.type),

    statusIdx: index(
      'idx_financial_assets_status',
    ).on(table.status),

    codeCheck: check(
      'ck_financial_assets_code_canonical',
      sql`${table.code} = upper(trim(${table.code})) AND length(${table.code}) > 0`,
    ),

    symbolCheck: check(
      'ck_financial_assets_symbol_canonical',
      sql`${table.symbol} = upper(trim(${table.symbol})) AND length(${table.symbol}) > 0`,
    ),

    nameCheck: check(
      'ck_financial_assets_name_nonempty',
      sql`length(trim(${table.name})) > 0`,
    ),

    typeCheck: check(
      'ck_financial_assets_type',
      sql`${table.type} IN ('fiat', 'crypto')`,
    ),

    statusCheck: check(
      'ck_financial_assets_status',
      sql`${table.status} IN ('active', 'inactive')`,
    ),

    decimalsCheck: check(
      'ck_financial_assets_decimals',
      sql`${table.decimals} >= 0 AND ${table.decimals} <= 18`,
    ),

    decimalsByTypeCheck: check(
      'ck_financial_assets_decimals_by_type',
      sql`(
        ${table.type} = 'fiat'
        AND ${table.decimals} BETWEEN 0 AND 6
      )
      OR
      (
        ${table.type} = 'crypto'
        AND ${table.decimals} BETWEEN 0 AND 18
      )`,
    ),
  }),
);

/* ============================================================================
 * 2. FINANCIAL ACCOUNTS
 * ========================================================================== */

export const financialAccounts = sqliteTable(
  'financial_accounts',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),

    userId: integer('user_id').references(
      () => users.id,
      {
        onDelete: 'restrict',
      },
    ),

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
      enum: [
        'active',
        'inactive',
        'suspended',
      ],
    })
      .notNull()
      .default('active'),

    name: text('name').notNull(),

    version: integer('version')
      .notNull()
      .default(1),

    createdAt: integer('created_at', {
      mode: 'timestamp_ms',
    })
      .notNull()
      .$defaultFn(() => new Date()),

    updatedAt: integer('updated_at', {
      mode: 'timestamp_ms',
    })
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdateFn(() => new Date()),
  },

  (table) => ({
    userIdx: index(
      'idx_financial_accounts_user',
    ).on(table.userId),

    typeIdx: index(
      'idx_financial_accounts_type',
    ).on(table.accountType),

    classIdx: index(
      'idx_financial_accounts_class',
    ).on(table.accountClass),

    statusIdx: index(
      'idx_financial_accounts_status',
    ).on(table.status),

    nameCheck: check(
      'ck_financial_accounts_name_nonempty',
      sql`length(trim(${table.name})) > 0`,
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
      )`,
    ),

    accountClassCheck: check(
      'ck_financial_accounts_class',
      sql`${table.accountClass} IN (
        'asset',
        'liability',
        'equity',
        'revenue',
        'expense'
      )`,
    ),

    statusCheck: check(
      'ck_financial_accounts_status',
      sql`${table.status} IN (
        'active',
        'inactive',
        'suspended'
      )`,
    ),

    accountTypeClassCheck: check(
      'ck_financial_accounts_type_class_matrix',
      sql`(
        (
          ${table.accountType} = 'user_available'
          AND ${table.accountClass} = 'liability'
        )
        OR
        (
          ${table.accountType} = 'treasury'
          AND ${table.accountClass} = 'asset'
        )
        OR
        (
          ${table.accountType} = 'operating'
          AND ${table.accountClass} = 'asset'
        )
        OR
        (
          ${table.accountType} = 'reserve'
          AND ${table.accountClass} IN (
            'asset',
            'liability'
          )
        )
        OR
        (
          ${table.accountType} = 'fees'
          AND ${table.accountClass} = 'revenue'
        )
        OR
        (
          ${table.accountType} = 'escrow'
          AND ${table.accountClass} = 'liability'
        )
        OR
        (
          ${table.accountType} = 'reward_expense'
          AND ${table.accountClass} = 'expense'
        )
        OR
        (
          ${table.accountType} = 'yield_expense'
          AND ${table.accountClass} = 'expense'
        )
        OR
        (
          ${table.accountType} = 'clearing'
          AND ${table.accountClass} IN (
            'asset',
            'liability'
          )
        )
        OR
        (
          ${table.accountType} = 'opening_balance_equity'
          AND ${table.accountClass} IN (
            'equity',
            'liability'
          )
        )
        OR
        (
          ${table.accountType} = 'payment_revenue'
          AND ${table.accountClass} = 'revenue'
        )
        OR
        (
          ${table.accountType} = 'refund_expense'
          AND ${table.accountClass} = 'expense'
        )
      )`,
    ),

    userAccountTypeUq: uniqueIndex(
      'uq_financial_accounts_user_type_name',
    ).on(
      table.userId,
      table.accountType,
      table.name,
    ),

    /**
     * SQLite treats NULLs as distinct for uniqueness.
     *
     * This partial unique index closes the system-account gap where
     * userId IS NULL.
     */
    systemAccountTypeNameUq: uniqueIndex(
      'uq_financial_accounts_system_type_name',
    )
      .on(
        table.accountType,
        table.name,
      )
      .where(
        sql`${table.userId} IS NULL`,
      ),

    activeTreasurySingletonUnq: uniqueIndex(
      'uq_treasury_active_singleton',
    )
      .on(table.accountType)
      .where(
        sql`${table.accountType} = 'treasury'
          AND ${table.status} = 'active'`,
      ),

    activeOperatingSingletonUnq: uniqueIndex(
      'uq_operating_active_singleton',
    )
      .on(table.accountType)
      .where(
        sql`${table.accountType} = 'operating'
          AND ${table.status} = 'active'`,
      ),

    activeFeesSingletonUnq: uniqueIndex(
      'uq_fees_active_singleton',
    )
      .on(table.accountType)
      .where(
        sql`${table.accountType} = 'fees'
          AND ${table.status} = 'active'`,
      ),

    userAvailableSingletonUnq: uniqueIndex(
      'uq_user_available_singleton',
    )
      .on(table.userId)
      .where(
        sql`${table.accountType} = 'user_available'`,
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
      )`,
    ),

    versionCheck: check(
      'ck_financial_accounts_version',
      sql`${table.version} > 0`,
    ),

    // `version` is a concurrency token. Repository updates MUST use compare-and-swap
    // (WHERE id = ? AND version = ?) and increment it atomically.
  }),
);

/* ============================================================================
 * 3. FINANCIAL TRANSACTIONS
 * ========================================================================== */

export const financialTransactions = sqliteTable(
  'financial_transactions',
  {
    id: integer('id').primaryKey({
      autoIncrement: true,
    }),

    userId: integer('user_id').references(
      () => users.id,
      {
        onDelete: 'restrict',
      },
    ),

    /**
     * Self-referencing foreign keys.
     *
     * AnySQLiteColumn is used instead of any to preserve type safety while
     * avoiding the circular type-inference problem of self-referential
     * Drizzle tables.
     */
    reversalOfTransactionId: integer(
      'reversal_of_transaction_id',
    ).references(
      (): AnySQLiteColumn =>
        financialTransactions.id,
      {
        onDelete: 'restrict',
      },
    ),

    refundOfTransactionId: integer(
      'refund_of_transaction_id',
    ).references(
      (): AnySQLiteColumn =>
        financialTransactions.id,
      {
        onDelete: 'restrict',
      },
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

    version: integer('version')
      .notNull()
      .default(1),

    createdAt: integer('created_at', {
      mode: 'timestamp_ms',
    })
      .notNull()
      .$defaultFn(() => new Date()),

    updatedAt: integer('updated_at', {
      mode: 'timestamp_ms',
    })
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdateFn(() => new Date()),

    completedAt: integer('completed_at', {
      mode: 'timestamp_ms',
    }),
  },

  (table) => ({
    userIdx: index(
      'idx_financial_transactions_user',
    ).on(table.userId),

    typeIdx: index(
      'idx_financial_transactions_type',
    ).on(table.type),

    statusIdx: index(
      'idx_financial_transactions_status',
    ).on(table.status),

    createdIdx: index(
      'idx_financial_transactions_created',
    ).on(table.createdAt),

    correlationIdx: index(
      'idx_financial_transactions_correlation',
    ).on(table.correlationId),

    activeReversalUq: uniqueIndex(
      'uq_financial_tx_active_reversal',
    )
      .on(table.reversalOfTransactionId)
      .where(
        sql`${table.reversalOfTransactionId} IS NOT NULL
          AND ${table.status} NOT IN ('failed', 'cancelled')`,
      ),

    refundIdx: index(
      'idx_financial_transactions_refund_of',
    ).on(table.refundOfTransactionId),

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
      )`,
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
      )`,
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
      )`,
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
        )`,
    ),

    descriptionCheck: check(
      'ck_financial_tx_description_nonempty',
      sql`length(trim(${table.description})) > 0`,
    ),

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
      )`,
    ),

    correlationCheck: check(
      'ck_financial_tx_correlation_nonempty',
      sql`${table.correlationId} IS NULL
        OR length(trim(${table.correlationId})) > 0`,
    ),

    reversalCoherenceCheck: check(
      'ck_financial_tx_reversal_coherence',
      sql`(
        ${table.reversalOfTransactionId} IS NULL
        OR (
          ${table.type} = 'reversal'
          AND ${table.reversalOfTransactionId} != ${table.id}
        )
      )`,
    ),

    refundCoherenceCheck: check(
      'ck_financial_tx_refund_coherence',
      sql`(
        ${table.refundOfTransactionId} IS NULL
        OR (
          ${table.type} = 'refund'
          AND ${table.refundOfTransactionId} != ${table.id}
        )
      )`,
    ),

    reversalRefundExclusiveCheck: check(
      'ck_financial_tx_reversal_refund_exclusive',
      sql`NOT (
        ${table.reversalOfTransactionId} IS NOT NULL
        AND ${table.refundOfTransactionId} IS NOT NULL
      )`,
    ),

    typedSourceReferenceCheck: check(
      'ck_financial_tx_typed_reference_required',
      sql`(
        (
          ${table.type} = 'reversal'
          AND ${table.reversalOfTransactionId} IS NOT NULL
        )
        OR
        (
          ${table.type} = 'refund'
          AND ${table.refundOfTransactionId} IS NOT NULL
        )
        OR
        (
          ${table.type} NOT IN (
            'reversal',
            'refund'
          )
        )
      )`,
    ),

    /**
     * Completed transactions retain their historical completion timestamp
     * even when later transitioned to reversed/refunded.
     */
    completedStateCheck: check(
      'ck_financial_tx_completed_state',
      sql`(
        ${table.status} IN (
          'completed',
          'reversed',
          'refunded'
        )
        AND ${table.completedAt} IS NOT NULL
      )
      OR
      (
        ${table.status} NOT IN (
          'completed',
          'reversed',
          'refunded'
        )
        AND ${table.completedAt} IS NULL
      )`,
    ),

    temporalOrderCheck: check(
      'ck_financial_tx_dates',
      sql`${table.completedAt} IS NULL
        OR ${table.completedAt} >= ${table.createdAt}`,
    ),

    versionCheck: check(
      'ck_financial_tx_version',
      sql`${table.version} > 0`,
    ),

    // `version` is a concurrency token. Repository updates MUST compare the
    // expected version and increment it atomically.
  }),
);

/* ============================================================================
 * 4. FINANCIAL LEDGER ENTRIES
 * ============================================================================
 *
 * FIN-001:
 *
 *   For every (transactionId, assetId):
 *
 *       SUM(debits) == SUM(credits)
 *
 * SQLite CHECK constraints are row-local and cannot safely aggregate uint256
 * decimal strings.
 *
 * Therefore FIN-001 MUST remain enforced by the domain/application posting
 * authority and by transactional repository integration tests.
 *
 * LEDGER IMMUTABILITY:
 *   This table is a historical journal. Production code MUST expose it as
 *   append-only: INSERT is the normal mutation; UPDATE/DELETE of historical
 *   ledger rows must be rejected by the repository. Corrections are represented
 *   by new transactions such as reversal/adjustment entries.
 *
 * DO NOT use:
 *
 *   CAST(amount_base_units AS INTEGER)
 *
 * for this invariant.
 *
 * SQLite INTEGER is signed 64-bit and cannot represent uint256.
 * ========================================================================== */

export const financialLedgerEntries = sqliteTable(
  'financial_ledger_entries',
  {
    id: integer('id').primaryKey({
      autoIncrement: true,
    }),

    transactionId: integer('transaction_id')
      .notNull()
      .references(
        () => financialTransactions.id,
        {
          onDelete: 'restrict',
        },
      ),

    accountId: integer('account_id')
      .notNull()
      .references(
        () => financialAccounts.id,
        {
          onDelete: 'restrict',
        },
      ),

    assetId: integer('asset_id')
      .notNull()
      .references(
        () => financialAssets.id,
        {
          onDelete: 'restrict',
        },
      ),

    direction: text('direction', {
      enum: [
        'debit',
        'credit',
      ],
    }).notNull(),

    amountBaseUnits: text(
      'amount_base_units',
    ).notNull(),

    createdAt: integer('created_at', {
      mode: 'timestamp_ms',
    })
      .notNull()
      .$defaultFn(() => new Date()),
  },

  (table) => ({
    accountAssetEntryIdx: index(
      'idx_financial_ledger_entries_account_asset_id',
    ).on(
      table.accountId,
      table.assetId,
      table.id,
    ),

    transactionIdx: index(
      'idx_financial_ledger_entries_transaction',
    ).on(table.transactionId),

    accountIdx: index(
      'idx_financial_ledger_entries_account',
    ).on(table.accountId),

    assetIdx: index(
      'idx_financial_ledger_entries_asset',
    ).on(table.assetId),

    createdIdx: index(
      'idx_financial_ledger_entries_created',
    ).on(table.createdAt),

    directionCheck: check(
      'ck_financial_ledger_direction',
      sql`${table.direction} IN (
        'debit',
        'credit'
      )`,
    ),

    amountCheck: check(
      'ck_financial_ledger_entries_amount_canonical',
      canonicalUnsignedAmountSql(
        table.amountBaseUnits,
      ),
    ),
  }),
);

/* ============================================================================
 * 5. ACCOUNT BALANCES
 * ========================================================================== */

export const accountBalances = sqliteTable(
  'account_balances',
  {
    id: integer('id').primaryKey({
      autoIncrement: true,
    }),

    accountId: integer('account_id')
      .notNull()
      .references(
        () => financialAccounts.id,
        {
          onDelete: 'restrict',
        },
      ),

    assetId: integer('asset_id')
      .notNull()
      .references(
        () => financialAssets.id,
        {
          onDelete: 'restrict',
        },
      ),

    availableBaseUnits: text(
      'available_base_units',
    )
      .notNull()
      .default('0'),

    lockedBaseUnits: text(
      'locked_base_units',
    )
      .notNull()
      .default('0'),

    version: integer('version')
      .notNull()
      .default(1),

    createdAt: integer('created_at', {
      mode: 'timestamp_ms',
    })
      .notNull()
      .$defaultFn(() => new Date()),

    updatedAt: integer('updated_at', {
      mode: 'timestamp_ms',
    })
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdateFn(() => new Date()),
  },

  (table) => ({
    accountAssetUq: uniqueIndex(
      'uq_account_balances_account_asset',
    ).on(
      table.accountId,
      table.assetId,
    ),

    accountIdx: index(
      'idx_account_balances_account',
    ).on(table.accountId),

    assetIdx: index(
      'idx_account_balances_asset',
    ).on(table.assetId),

    availableCheck: check(
      'ck_account_balances_available_canonical',
      canonicalUnsignedOrZeroAmountSql(
        table.availableBaseUnits,
      ),
    ),

    lockedCheck: check(
      'ck_account_balances_locked_canonical',
      canonicalUnsignedOrZeroAmountSql(
        table.lockedBaseUnits,
      ),
    ),

    versionCheck: check(
      'ck_account_balances_version',
      sql`${table.version} > 0`,
    ),
  }),
);

/* ============================================================================
 * 6. BALANCE HOLDS
 * ========================================================================== */

export const balanceHolds = sqliteTable(
  'balance_holds',
  {
    id: integer('id').primaryKey({
      autoIncrement: true,
    }),

    accountId: integer('account_id')
      .notNull()
      .references(
        () => financialAccounts.id,
        {
          onDelete: 'restrict',
        },
      ),

    assetId: integer('asset_id')
      .notNull()
      .references(
        () => financialAssets.id,
        {
          onDelete: 'restrict',
        },
      ),

    amountBaseUnits: text(
      'amount_base_units',
    ).notNull(),

    reason: text('reason').notNull(),

    referenceType: text(
      'reference_type',
    ),

    referenceId: text(
      'reference_id',
    ),

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

    version: integer('version')
      .notNull()
      .default(1),

    expiresAt: integer('expires_at', {
      mode: 'timestamp_ms',
    }),

    createdAt: integer('created_at', {
      mode: 'timestamp_ms',
    })
      .notNull()
      .$defaultFn(() => new Date()),

    updatedAt: integer('updated_at', {
      mode: 'timestamp_ms',
    })
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdateFn(() => new Date()),

    releasedAt: integer('released_at', {
      mode: 'timestamp_ms',
    }),

    releasedByTransactionId: integer(
      'released_by_transaction_id',
    ).references(
      () => financialTransactions.id,
      {
        onDelete: 'restrict',
      },
    ),

    consumedAt: integer('consumed_at', {
      mode: 'timestamp_ms',
    }),

    consumedByTransactionId: integer(
      'consumed_by_transaction_id',
    ).references(
      () => financialTransactions.id,
      {
        onDelete: 'restrict',
      },
    ),
  },

  (table) => ({
    accountIdx: index(
      'idx_balance_holds_account',
    ).on(table.accountId),

    assetIdx: index(
      'idx_balance_holds_asset',
    ).on(table.assetId),

    statusIdx: index(
      'idx_balance_holds_status',
    ).on(table.status),

    referenceIdx: index(
      'idx_balance_holds_reference',
    ).on(
      table.referenceType,
      table.referenceId,
    ),

    activeReferenceUq: uniqueIndex(
      'uq_balance_holds_active_reference',
    )
      .on(
        table.referenceType,
        table.referenceId,
      )
      .where(
        sql`${table.referenceType} IS NOT NULL
          AND ${table.referenceId} IS NOT NULL
          AND ${table.status} = 'active'`,
      ),

    releaseTransactionIdx: index(
      'idx_balance_holds_release_transaction',
    ).on(table.releasedByTransactionId),

    consumedTransactionIdx: index(
      'idx_balance_holds_consumed_transaction',
    ).on(table.consumedByTransactionId),

    statusCheck: check(
      'ck_balance_holds_status',
      sql`${table.status} IN (
        'active',
        'released',
        'expired',
        'consumed'
      )`,
    ),

    reasonCheck: check(
      'ck_balance_holds_reason_nonempty',
      sql`length(trim(${table.reason})) > 0`,
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
      )`,
    ),

    amountCheck: check(
      'ck_balance_holds_amount_canonical',
      canonicalUnsignedAmountSql(
        table.amountBaseUnits,
      ),
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
      )`,
    ),

    /**
     * `expired` is a persisted state. The transition to expired MUST be
     * performed by a transactional command that validates expiresAt <= now
     * and wins the hold's version compare-and-swap.
     */
    expiredStateCheck: check(
      'ck_balance_holds_expired_state',
      sql`(
        ${table.status} = 'expired'
        AND ${table.expiresAt} IS NOT NULL
        AND ${table.consumedAt} IS NULL
        AND ${table.releasedAt} IS NULL
      )
      OR
      ${table.status} != 'expired'`,
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
      )`,
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
      ${table.status} != 'active'`,
    ),

    expirationTemporalCheck: check(
      'ck_balance_holds_expiration_temporal',
      sql`${table.expiresAt} IS NULL
        OR ${table.expiresAt} > ${table.createdAt}`,
    ),

    lifecycleTemporalCheck: check(
      'ck_balance_holds_lifecycle_temporal',
      sql`(
        (
          ${table.releasedAt} IS NULL
          OR ${table.releasedAt} >= ${table.createdAt}
        )
        AND
        (
          ${table.consumedAt} IS NULL
          OR ${table.consumedAt} >= ${table.createdAt}
        )
      )`,
    ),

    versionCheck: check(
      'ck_balance_holds_version',
      sql`${table.version} > 0`,
    ),

    // Hold lifecycle mutations MUST use status + version compare-and-swap
    // to prevent concurrent consume/release races.
  }),
);

/* ============================================================================
 * 7. FIAT PROVIDERS
 * ========================================================================== */

export const fiatProviders = sqliteTable(
  'fiat_providers',
  {
    id: integer('id').primaryKey({
      autoIncrement: true,
    }),

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
      mode: 'timestamp_ms',
    })
      .notNull()
      .$defaultFn(() => new Date()),

    updatedAt: integer('updated_at', {
      mode: 'timestamp_ms',
    })
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdateFn(() => new Date()),
  },

  (table) => ({
    codeUq: uniqueIndex(
      'uq_fiat_providers_code',
    ).on(table.code),

    typeIdx: index(
      'idx_fiat_providers_type',
    ).on(table.type),

    statusIdx: index(
      'idx_fiat_providers_status',
    ).on(table.status),

    nameCheck: check(
      'ck_fiat_providers_name_nonempty',
      sql`length(trim(${table.name})) > 0`,
    ),

    codeCheckCanonical: check(
      'ck_fiat_providers_code_canonical',
      sql`${table.code} = upper(trim(${table.code})) AND length(${table.code}) > 0`,
    ),

    typeCheck: check(
      'ck_fiat_providers_type',
      sql`${table.type} IN (
        'bank',
        'payment_provider',
        'pix_provider',
        'gateway'
      )`,
    ),

    statusCheck: check(
      'ck_fiat_providers_status',
      sql`${table.status} IN (
        'active',
        'inactive',
        'suspended'
      )`,
    ),
  }),
);

/* ============================================================================
 * 8. FIAT ACCOUNTS
 * ========================================================================== */

export const fiatAccounts = sqliteTable(
  'fiat_accounts',
  {
    id: integer('id').primaryKey({
      autoIncrement: true,
    }),

    userId: integer('user_id')
      .notNull()
      .references(
        () => users.id,
        {
          onDelete: 'restrict',
        },
      ),

    assetId: integer('asset_id')
      .notNull()
      .references(
        () => financialAssets.id,
        {
          onDelete: 'restrict',
        },
      ),

    providerId: integer(
      'provider_id',
    ).references(
      () => fiatProviders.id,
      {
        onDelete: 'restrict',
      },
    ),

    type: text('type', {
      enum: [
        'bank_account',
        'payment_account',
        'pix_account',
      ],
    }).notNull(),

    externalAccountId: text(
      'external_account_id',
    ),

    displayName: text(
      'display_name',
    ),

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
      mode: 'timestamp_ms',
    })
      .notNull()
      .$defaultFn(() => new Date()),

    updatedAt: integer('updated_at', {
      mode: 'timestamp_ms',
    })
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdateFn(() => new Date()),

    blockedAt: integer('blocked_at', {
      mode: 'timestamp_ms',
    }),
  },

  (table) => ({
    userAccountCompositeUq: uniqueIndex(
      'uq_fiat_accounts_user_id_id',
    ).on(
      table.userId,
      table.id,
    ),

    userIdx: index(
      'idx_fiat_accounts_user',
    ).on(table.userId),

    assetIdx: index(
      'idx_fiat_accounts_asset',
    ).on(table.assetId),

    providerIdx: index(
      'idx_fiat_accounts_provider',
    ).on(table.providerId),

    statusIdx: index(
      'idx_fiat_accounts_status',
    ).on(table.status),

    typeIdx: index(
      'idx_fiat_accounts_type',
    ).on(table.type),

    typeCheck: check(
      'ck_fiat_accounts_type',
      sql`${table.type} IN (
        'bank_account',
        'payment_account',
        'pix_account'
      )`,
    ),

    statusCheck: check(
      'ck_fiat_accounts_status',
      sql`${table.status} IN (
        'active',
        'inactive',
        'blocked'
      )`,
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
      )`,
    ),

    displayNameCheck: check(
      'ck_fiat_accounts_display_name_nonempty',
      sql`${table.displayName} IS NULL
        OR length(trim(${table.displayName})) > 0`,
    ),

    last4Check: check(
      'ck_fiat_accounts_last4',
      sql`${table.last4} IS NULL
        OR (
          length(${table.last4}) BETWEEN 2 AND 4
          AND ${table.last4} NOT GLOB '*[^0-9]*'
        )`,
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
      )`,
    ),

    blockedTemporalCheck: check(
      'ck_fiat_accounts_blocked_temporal',
      sql`${table.blockedAt} IS NULL
        OR ${table.blockedAt} >= ${table.createdAt}`,
    ),

    externalUq: uniqueIndex(
      'uq_fiat_accounts_provider_external',
    ).on(
      table.providerId,
      table.externalAccountId,
    ),
  }),
);

/* ============================================================================
 * 9. FIAT PAYMENT METHODS
 * ========================================================================== */

export const fiatPaymentMethods = sqliteTable(
  'fiat_payment_methods',
  {
    id: integer('id').primaryKey({
      autoIncrement: true,
    }),

    userId: integer('user_id')
      .notNull()
      .references(
        () => users.id,
        {
          onDelete: 'restrict',
        },
      ),

    fiatAccountId: integer(
      'fiat_account_id',
    ).notNull(),

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
      mode: 'timestamp_ms',
    })
      .notNull()
      .$defaultFn(() => new Date()),

    updatedAt: integer('updated_at', {
      mode: 'timestamp_ms',
    })
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdateFn(() => new Date()),

    blockedAt: integer('blocked_at', {
      mode: 'timestamp_ms',
    }),
  },

  (table) => ({
    /**
     * Ownership-preserving composite FK.
     *
     * This guarantees:
     *
     *   fiatPaymentMethods.userId
     *       +
     *   fiatPaymentMethods.fiatAccountId
     *
     * refers to the same owner/account pair.
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

      name:
        'fk_fiat_payment_methods_user_account',
    }).onDelete('restrict'),

    userIdx: index(
      'idx_fiat_payment_methods_user',
    ).on(table.userId),

    accountIdx: index(
      'idx_fiat_payment_methods_account',
    ).on(table.fiatAccountId),

    typeIdx: index(
      'idx_fiat_payment_methods_type',
    ).on(table.type),

    statusIdx: index(
      'idx_fiat_payment_methods_status',
    ).on(table.status),

    typeCheck: check(
      'ck_fiat_pm_type',
      sql`${table.type} IN (
        'pix',
        'bank_transfer',
        'boleto',
        'card'
      )`,
    ),

    labelCheck: check(
      'ck_fiat_pm_label_nonempty',
      sql`length(trim(${table.label})) > 0`,
    ),

    statusCheck: check(
      'ck_fiat_pm_status',
      sql`${table.status} IN (
        'active',
        'inactive',
        'blocked'
      )`,
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
      )`,
    ),

    blockedTemporalCheck: check(
      'ck_fiat_pm_blocked_temporal',
      sql`${table.blockedAt} IS NULL
        OR ${table.blockedAt} >= ${table.createdAt}`,
    ),
  }),
);

/* ============================================================================
 * 10. FIAT TRANSACTIONS
 * ============================================================================
 *
 * CROSS-TABLE OWNERSHIP INVARIANT:
 *
 *   fiatTransactions.paymentMethodId
 *
 * must refer to a payment method whose userId equals the userId of the
 * parent financial transaction.
 *
 * SQLite CHECK constraints cannot safely reference another table.
 *
 * Therefore this invariant MUST remain enforced by the application/service
 * layer before persistence.
 * ========================================================================== */

export const fiatTransactions = sqliteTable(
  'fiat_transactions',
  {
    id: integer('id').primaryKey({
      autoIncrement: true,
    }),

    financialTransactionId: integer(
      'financial_transaction_id',
    )
      .notNull()
      .references(
        () => financialTransactions.id,
        {
          onDelete: 'restrict',
        },
      ),

    providerId: integer(
      'provider_id',
    )
      .notNull()
      .references(
        () => fiatProviders.id,
        {
          onDelete: 'restrict',
        },
      ),

    paymentMethodId: integer(
      'payment_method_id',
    ).references(
      () => fiatPaymentMethods.id,
      {
        onDelete: 'restrict',
      },
    ),

    assetId: integer('asset_id')
      .notNull()
      .references(
        () => financialAssets.id,
        {
          onDelete: 'restrict',
        },
      ),

    direction: text('direction', {
      enum: [
        'inbound',
        'outbound',
      ],
    }).notNull(),

    amountBaseUnits: text(
      'amount_base_units',
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

    version: integer('version')
      .notNull()
      .default(1),

    requestedAt: integer(
      'requested_at',
      {
        mode: 'timestamp_ms',
      },
    )
      .notNull()
      .$defaultFn(() => new Date()),

    updatedAt: integer(
      'updated_at',
      {
        mode: 'timestamp_ms',
      },
    )
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdateFn(() => new Date()),

    processedAt: integer(
      'processed_at',
      {
        mode: 'timestamp_ms',
      },
    ),

    settledAt: integer(
      'settled_at',
      {
        mode: 'timestamp_ms',
      },
    ),
  },

  (table) => ({
    transactionUq: uniqueIndex(
      'uq_fiat_transactions_financial_transaction',
    ).on(
      table.financialTransactionId,
    ),

    providerIdx: index(
      'idx_fiat_transactions_provider',
    ).on(table.providerId),

    paymentMethodIdx: index(
      'idx_fiat_transactions_payment_method',
    ).on(table.paymentMethodId),

    assetIdx: index(
      'idx_fiat_transactions_asset',
    ).on(table.assetId),

    statusIdx: index(
      'idx_fiat_transactions_status',
    ).on(table.status),

    requestedIdx: index(
      'idx_fiat_transactions_requested',
    ).on(table.requestedAt),

    directionCheck: check(
      'ck_fiat_tx_direction',
      sql`${table.direction} IN (
        'inbound',
        'outbound'
      )`,
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
      )`,
    ),

    amountCheck: check(
      'ck_fiat_transactions_amount_canonical',
      canonicalUnsignedAmountSql(
        table.amountBaseUnits,
      ),
    ),

    processedTemporalCheck: check(
      'ck_fiat_tx_processed_at',
      sql`${table.processedAt} IS NULL
        OR ${table.processedAt} >= ${table.requestedAt}`,
    ),

    settledTemporalCheck: check(
      'ck_fiat_tx_settled_at',
      sql`${table.settledAt} IS NULL
        OR ${table.settledAt} >= ${table.requestedAt}`,
    ),

    settlementOrderCheck: check(
      'ck_fiat_tx_settlement_order',
      sql`${table.settledAt} IS NULL
        OR ${table.processedAt} IS NULL
        OR ${table.settledAt} >= ${table.processedAt}`,
    ),

    settledStateCheck: check(
      'ck_fiat_tx_settled_state',
      sql`(
        ${table.status} IN ('completed', 'reversed')
        AND ${table.settledAt} IS NOT NULL
      )
      OR
      (
        ${table.status} NOT IN ('completed', 'reversed')
        AND ${table.settledAt} IS NULL
      )`,
    ),

    versionCheck: check(
      'ck_fiat_tx_version',
      sql`${table.version} > 0`,
    ),
  }),
);

/* ============================================================================
 * 11. CRYPTO TRANSACTIONS
 * ========================================================================== */

export const cryptoTransactions = sqliteTable(
  'crypto_transactions',
  {
    id: integer('id').primaryKey({
      autoIncrement: true,
    }),

    financialTransactionId: integer(
      'financial_transaction_id',
    )
      .notNull()
      .references(
        () => financialTransactions.id,
        {
          onDelete: 'restrict',
        },
      ),

    assetId: integer('asset_id')
      .notNull()
      .references(
        () => financialAssets.id,
        {
          onDelete: 'restrict',
        },
      ),

    web3TransactionId: text(
      'web3_transaction_id',
    ),

    network: text('network'),

    blockNumber: integer(
      'block_number',
    ),

    confirmations: integer(
      'confirmations',
    )
      .notNull()
      .default(0),

    direction: text('direction', {
      enum: [
        'inbound',
        'outbound',
      ],
    }).notNull(),

    amountBaseUnits: text(
      'amount_base_units',
    ).notNull(),

    fromAddress: text('from_address'),

    toAddress: text('to_address'),

    transactionIndex: integer('transaction_index'),

    nonce: integer('nonce'),

    feeAssetId: integer(
      'fee_asset_id',
    ).references(
      () => financialAssets.id,
      {
        onDelete: 'restrict',
      },
    ),

    feeBaseUnits: text(
      'fee_base_units',
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

    version: integer(
      'version',
    )
      .notNull()
      .default(1),

    requestedAt: integer(
      'requested_at',
      {
        mode: 'timestamp_ms',
      },
    )
      .notNull()
      .$defaultFn(() => new Date()),

    updatedAt: integer(
      'updated_at',
      {
        mode: 'timestamp_ms',
      },
    )
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdateFn(() => new Date()),

    settledAt: integer(
      'settled_at',
      {
        mode: 'timestamp_ms',
      },
    ),
  },

  (table) => ({
    transactionUq: uniqueIndex(
      'uq_crypto_transactions_financial_transaction',
    ).on(
      table.financialTransactionId,
    ),

    /**
     * Blockchain identifiers are unique within a network.
     *
     * SQLite NULL semantics are intentionally retained for not-yet-known
     * external identifiers.
     */
    web3TransactionNetworkUq: uniqueIndex(
      'uq_crypto_transactions_network_web3_transaction',
    ).on(
      table.network,
      table.web3TransactionId,
    ),

    assetIdx: index(
      'idx_crypto_transactions_asset',
    ).on(table.assetId),

    feeAssetIdx: index(
      'idx_crypto_transactions_fee_asset',
    ).on(table.feeAssetId),

    statusIdx: index(
      'idx_crypto_transactions_status',
    ).on(table.status),

    networkIdx: index(
      'idx_crypto_transactions_network',
    ).on(table.network),

    requestedIdx: index(
      'idx_crypto_transactions_requested',
    ).on(table.requestedAt),

    directionCheck: check(
      'ck_crypto_tx_direction',
      sql`${table.direction} IN (
        'inbound',
        'outbound'
      )`,
    ),

    statusCheck: check(
      'ck_crypto_tx_status',
      sql`${table.status} IN (
        'pending',
        'processing',
        'confirmed',
        'failed',
        'reversed'
      )`,
    ),

    amountCheck: check(
      'ck_crypto_transactions_amount_canonical',
      canonicalUnsignedAmountSql(
        table.amountBaseUnits,
      ),
    ),

    feeCheck: check(
      'ck_crypto_transactions_fee_canonical',
      canonicalUnsignedOrZeroAmountSql(
        table.feeBaseUnits,
      ),
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
      )`,
    ),

    /**
     * A known blockchain transaction id must be tied to a known network.
     *
     * This prevents a partially identified external transaction from being
     * treated as fully traceable.
     */
    web3NetworkCoherenceCheck: check(
      'ck_crypto_tx_web3_network_coherence',
      sql`(
        ${table.web3TransactionId} IS NULL
        AND ${table.network} IS NULL
      )
      OR
      (
        ${table.web3TransactionId} IS NOT NULL
        AND ${table.network} IS NOT NULL
      )`,
    ),

    confirmationsCheck: check(
      'ck_crypto_transactions_confirmations',
      sql`${table.confirmations} >= 0`,
    ),

    blockNumberCheck: check(
      'ck_crypto_transactions_block_number',
      sql`${table.blockNumber} IS NULL
        OR ${table.blockNumber} >= 0`,
    ),

    networkCheck: check(
      'ck_crypto_transactions_network',
      sql`${table.network} IS NULL
        OR length(trim(${table.network})) > 0`,
    ),

    web3IdCheck: check(
      'ck_crypto_transactions_web3_id',
      sql`${table.web3TransactionId} IS NULL
        OR length(trim(${table.web3TransactionId})) > 0`,
    ),

    fromAddressCheck: check(
      'ck_crypto_transactions_from_address',
      sql`${table.fromAddress} IS NULL
        OR length(trim(${table.fromAddress})) > 0`,
    ),

    toAddressCheck: check(
      'ck_crypto_transactions_to_address',
      sql`${table.toAddress} IS NULL
        OR length(trim(${table.toAddress})) > 0`,
    ),

    transactionIndexCheck: check(
      'ck_crypto_transactions_transaction_index',
      sql`${table.transactionIndex} IS NULL
        OR ${table.transactionIndex} >= 0`,
    ),

    nonceCheck: check(
      'ck_crypto_transactions_nonce',
      sql`${table.nonce} IS NULL
        OR ${table.nonce} >= 0`,
    ),

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
        AND ${table.fromAddress} IS NOT NULL
        AND ${table.toAddress} IS NOT NULL
        AND ${table.settledAt} IS NOT NULL
      )`,
    ),

    settledStateCheck: check(
      'ck_crypto_tx_settled_state',
      sql`(
        ${table.status} IN ('confirmed', 'reversed')
        AND ${table.settledAt} IS NOT NULL
      )
      OR
      (
        ${table.status} NOT IN ('confirmed', 'reversed')
        AND ${table.settledAt} IS NULL
      )`,
    ),

    temporalOrderCheck: check(
      'ck_crypto_tx_dates',
      sql`${table.settledAt} IS NULL
        OR ${table.settledAt} >= ${table.requestedAt}`,
    ),

    versionCheck: check(
      'ck_crypto_tx_version',
      sql`${table.version} > 0`,
    ),
  }),
);

/* ============================================================================
 * 12. EXCHANGE RATES
 * ========================================================================== */

export const exchangeRates = sqliteTable(
  'exchange_rates',
  {
    id: integer('id').primaryKey({
      autoIncrement: true,
    }),

    baseAssetId: integer(
      'base_asset_id',
    )
      .notNull()
      .references(
        () => financialAssets.id,
        {
          onDelete: 'restrict',
        },
      ),

    quoteAssetId: integer(
      'quote_asset_id',
    )
      .notNull()
      .references(
        () => financialAssets.id,
        {
          onDelete: 'restrict',
        },
      ),

    rateNumerator: text(
      'rate_numerator',
    ).notNull(),

    rateDenominator: text(
      'rate_denominator',
    ).notNull(),

    source: text('source').notNull(),

    quotedAt: integer(
      'quoted_at',
      {
        mode: 'timestamp_ms',
      },
    )
      .notNull()
      .$defaultFn(() => new Date()),

    expiresAt: integer(
      'expires_at',
      {
        mode: 'timestamp_ms',
      },
    ),
  },

  (table) => ({
    pairQuotedIdx: index(
      'idx_exchange_rates_pair_quoted',
    ).on(
      table.baseAssetId,
      table.quoteAssetId,
      table.quotedAt,
    ),

    pairIdx: index(
      'idx_exchange_rates_pair',
    ).on(
      table.baseAssetId,
      table.quoteAssetId,
    ),

    quotedIdx: index(
      'idx_exchange_rates_quoted',
    ).on(table.quotedAt),

    expiryIdx: index(
      'idx_exchange_rates_expires',
    ).on(table.expiresAt),

    pairDifferentCheck: check(
      'ck_exchange_rates_different_assets',
      sql`${table.baseAssetId} <> ${table.quoteAssetId}`,
    ),

    rateNumeratorCheck: check(
      'ck_exchange_rates_numerator_canonical',
      canonicalUnsignedAmountSql(
        table.rateNumerator,
      ),
    ),

    rateDenominatorCheck: check(
      'ck_exchange_rates_denominator_canonical',
      canonicalUnsignedAmountSql(
        table.rateDenominator,
      ),
    ),

    sourceCheck: check(
      'ck_exchange_rates_source_nonempty',
      sql`length(trim(${table.source})) > 0`,
    ),

    expiresCheck: check(
      'ck_exchange_rates_expires_after_quoted',
      sql`${table.expiresAt} IS NULL
        OR ${table.expiresAt} >= ${table.quotedAt}`,
    ),
  }),
);

/* ============================================================================
 * 13. ASSET CONVERSIONS
 * ========================================================================== */

export const assetConversions = sqliteTable(
  'asset_conversions',
  {
    id: integer('id').primaryKey({
      autoIncrement: true,
    }),

    financialTransactionId: integer(
      'financial_transaction_id',
    )
      .notNull()
      .references(
        () => financialTransactions.id,
        {
          onDelete: 'restrict',
        },
      ),

    fromAssetId: integer(
      'from_asset_id',
    )
      .notNull()
      .references(
        () => financialAssets.id,
        {
          onDelete: 'restrict',
        },
      ),

    toAssetId: integer(
      'to_asset_id',
    )
      .notNull()
      .references(
        () => financialAssets.id,
        {
          onDelete: 'restrict',
        },
      ),

    fromAmountBaseUnits: text(
      'from_amount_base_units',
    ).notNull(),

    toAmountBaseUnits: text(
      'to_amount_base_units',
    ).notNull(),

    rateNumerator: text(
      'rate_numerator',
    ).notNull(),

    rateDenominator: text(
      'rate_denominator',
    ).notNull(),

    rateSource: text(
      'rate_source',
    ),

    sourceExchangeRateId: integer(
      'source_exchange_rate_id',
    ).references(
      () => exchangeRates.id,
      {
        onDelete: 'restrict',
      },
    ),

    quotedAt: integer(
      'quoted_at',
      {
        mode: 'timestamp_ms',
      },
    ),

    feeAssetId: integer(
      'fee_asset_id',
    ).references(
      () => financialAssets.id,
      {
        onDelete: 'restrict',
      },
    ),

    feeAmountBaseUnits: text(
      'fee_amount_base_units',
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

    version: integer('version')
      .notNull()
      .default(1),

    createdAt: integer(
      'created_at',
      {
        mode: 'timestamp_ms',
      },
    )
      .notNull()
      .$defaultFn(() => new Date()),

    updatedAt: integer(
      'updated_at',
      {
        mode: 'timestamp_ms',
      },
    )
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdateFn(() => new Date()),

    completedAt: integer(
      'completed_at',
      {
        mode: 'timestamp_ms',
      },
    ),
  },

  (table) => ({
    transactionUq: uniqueIndex(
      'uq_asset_conversions_transaction',
    ).on(
      table.financialTransactionId,
    ),

    fromAssetIdx: index(
      'idx_asset_conversions_from_asset',
    ).on(table.fromAssetId),

    toAssetIdx: index(
      'idx_asset_conversions_to_asset',
    ).on(table.toAssetId),

    statusIdx: index(
      'idx_asset_conversions_status',
    ).on(table.status),

    createdIdx: index(
      'idx_asset_conversions_created',
    ).on(table.createdAt),

    sourceExchangeRateIdx: index(
      'idx_asset_conversions_source_exchange_rate',
    ).on(table.sourceExchangeRateId),

    feeAssetIdx: index(
      'idx_asset_conversions_fee_asset',
    ).on(table.feeAssetId),

    statusCheck: check(
      'ck_asset_conversions_status',
      sql`${table.status} IN (
        'pending',
        'processing',
        'completed',
        'failed',
        'cancelled'
      )`,
    ),

    fromAmountCheck: check(
      'ck_asset_conversions_from_amount_canonical',
      canonicalUnsignedAmountSql(
        table.fromAmountBaseUnits,
      ),
    ),

    toAmountCheck: check(
      'ck_asset_conversions_to_amount_canonical',
      canonicalUnsignedAmountSql(
        table.toAmountBaseUnits,
      ),
    ),

    feeCheck: check(
      'ck_asset_conversions_fee_canonical',
      canonicalUnsignedOrZeroAmountSql(
        table.feeAmountBaseUnits,
      ),
    ),

    feeAssetCoherenceCheck: check(
      'ck_asset_conversions_fee_asset_coherence',
      sql`(
        ${table.feeAmountBaseUnits} = '0'
        AND ${table.feeAssetId} IS NULL
      )
      OR
      (
        ${table.feeAmountBaseUnits} != '0'
        AND ${table.feeAssetId} IS NOT NULL
      )`,
    ),

    assetsDifferentCheck: check(
      'ck_asset_conversions_different_assets',
      sql`${table.fromAssetId} <> ${table.toAssetId}`,
    ),

    rateNumeratorCheck: check(
      'ck_asset_conversions_numerator_canonical',
      canonicalUnsignedAmountSql(
        table.rateNumerator,
      ),
    ),

    rateDenominatorCheck: check(
      'ck_asset_conversions_denominator_canonical',
      canonicalUnsignedAmountSql(
        table.rateDenominator,
      ),
    ),

    rateSourceCheck: check(
      'ck_asset_conversions_rate_source',
      sql`${table.rateSource} IS NULL
        OR length(trim(${table.rateSource})) > 0`,
    ),

    quotedAtCheck: check(
      'ck_asset_conversions_quoted_at',
      sql`(
        ${table.quotedAt} IS NULL
        OR ${table.quotedAt} >= ${table.createdAt}
      )`,
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
      )`,
    ),

    completedTemporalCheck: check(
      'ck_asset_conversions_completed_temporal',
      sql`${table.completedAt} IS NULL
        OR ${table.completedAt} >= ${table.createdAt}`,
    ),

    versionCheck: check(
      'ck_asset_conversions_version',
      sql`${table.version} > 0`,
    ),
  }),
);

/* ============================================================================
 * 14. FINANCIAL FEES
 * ========================================================================== */

export const financialFees = sqliteTable(
  'financial_fees',
  {
    id: integer('id').primaryKey({
      autoIncrement: true,
    }),

    transactionId: integer(
      'transaction_id',
    )
      .notNull()
      .references(
        () => financialTransactions.id,
        {
          onDelete: 'restrict',
        },
      ),

    assetId: integer(
      'asset_id',
    )
      .notNull()
      .references(
        () => financialAssets.id,
        {
          onDelete: 'restrict',
        },
      ),

    recipientAccountId: integer(
      'recipient_account_id',
    )
      .notNull()
      .references(
        () => financialAccounts.id,
        {
          onDelete: 'restrict',
        },
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
      'amount_base_units',
    ).notNull(),

    createdAt: integer(
      'created_at',
      {
        mode: 'timestamp_ms',
      },
    )
      .notNull()
      .$defaultFn(() => new Date()),
  },

  (table) => ({
    transactionIdx: index(
      'idx_financial_fees_transaction',
    ).on(table.transactionId),

    assetIdx: index(
      'idx_financial_fees_asset',
    ).on(table.assetId),

    recipientIdx: index(
      'idx_financial_fees_recipient_account',
    ).on(table.recipientAccountId),

    feeTypeIdx: index(
      'idx_financial_fees_type',
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
      )`,
    ),

    amountCheck: check(
      'ck_financial_fees_amount_canonical',
      canonicalUnsignedAmountSql(
        table.amountBaseUnits,
      ),
    ),
  }),
);

/* ============================================================================
 * 15. FIAT EXTERNAL TRANSACTIONS
 * ========================================================================== */

export const fiatExternalTransactions = sqliteTable(
  'fiat_external_transactions',
  {
    id: integer('id').primaryKey({
      autoIncrement: true,
    }),

    financialTransactionId: integer(
      'financial_transaction_id',
    )
      .notNull()
      .references(
        () => financialTransactions.id,
        {
          onDelete: 'restrict',
        },
      ),

    providerId: integer(
      'provider_id',
    )
      .notNull()
      .references(
        () => fiatProviders.id,
        {
          onDelete: 'restrict',
        },
      ),

    externalTransactionId: text(
      'external_transaction_id',
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

    providerStatus: text(
      'provider_status',
    ),

    createdAt: integer(
      'created_at',
      {
        mode: 'timestamp_ms',
      },
    )
      .notNull()
      .$defaultFn(() => new Date()),

    updatedAt: integer(
      'updated_at',
      {
        mode: 'timestamp_ms',
      },
    )
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdateFn(() => new Date()),

    settledAt: integer(
      'settled_at',
      {
        mode: 'timestamp_ms',
      },
    ),
  },

  (table) => ({
    providerExternalUq: uniqueIndex(
      'uq_fiat_external_transactions_provider_external',
    ).on(
      table.providerId,
      table.externalTransactionId,
    ),

    transactionIdx: index(
      'idx_fiat_external_transactions_transaction',
    ).on(table.financialTransactionId),

    providerIdx: index(
      'idx_fiat_external_transactions_provider',
    ).on(table.providerId),

    statusIdx: index(
      'idx_fiat_external_transactions_status',
    ).on(table.status),

    externalIdCheck: check(
      'ck_fiat_external_transaction_id_nonempty',
      sql`length(trim(${table.externalTransactionId})) > 0`,
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
      )`,
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
      )`,
    ),

    providerStatusCheck: check(
      'ck_fiat_external_provider_status',
      sql`${table.providerStatus} IS NULL
        OR length(trim(${table.providerStatus})) > 0`,
    ),

    settledTemporalCheck: check(
      'ck_fiat_external_transaction_settled_at',
      sql`${table.settledAt} IS NULL
        OR ${table.settledAt} >= ${table.createdAt}`,
    ),

    completedSettlementCheck: check(
      'ck_fiat_external_completed_settlement',
      sql`(
        ${table.status} = 'completed'
        AND ${table.settledAt} IS NOT NULL
      )
      OR
      ${table.status} != 'completed'`,
    ),
  }),
);

/* ============================================================================
 * 16. IDEMPOTENCY KEYS
 * ========================================================================== */

export { idempotencyKeys } from '../infrastructure/tables';

/* ============================================================================
 * 17. RECONCILIATION RECORDS
 * ============================================================================
 *
 * Lifecycle authority:
 *
 *   pending
 *      |
 *      +----> matched
 *      |
 *      +----> mismatch ----> resolved
 *
 * IMPORTANT:
 *
 * The database validates the representational and state-coherence aspects
 * that can be safely expressed using row-local SQLite checks.
 *
 * It intentionally does NOT attempt to calculate:
 *
 *   difference = actual - expected
 *
 * using SQLite INTEGER/REAL arithmetic.
 *
 * The exact calculation MUST happen in the domain/application layer using
 * BigInt/SignedMoney256 semantics.
 * ========================================================================== */

export const reconciliationRecords = sqliteTable(
  'reconciliation_records',
  {
    id: integer('id').primaryKey({
      autoIncrement: true,
    }),

    providerId: integer(
      'provider_id',
    ).references(
      () => fiatProviders.id,
      {
        onDelete: 'restrict',
      },
    ),

    accountId: integer(
      'account_id',
    )
      .notNull()
      .references(
        () => financialAccounts.id,
        {
          onDelete: 'restrict',
        },
      ),

    assetId: integer(
      'asset_id',
    )
      .notNull()
      .references(
        () => financialAssets.id,
        {
          onDelete: 'restrict',
        },
      ),

    expectedBalanceBaseUnits: text(
      'expected_balance_base_units',
    ).notNull(),

    actualBalanceBaseUnits: text(
      'actual_balance_base_units',
    ).notNull(),

    differenceBaseUnits: text(
      'difference_base_units',
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
      'reconciliation_run_id',
    ).notNull(),

    version: integer(
      'version',
    )
      .notNull()
      .default(1),

    reconciliationDate: integer(
      'reconciliation_date',
      {
        mode: 'timestamp_ms',
      },
    )
      .notNull()
      .$defaultFn(() => new Date()),

    createdAt: integer('created_at', {
      mode: 'timestamp_ms',
    })
      .notNull()
      .$defaultFn(() => new Date()),

    updatedAt: integer('updated_at', {
      mode: 'timestamp_ms',
    })
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdateFn(() => new Date()),

    resolvedAt: integer(
      'resolved_at',
      {
        mode: 'timestamp_ms',
      },
    ),

    resolvedByUserId: integer(
      'resolved_by_user_id',
    ).references(
      () => users.id,
      {
        onDelete: 'restrict',
      },
    ),

    resolutionReason: text(
      'resolution_reason',
    ),

    resolutionReference: text(
      'resolution_reference',
    ),
  },

  (table) => ({
    /**
     * SQLite NULL values do not collide in a composite UNIQUE index.
     *
     * Therefore provider-scoped and providerless reconciliation scopes are
     * implemented as separate partial unique indexes.
     */

    runScopeWithProviderUq: uniqueIndex(
      'uq_reconciliation_run_scope_provider',
    )
      .on(
        table.reconciliationRunId,
        table.providerId,
        table.accountId,
        table.assetId,
      )
      .where(
        sql`${table.providerId} IS NOT NULL`,
      ),

    runScopeWithoutProviderUq: uniqueIndex(
      'uq_reconciliation_run_scope_no_provider',
    )
      .on(
        table.reconciliationRunId,
        table.accountId,
        table.assetId,
      )
      .where(
        sql`${table.providerId} IS NULL`,
      ),

    accountIdx: index(
      'idx_reconciliation_records_account',
    ).on(table.accountId),

    assetIdx: index(
      'idx_reconciliation_records_asset',
    ).on(table.assetId),

    providerIdx: index(
      'idx_reconciliation_records_provider',
    ).on(table.providerId),

    runIdx: index(
      'idx_reconciliation_records_run',
    ).on(table.reconciliationRunId),

    statusIdx: index(
      'idx_reconciliation_records_status',
    ).on(table.status),

    reconciliationDateIdx: index(
      'idx_reconciliation_records_date',
    ).on(table.reconciliationDate),

    resolverIdx: index(
      'idx_reconciliation_records_resolver',
    ).on(table.resolvedByUserId),

    runIdCheck: check(
      'ck_reconciliation_run_id_nonempty',
      sql`length(trim(${table.reconciliationRunId})) > 0`,
    ),

    statusCheck: check(
      'ck_reconciliation_status',
      sql`${table.status} IN (
        'pending',
        'matched',
        'mismatch',
        'resolved'
      )`,
    ),

    expectedCheck: check(
      'ck_reconciliation_expected_canonical',
      canonicalUnsignedOrZeroAmountSql(
        table.expectedBalanceBaseUnits,
      ),
    ),

    actualCheck: check(
      'ck_reconciliation_actual_canonical',
      canonicalUnsignedOrZeroAmountSql(
        table.actualBalanceBaseUnits,
      ),
    ),

    differenceCheck: check(
      'ck_reconciliation_difference_canonical',
      canonicalSignedAmountSql(
        table.differenceBaseUnits,
      ),
    ),

    /**
     * State/representation coherence.
     *
     * IMPORTANT:
     *
     * For MATCHED we can safely enforce:
     *
     *   expected == actual
     *   difference == 0
     *
     * because both expected and actual are canonical decimal strings.
     *
     * For MISMATCH/RESOLVED we deliberately only enforce:
     *
     *   expected != actual
     *   difference != 0
     *
     * The exact subtraction:
     *
     *   difference = actual - expected
     *
     * remains a BigInt/domain responsibility because SQLite INTEGER cannot
     * safely calculate uint256 differences.
     *
     * Exact signed difference is a domain invariant. It MUST be calculated
     * using BigInt / a Money256 value object before persistence; SQLite
     * INTEGER/REAL coercion is not a valid implementation for uint256 ranges.
     */
    statusDifferenceCheck: check(
      'ck_reconciliation_status_difference',
      sql`(
        (
          ${table.status} IN ('pending', 'matched')
          AND ${table.expectedBalanceBaseUnits} = ${table.actualBalanceBaseUnits}
          AND ${table.differenceBaseUnits} = '0'
        )
        OR
        (
          ${table.status} IN ('pending', 'mismatch')
          AND ${table.expectedBalanceBaseUnits} != ${table.actualBalanceBaseUnits}
          AND ${table.differenceBaseUnits} != '0'
        )
        OR
        (
          ${table.status} = 'resolved'
          AND ${table.expectedBalanceBaseUnits} != ${table.actualBalanceBaseUnits}
          AND ${table.differenceBaseUnits} != '0'
          AND ${table.resolutionReason} IS NOT NULL
          AND ${table.resolutionReference} IS NOT NULL
        )
      )`,
    ),

    /**
     * All non-resolved states must not carry resolution metadata.
     *
     * This keeps the current row self-consistent.
     *
     * Transition history itself belongs to the domain/application layer.
     */
    resolvedStateCheck: check(
      'ck_reconciliation_resolved_state',
      sql`(
        ${table.status} = 'resolved'
        AND ${table.resolvedAt} IS NOT NULL
        AND ${table.resolvedByUserId} IS NOT NULL
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
      )`,
    ),

    resolutionReasonCheck: check(
      'ck_reconciliation_resolution_reason',
      sql`${table.resolutionReason} IS NULL
        OR length(trim(${table.resolutionReason})) > 0`,
    ),

    resolutionReferenceCheck: check(
      'ck_reconciliation_resolution_reference',
      sql`${table.resolutionReference} IS NULL
        OR length(trim(${table.resolutionReference})) > 0`,
    ),

    resolvedTemporalCheck: check(
      'ck_reconciliation_resolved_temporal',
      sql`${table.resolvedAt} IS NULL
        OR ${table.resolvedAt} >= ${table.reconciliationDate}`,
    ),

    versionCheck: check(
      'ck_reconciliation_records_version',
      sql`${table.version} > 0`,
    ),
  }),
);

/**
 * Canonical hardening contract for the Finance persistence boundary.
 *
 * This is metadata only: it does not change the database schema. It exists to
 * keep the non-SQLite invariants explicit for repository/application authors.
 */
export const FINANCE_HARDENING_CONTRACT = {
  ledger: {
    appendOnly: true,
    doubleEntry: true,
    balanceKey: ['transactionId', 'assetId'],
  },
  ownership: {
    transactionAccountUser: true,
    paymentMethodFiatAccountUser: true,
  },
  semanticCoherence: {
    transactionSpecialization: true,
    fiatAsset: true,
    paymentMethodType: true,
    conversionRatePair: true,
    feeAccountAsset: true,
    reconciliationScope: true,
  },
  concurrency: {
    versionCompareAndSwap: true,
  },
  money: {
    representation: 'canonical-decimal-string',
    unsignedBits: 256,
    exactSignedArithmetic: 'BigInt-or-Money256',
  },
} as const;

/**
 * ============================================================================
 * TYPE EXPORTS & BRANDED TYPES
 * ============================================================================
 */

export type CanonicalMoney256 = string & { readonly __brand: 'CanonicalMoney256' };

export type FinancialAsset = typeof financialAssets.$inferSelect;
export type NewFinancialAsset = typeof financialAssets.$inferInsert;

export type FinancialAccount = typeof financialAccounts.$inferSelect;
export type NewFinancialAccount = typeof financialAccounts.$inferInsert;

export type FinancialTransaction = typeof financialTransactions.$inferSelect;
export type NewFinancialTransaction = typeof financialTransactions.$inferInsert;

export type FinancialLedgerEntry = typeof financialLedgerEntries.$inferSelect;
export type NewFinancialLedgerEntry = typeof financialLedgerEntries.$inferInsert;

export type AccountBalance = typeof accountBalances.$inferSelect;
export type NewAccountBalance = typeof accountBalances.$inferInsert;

export type BalanceHold = typeof balanceHolds.$inferSelect;
export type NewBalanceHold = typeof balanceHolds.$inferInsert;

export type FiatProvider = typeof fiatProviders.$inferSelect;
export type NewFiatProvider = typeof fiatProviders.$inferInsert;

export type FiatAccount = typeof fiatAccounts.$inferSelect;
export type NewFiatAccount = typeof fiatAccounts.$inferInsert;

export type FiatPaymentMethod = typeof fiatPaymentMethods.$inferSelect;
export type NewFiatPaymentMethod = typeof fiatPaymentMethods.$inferInsert;

export type FiatTransaction = typeof fiatTransactions.$inferSelect;
export type NewFiatTransaction = typeof fiatTransactions.$inferInsert;

export type CryptoTransaction = typeof cryptoTransactions.$inferSelect;
export type NewCryptoTransaction = typeof cryptoTransactions.$inferInsert;

export type ExchangeRate = typeof exchangeRates.$inferSelect;
export type NewExchangeRate = typeof exchangeRates.$inferInsert;

export type AssetConversion = typeof assetConversions.$inferSelect;
export type NewAssetConversion = typeof assetConversions.$inferInsert;

export type FinancialFee = typeof financialFees.$inferSelect;
export type NewFinancialFee = typeof financialFees.$inferInsert;

export type FiatExternalTransaction = typeof fiatExternalTransactions.$inferSelect;
export type NewFiatExternalTransaction = typeof fiatExternalTransactions.$inferInsert;

export type ReconciliationRecord = typeof reconciliationRecords.$inferSelect;
export type NewReconciliationRecord = typeof reconciliationRecords.$inferInsert;

