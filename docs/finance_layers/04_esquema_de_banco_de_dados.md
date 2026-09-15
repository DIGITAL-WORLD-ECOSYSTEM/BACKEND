# 4. ESQUEMA DE BANCO DE DADOS (D1 / SQLite Tables)

Documento integrante do dossiê canônico do Finance Core (`BackEnd/`).

## Sumário dos Arquivos da Camada

- [tables.ts](#srcdbfinancetablests) — `src/db/finance/tables.ts` (2802 linhas)
- [relations.ts](#srcdbfinancerelationsts) — `src/db/finance/relations.ts` (587 linhas)

---

<a id="srcdbfinancetablests"></a>
## Arquivo: `src/db/finance/tables.ts`

- **Caminho absoluto**: `/home/sandro/Área de trabalho/BackEnd/src/db/finance/tables.ts`
- **Total de linhas**: 2802
- **Linguagem**: TypeScript

```typescript
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
 * UINT256 LIMIT:
 *   Maximum unsigned 256-bit value:
 *
 *   2^256 - 1 =
 *   115792089237316195423570985008687907853269984665640564039457584007913129639935
 *
 * IMPORTANT:
 *   Monetary values MUST NOT be constrained to JavaScript's
 *   Number.MAX_SAFE_INTEGER (2^53 - 1).
 *
 *   The database stores canonical decimal strings so that values above 2^53
 *   remain exact across the SQLite/D1 persistence boundary.
 *
 * ============================================================================
 * AUDIT CHANGELOG
 * ============================================================================
 * 1. Replaced the previous Number.MAX_SAFE_INTEGER / 2^53-1 monetary cap
 *    with the full unsigned uint256 domain.
 * 2. Canonical monetary CHECK helpers now permit values from 0 through
 *    MAX_UINT256 without converting them to SQLite INTEGER.
 * 3. Self-referencing transaction FKs no longer use `any`; they use
 *    `AnySQLiteColumn`, preserving Drizzle's circular-type workaround while
 *    removing the unsafe top-level type escape.
 * 4. Removed the previous illustrative ledger trigger that used
 *    CAST(amount_base_units AS INTEGER). Such a trigger would be UNSAFE for
 *    uint256 values because SQLite INTEGER is 64-bit signed. Double-entry
 *    balancing therefore remains an application/domain transactional
 *    invariant until a decimal-safe SQL/UDF mechanism is deliberately added.
 * 5. Corrected financial transaction completion-state semantics so that
 *    reversed/refunded historical transactions may retain completedAt.
 * 6. Tightened reconciliation resolved-state semantics:
 *      - resolved requires a non-zero retained difference
 *      - resolved requires resolvedAt
 *      - resolved requires resolvedByUserId
 *      - resolved requires both resolution reason/reference
 * 7. Replaced provider-sensitive single reconciliation uniqueness with two
 *    partial unique indexes so SQLite NULL semantics cannot create duplicate
 *    providerless reconciliation scopes.
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

/* ============================================================================
 * SHARED CANONICAL-AMOUNT SQL HELPERS
 * ============================================================================
 *
 * All base-unit monetary columns in this domain are persisted as canonical
 * decimal strings.
 *
 * Canonical unsigned:
 *   0
 *   1
 *   2
 *   ...
 *   MAX_UINT256
 *
 * Canonical signed:
 *   0
 *   positive canonical integer
 *   negative canonical integer whose absolute value <= MAX_UINT256
 *
 * We intentionally do NOT use:
 *
 *   CAST(... AS INTEGER)
 *   Number(...)
 *   REAL
 *   FLOAT
 *   DOUBLE
 *
 * for monetary values.
 *
 * SQLite INTEGER is a signed 64-bit integer and therefore cannot represent
 * uint256 amounts exactly.
 * ============================================================================
 */

/** Upper-bound check for uint256 canonical decimal representation. */
function uint256UpperBoundSql(column: unknown): SQL {
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

/** Strictly positive canonical uint256 decimal string. */
function canonicalUnsignedAmountSql(column: unknown): SQL {
  return sql`
    ${column} GLOB '[1-9]*'
    AND ${column} NOT GLOB '*[^0-9]*'
    AND ${uint256UpperBoundSql(column)}
  `;
}

/** Non-negative canonical uint256 decimal string. */
function canonicalUnsignedOrZeroAmountSql(column: unknown): SQL {
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
 * Signed canonical integer:
 *
 *   0
 *   +N represented without '+'
 *   -N represented with '-'
 *
 * Zero must be exactly "0".
 */
function canonicalSignedAmountSql(column: unknown): SQL {
  return sql`
    (
      ${column} = '0'
      OR
      (
        ${column} GLOB '[1-9]*'
        AND ${column} NOT GLOB '*[^0-9]*'
      )
      OR
      (
        substr(${column}, 1, 1) = '-'
        AND substr(${column}, 2) GLOB '[1-9]*'
        AND substr(${column}, 2) NOT GLOB '*[^0-9]*'
      )
    )
    AND
    (
      ${column} = '0'
      OR
      (
        substr(${column}, 1, 1) != '-'
        AND ${uint256UpperBoundSql(column)}
      )
      OR
      (
        substr(${column}, 1, 1) = '-'
        AND (
          length(${column}) < ${MAX_UINT256_DECIMAL_DIGITS + 1}
          OR (
            length(${column}) = ${MAX_UINT256_DECIMAL_DIGITS + 1}
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
      sql`length(trim(${table.code})) > 0`,
    ),

    symbolCheck: check(
      'ck_financial_assets_symbol_nonempty',
      sql`length(trim(${table.symbol})) > 0`,
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
        ${table.type} = 'fiat' AND ${table.decimals} BETWEEN 0 AND 6
      )
      OR
      (
        ${table.type} = 'crypto' AND ${table.decimals} BETWEEN 0 AND 18
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
      sql`${table.status} IN ('active', 'inactive', 'suspended')`,
    ),

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
      )`,
    ),

    userAccountTypeUq: uniqueIndex(
      'uq_financial_accounts_user_type_name',
    ).on(
      table.userId,
      table.accountType,
      table.name,
    ),

    systemAccountTypeNameUq: uniqueIndex(
      'uq_financial_accounts_system_type_name',
    )
      .on(table.accountType, table.name)
      .where(sql`${table.userId} IS NULL`),

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
  }),
);

/* ============================================================================
 * 3. FINANCIAL TRANSACTIONS
 * ========================================================================== */

export const financialTransactions = sqliteTable(
  'financial_transactions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),

    userId: integer('user_id').references(() => users.id, {
      onDelete: 'restrict',
    }),

    /**
     * Self-referencing FK.
     *
     * Drizzle requires a lazy reference because the table is self-referential.
     * `AnySQLiteColumn` is used instead of `any`, preserving the known
     * circular-inference workaround without introducing an unsafe untyped
     * escape.
     */
    reversalOfTransactionId: integer(
      'reversal_of_transaction_id',
    ).references(
      (): AnySQLiteColumn => financialTransactions.id,
      {
        onDelete: 'restrict',
      },
    ),

    refundOfTransactionId: integer(
      'refund_of_transaction_id',
    ).references(
      (): AnySQLiteColumn => financialTransactions.id,
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
      table.userId,
    ),

    typeIdx: index('idx_financial_transactions_type').on(
      table.type,
    ),

    statusIdx: index('idx_financial_transactions_status').on(
      table.status,
    ),

    createdIdx: index('idx_financial_transactions_created').on(
      table.createdAt,
    ),

    correlationIdx: index(
      'idx_financial_transactions_correlation',
    ).on(table.correlationId),

    singleReversalUnq: uniqueIndex(
      'uq_financial_tx_single_reversal',
    )
      .on(table.reversalOfTransactionId)
      .where(
        sql`${table.reversalOfTransactionId} IS NOT NULL`,
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
        (${table.type} = 'reversal'
          AND ${table.reversalOfTransactionId} IS NOT NULL)
        OR
        (${table.type} = 'refund'
          AND ${table.refundOfTransactionId} IS NOT NULL)
        OR
        (${table.type} NOT IN ('reversal', 'refund'))
      )`,
    ),

    /**
     * A completed transaction must have completedAt.
     *
     * Historical transactions that later become `reversed` or `refunded`
     * are allowed to retain the original completion timestamp.
     */
    completedStateCheck: check(
      'ck_financial_tx_completed_state',
      sql`(
        ${table.status} IN ('completed', 'reversed', 'refunded')
        AND ${table.completedAt} IS NOT NULL
      )
      OR
      (
        ${table.status} NOT IN ('completed', 'reversed', 'refunded')
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
  }),
);

/* ============================================================================
 * 4. FINANCIAL LEDGER ENTRIES
 * ============================================================================
 *
 * IMPORTANT:
 *
 * SQLite CHECK constraints are row-local. They cannot aggregate the complete
 * transaction in order to enforce:
 *
 *   SUM(debit) == SUM(credit)
 *
 * across multiple rows.
 *
 * Therefore FIN-001 remains a transactional application/domain invariant.
 *
 * DO NOT implement a trigger using:
 *
 *   CAST(amount_base_units AS INTEGER)
 *
 * because SQLite INTEGER is signed 64-bit and would corrupt/clip uint256
 * values above the SQLite integer range.
 *
 * A database trigger may only be introduced after a decimal-safe aggregation
 * mechanism is deliberately selected (for example a custom SQL function/UDF
 * or another storage strategy with uint256-safe arithmetic).
 * ========================================================================== */

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
      sql`${table.direction} IN ('debit', 'credit')`,
    ),

    amountCheck: check(
      'ck_financial_ledger_entries_amount_canonical',
      canonicalUnsignedAmountSql(table.amountBaseUnits),
    ),
  }),
);

/* ============================================================================
 * 5. ACCOUNT BALANCES
 * ========================================================================== */

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
      'released_by_transaction_id',
    ).references(
      () => financialTransactions.id,
      {
        onDelete: 'restrict',
      },
    ),

    consumedAt: integer('consumed_at', {
      mode: 'timestamp',
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
        (${table.releasedAt} IS NULL
          OR ${table.releasedAt} >= ${table.createdAt})
        AND
        (${table.consumedAt} IS NULL
          OR ${table.consumedAt} >= ${table.createdAt})
      )`,
    ),

    versionCheck: check(
      'ck_balance_holds_version',
      sql`${table.version} > 0`,
    ),
  }),
);

/* ============================================================================
 * 7. FIAT PROVIDERS
 * ========================================================================== */

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

    codeCheckNonempty: check(
      'ck_fiat_providers_code_nonempty',
      sql`length(trim(${table.code})) > 0`,
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
      },
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
    userAccountCompositeUq: uniqueIndex(
      'uq_fiat_accounts_user_id_id',
    ).on(
      table.userId,
      table.id,
    ),

    userIdx: index(
      'idx_fiat_accounts_user',
    ).on(table.userId),

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
 * ========================================================================== */

export const fiatTransactions = sqliteTable(
  'fiat_transactions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),

    financialTransactionId: integer(
      'financial_transaction_id',
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
      'payment_method_id',
    ).references(
      () => fiatPaymentMethods.id,
      {
        onDelete: 'restrict',
      },
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
      'uq_fiat_transactions_financial_transaction',
    ).on(table.financialTransactionId),

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

    completedLifecycleCheck: check(
      'ck_fiat_tx_completed_lifecycle',
      sql`(
        ${table.status} = 'completed'
        AND ${table.settledAt} IS NOT NULL
      )
      OR
      ${table.status} != 'completed'`,
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
    id: integer('id').primaryKey({ autoIncrement: true }),

    financialTransactionId: integer(
      'financial_transaction_id',
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

    web3TransactionId: text(
      'web3_transaction_id',
    ),

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
      'amount_base_units',
    ).notNull(),

    feeAssetId: integer('fee_asset_id').references(
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
      'uq_crypto_transactions_financial_transaction',
    ).on(table.financialTransactionId),

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
 * ============================================================================
 *
 * rateNumerator/rateDenominator remain TEXT because exact rational values
 * must survive the database/application boundary without IEEE-754 conversion.
 *
 * Domain arithmetic remains the responsibility of the application/domain
 * layer using BigInt/Money256.
 * ========================================================================== */

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
      'rate_numerator',
    ).notNull(),

    rateDenominator: text(
      'rate_denominator',
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
    id: integer('id').primaryKey({ autoIncrement: true }),

    financialTransactionId: integer(
      'financial_transaction_id',
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

    rateSource: text('rate_source'),

    sourceExchangeRateId: integer(
      'source_exchange_rate_id',
    ).references(
      () => exchangeRates.id,
      {
        onDelete: 'restrict',
      },
    ),

    quotedAt: integer('quoted_at', {
      mode: 'timestamp',
    }),

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
      'uq_asset_conversions_transaction',
    ).on(table.financialTransactionId),

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
  }),
);

/* ============================================================================
 * 14. FINANCIAL FEES
 * ========================================================================== */

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
      'recipient_account_id',
    ).references(
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

    createdAt: integer('created_at', {
      mode: 'timestamp',
    })
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
 * 15. EXTERNAL FIAT TRANSACTIONS
 * ========================================================================== */

export const fiatExternalTransactions = sqliteTable(
  'fiat_external_transactions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),

    financialTransactionId: integer(
      'financial_transaction_id',
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
 * Lifecycle:
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
 * A resolved record retains the original non-zero difference for auditability.
 * ========================================================================== */

export const reconciliationRecords = sqliteTable(
  'reconciliation_records',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),

    providerId: integer('provider_id').references(
      () => fiatProviders.id,
      {
        onDelete: 'restrict',
      },
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

    version: integer('version')
      .notNull()
      .default(1),

    reconciliationDate: integer(
      'reconciliation_date',
      { mode: 'timestamp' },
    )
      .notNull()
      .$defaultFn(() => new Date()),

    resolvedAt: integer('resolved_at', {
      mode: 'timestamp',
    }),

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
     * SQLite treats NULLs as distinct in UNIQUE indexes.
     *
     * Therefore a single composite unique index containing nullable
     * providerId would NOT provide true uniqueness for providerless rows.
     *
     * We split the invariant into:
     *
     *   1. provider IS NOT NULL
     *   2. provider IS NULL
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
      .where(sql`${table.providerId} IS NOT NULL`),

    runScopeWithoutProviderUq: uniqueIndex(
      'uq_reconciliation_run_scope_no_provider',
    )
      .on(
        table.reconciliationRunId,
        table.accountId,
        table.assetId,
      )
      .where(sql`${table.providerId} IS NULL`),

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
     * State must agree with the materialized difference.
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
     *   a non-zero mismatch was explicitly resolved. The original
     *   difference remains preserved.
     */
    statusDifferenceCheck: check(
      'ck_reconciliation_status_difference',
      sql`(
        ${table.status} = 'pending'
      )
      OR
      (
        ${table.status} = 'matched'
        AND ${table.expectedBalanceBaseUnits} = ${table.actualBalanceBaseUnits}
        AND ${table.differenceBaseUnits} = '0'
      )
      OR
      (
        ${table.status} = 'mismatch'
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
      )`,
    ),

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

```

---

<a id="srcdbfinancerelationsts"></a>
## Arquivo: `src/db/finance/relations.ts`

- **Caminho absoluto**: `/home/sandro/Área de trabalho/BackEnd/src/db/finance/relations.ts`
- **Total de linhas**: 587
- **Linguagem**: TypeScript

```typescript
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
 * ============================================================================
 * AUDIT CHANGELOG
 * ============================================================================
 * Existing audited corrections intentionally preserved:
 *
 * 1. cryptoTransactions has TWO foreign keys into financialAssets
 *    (assetId and feeAssetId). Both relations remain explicitly
 *    disambiguated.
 *
 * 2. balanceHolds has TWO foreign keys into financialTransactions
 *    (releasedByTransactionId and consumedByTransactionId). Both remain
 *    explicitly disambiguated.
 *
 * 3. reconciliationRecords.resolvedByUserId remains modeled as
 *    `resolvedByUser`.
 *
 * 4. financialTransactionsRelations retains both reverse balance-hold
 *    collections.
 *
 * No functional relation change is introduced here because these areas were
 * already consolidated and correct in the previous audit.
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
    user: one(users, {
      fields: [financialTransactions.userId],
      references: [users.id],
    }),

    ledgerEntries: many(financialLedgerEntries),

    idempotencyKeys: many(idempotencyKeys),

    reversalOfTransaction: one(financialTransactions, {
      fields: [financialTransactions.reversalOfTransactionId],
      references: [financialTransactions.id],
      relationName: 'transactionReversal',
    }),

    reversals: many(financialTransactions, {
      relationName: 'transactionReversal',
    }),

    refundOfTransaction: one(financialTransactions, {
      fields: [financialTransactions.refundOfTransactionId],
      references: [financialTransactions.id],
      relationName: 'transactionRefund',
    }),

    refunds: many(financialTransactions, {
      relationName: 'transactionRefund',
    }),

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

    financialFees: many(financialFees),

    fiatExternalTransactions: many(fiatExternalTransactions),

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
      relationName: 'cryptoTransactionAsset',
    }),

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

```

---

