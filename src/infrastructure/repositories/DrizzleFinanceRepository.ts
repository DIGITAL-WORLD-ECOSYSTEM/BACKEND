import { eq, and, or, lt, inArray, sql } from 'drizzle-orm';
import {
  financialAccounts,
  accountBalances,
  financialTransactions,
  financialLedgerEntries,
  financialAssets,
  MAX_BINDING_SAFE_BASE_UNITS,
} from '../../db/finance/tables';
import { idempotencyKeys } from '../../db/infrastructure/tables';
import { Result } from '../../shared/kernel/Result';
import { RepositoryError } from '../../shared/kernel/RepositoryError';
import {
  IFinanceRepository,
  FinancialAccountRecord,
  AccountBalanceRecord,
  FinancialTransactionRecord,
  SystemAccountType,
  FinancialTransactionType,
  FinancialTransactionCategory,
  FinancialTransactionStatus,
  FinancialAssetStatus,
  BalanceUpdateResult,
  IdempotencyRecord,
} from '../../application/ports/output/IFinanceRepository';
import { FinancialLedgerEntryRecord } from '../../domains/finance/contracts/FinancialLedgerEntryRecord';
import { LedgerEntry } from '../../domains/finance/entities/LedgerTransaction';
import {
  InvalidMoneyFormatError,
  Money256OverflowError,
  InvalidAccountClassError,
  AccountInactiveError,
  AssetInactiveError,
} from '../../domains/finance/errors/FinancialError';

/**
 * ============================================================================
 * AUDIT CHANGELOG — ROUND 2 (applied on top of the previous revision)
 * ============================================================================
 * P0-01 [CRITICAL] Removed the locally hardcoded EXPECTED_CLASSES map, which
 *       had drifted from tables.ts's ck_financial_accounts_type_class_matrix
 *       (it required `escrow -> asset`, while the schema requires
 *       `escrow -> liability`; it also only accepted ONE class for
 *       `reserve`/`clearing`/`opening_balance_equity`, which the schema
 *       allows TWO valid classes for). Replaced with
 *       VALID_ACCOUNT_CLASSES_BY_TYPE, a map of *allowed* classes per type
 *       that mirrors the schema matrix exactly. This is still a local
 *       duplication of policy — ideally it should be imported from a single
 *       shared AccountClassPolicy module used by both the schema's CHECK
 *       constraint generation and this repository, so the two can never
 *       diverge again. Tracked as a follow-up (see TODO below).
 * P0-02 [CRITICAL] claimIdempotency() no longer reclaims a stale row purely
 *       based on its status/expiry. It now also requires the existing row's
 *       requestHash to match the incoming requestHash before reclaiming.
 *       A same key + same scope + DIFFERENT requestHash now throws
 *       IdempotencyKeyReusedWithDifferentRequestError instead of silently
 *       overwriting the previous request's hash — closing the gap where a
 *       semantically different request could hijack another request's
 *       idempotency key.
 * P0-03 [CRITICAL] Removed `createdAt: new Date()` from the INSERT in
 *       ensureAccountBalance(). accountBalances in tables.ts does not
 *       declare a createdAt column (only `updatedAt`); inserting an unknown
 *       field was a schema/repository mismatch.
 * P1 (contained to this file) getOrCreateUserAccount() and
 *       getOrCreateOperatingAccount() now reject (throw AccountInactiveError)
 *       when the singleton account found/created is not `active`, instead
 *       of silently handing back an unusable inactive/suspended account.
 * P1 (contained to this file) getTransactionEntries() no longer silently
 *       coerces an unexpected `direction` value to 'credit'. An unexpected
 *       value now throws, surfacing corruption instead of masking it.
 *
 * NOT addressed in this pass (require visibility into other files or a
 * cross-cutting design decision — see audit report P0-04, P0-05 and the
 * broader P1 list):
 *   - P0-04: proving idempotency+transaction+ledger+balance+outbox share a
 *     single atomic Unit of Work (needs DrizzleUnitOfWork.ts).
 *   - P0-05: preserving completedAt history across reversal/refund
 *     transitions (needs a decision + migration: reversedAt/refundedAt
 *     columns, FinancialTransactionRecord shape, and the state machine).
 *   - P1-03/04/06/11/12/13/14: sourceType/sourceId/correlationId on
 *     insertTransaction, full metadata on FinancialTransactionRecord,
 *     cursor pagination on listTransactions, real aggregateVersion/
 *     aggregateId on the outbox, BigInt-safe payload serialization, typed
 *     event/aggregate vocabularies — all require changing
 *     IFinanceRepository / FinancialTransactionRecord / LedgerEntry /
 *     outbox call sites that are outside this file.
 * ============================================================================
 */

/**
 * TODO(shared-policy): extract this to a single AccountClassPolicy module
 * consumed by BOTH tables.ts (to generate ck_financial_accounts_type_class_matrix)
 * and this repository, so the two can never diverge again the way
 * EXPECTED_CLASSES previously did. Until that module exists, this map is
 * hand-kept in sync with tables.ts's matrix — verify both together whenever
 * either changes.
 */
const VALID_ACCOUNT_CLASSES_BY_TYPE: Record<string, readonly string[]> = {
  user_available: ['liability'],
  treasury: ['asset'],
  operating: ['asset'],
  reserve: ['asset', 'liability'],
  fees: ['revenue'],
  escrow: ['liability'],
  reward_expense: ['expense'],
  yield_expense: ['expense'],
  clearing: ['asset', 'liability'],
  opening_balance_equity: ['equity', 'liability'],
  payment_revenue: ['revenue'],
  refund_expense: ['expense'],
};

/**
 * [AUDIT FIX P0-02]
 * Raised when a claimIdempotency() call targets an existing (reclaimable)
 * idempotency row whose requestHash does not match the incoming request.
 * This means the same (key, scope) pair is being reused for what is, in
 * substance, a different request — which must never silently overwrite the
 * original request's identity.
 *
 * TODO: move this to '../../domains/finance/errors/FinancialError' once
 * that module owns it, for consistency with the other Finance error types
 * imported above.
 */
export class IdempotencyKeyReusedWithDifferentRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IdempotencyKeyReusedWithDifferentRequestError';
  }
}

/**
 * [AUDIT FIX #10 - ROUND 1, unchanged]
 * Placeholder alias for the Drizzle db/transaction executor type. Swap this
 * for the project's real type (e.g. `BatchItem<'sqlite'>` /
 * `SQLiteTransaction<...>` re-exported from the db client module) as soon
 * as it's available here, to recover compile-time column/type checking.
 */
type FinanceDbExecutor = any;

const MAX_BINDING_SAFE_BASE_UNITS_BIGINT = BigInt(MAX_BINDING_SAFE_BASE_UNITS);

export function validateCanonicalBaseUnits(val: string): bigint {
  if (!val || !/^(0|[1-9][0-9]*)$/.test(val)) {
    throw new InvalidMoneyFormatError(
      `Formato de baseUnits inválido em storage persistence ('${val}'). Deve ser string decimal canônica sem zeros à esquerda.`
    );
  }
  const parsed = BigInt(val);
  if (parsed > MAX_BINDING_SAFE_BASE_UNITS_BIGINT) {
    throw new Money256OverflowError(
      `Valor numérico ('${val}') excede o limite binding-safe do D1 (${MAX_BINDING_SAFE_BASE_UNITS}).`
    );
  }
  return parsed;
}

export function isUniqueConstraintViolation(err: any): boolean {
  if (!err) return false;

  const msg = `${err.message || ''} ${err.cause?.message || ''} ${err.stack || ''}`.toLowerCase();
  if (msg.includes('foreign key') || msg.includes('check constraint')) return false;

  const code = String(err.code || err.extendedCode || err.rawCode || err.cause?.code || '');
  if (
    code === 'SQLITE_CONSTRAINT_UNIQUE' ||
    code === 'SQLITE_CONSTRAINT_PRIMARYKEY' ||
    code === '1555' ||
    code === '2067'
  ) {
    return true;
  }

  return (
    msg.includes('unique constraint failed') ||
    msg.includes('d1_error: unique constraint') ||
    msg.includes('unique constraint')
  );
}

export class DrizzleFinanceRepository implements IFinanceRepository {
  constructor(private readonly db: FinanceDbExecutor) { }

  private get executor() {
    return this.db;
  }

  async getAccountById(accountId: number): Promise<Result<FinancialAccountRecord>> {
    try {
      const [row] = await this.executor
        .select()
        .from(financialAccounts)
        .where(eq(financialAccounts.id, accountId))
        .limit(1);

      if (!row) {
        return Result.fail(`Conta financeira #${accountId} não encontrada.`);
      }

      return Result.ok({
        id: row.id,
        userId: row.userId,
        accountType: row.accountType as any,
        accountClass: row.accountClass as any,
        status: row.status as any,
        name: row.name,
        version: row.version,
      });
    } catch (err: any) {
      return Result.fail(err.message);
    }
  }

  async getTreasuryAccount(): Promise<Result<FinancialAccountRecord>> {
    try {
      const [row] = await this.executor
        .select()
        .from(financialAccounts)
        .where(
          and(
            eq(financialAccounts.accountType, 'treasury'),
            eq(financialAccounts.status, 'active')
          )
        )
        .limit(1);

      if (!row) {
        return Result.fail('Treasury account not found. Must be provisioned via bootstrap seed.');
      }

      return Result.ok({
        id: row.id,
        userId: row.userId,
        accountType: row.accountType as any,
        accountClass: row.accountClass as any,
        status: row.status as any,
        name: row.name,
        version: row.version,
      });
    } catch (err: any) {
      return Result.fail(err.message);
    }
  }

  async getTreasuryBalance(): Promise<Result<AccountBalanceRecord[]>> {
    try {
      const treasuryRes = await this.getTreasuryAccount();
      if (treasuryRes.isFailure) {
        return Result.fail(treasuryRes.error || 'Treasury account error');
      }

      const treasuryId = treasuryRes.getValue().id;
      const rows = await this.executor
        .select()
        .from(accountBalances)
        .where(eq(accountBalances.accountId, treasuryId));

      const balances: AccountBalanceRecord[] = rows.map((r: any) => {
        validateCanonicalBaseUnits(r.availableBaseUnits.toString());
        validateCanonicalBaseUnits(r.lockedBaseUnits.toString());
        return {
          id: r.id,
          accountId: r.accountId,
          assetId: r.assetId,
          availableBaseUnits: r.availableBaseUnits.toString(),
          lockedBaseUnits: r.lockedBaseUnits.toString(),
          version: r.version,
        };
      });

      return Result.ok(balances);
    } catch (err: any) {
      return Result.fail(err.message);
    }
  }

  async getAssetById(assetId: number): Promise<Result<{ id: number; code: string; status: FinancialAssetStatus }>> {
    try {
      const [row] = await this.executor
        .select()
        .from(financialAssets)
        .where(eq(financialAssets.id, assetId))
        .limit(1);

      if (!row) {
        return Result.fail(`Financial asset #${assetId} not found.`);
      }

      return Result.ok({
        id: row.id,
        code: row.code,
        status: row.status as FinancialAssetStatus,
      });
    } catch (err: any) {
      return Result.fail(err.message);
    }
  }

  /**
   * Shared select -> insert -> catch-race -> re-select pattern for
   * "singleton-ish" system/user accounts, used by getOrCreateUserAccount
   * and getOrCreateOperatingAccount below. Centralizing this avoids the
   * two methods silently drifting from each other over time.
   *
   * [AUDIT FIX P1] Now throws AccountInactiveError if the found/created
   * account is not `active` — previously an inactive/suspended account
   * could be silently handed back to the caller as if it were usable.
   */
  private async getOrCreateSingletonAccount(
    whereClause: any,
    insertValues: {
      userId: number | null;
      accountType: string;
      accountClass: string;
      name: string;
    }
  ): Promise<Result<FinancialAccountRecord>> {
    try {
      const toRecord = (row: any): FinancialAccountRecord => {
        if (row.status !== 'active') {
          throw new AccountInactiveError(
            `Conta '${insertValues.accountType}' (#${row.id}) existe mas está com status '${row.status}', não 'active'.`
          );
        }
        return {
          id: row.id,
          userId: row.userId,
          accountType: row.accountType as any,
          accountClass: row.accountClass as any,
          status: row.status as any,
          name: row.name,
          version: row.version,
        };
      };

      const [row] = await this.executor
        .select()
        .from(financialAccounts)
        .where(whereClause)
        .limit(1);

      if (row) {
        return Result.ok(toRecord(row));
      }

      try {
        const [inserted] = await this.executor
          .insert(financialAccounts)
          .values({
            userId: insertValues.userId,
            accountType: insertValues.accountType,
            accountClass: insertValues.accountClass,
            name: insertValues.name,
            status: 'active',
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .returning();

        return Result.ok(toRecord(inserted));
      } catch (insertErr: any) {
        if (!isUniqueConstraintViolation(insertErr)) {
          throw insertErr;
        }

        const [existing] = await this.executor
          .select()
          .from(financialAccounts)
          .where(whereClause)
          .limit(1);

        if (existing) {
          return Result.ok(toRecord(existing));
        }
        throw new Error(
          `Falha de concorrência: conta '${insertValues.accountType}' não encontrada mesmo após violação de UNIQUE.`
        );
      }
    } catch (err: any) {
      return Result.fail(err.message);
    }
  }

  async getOrCreateUserAccount(userId: number): Promise<Result<FinancialAccountRecord>> {
    return this.getOrCreateSingletonAccount(
      and(
        eq(financialAccounts.userId, userId),
        eq(financialAccounts.accountType, 'user_available')
      ),
      {
        userId,
        accountType: 'user_available',
        accountClass: 'liability',
        name: `User ${userId} Main Account`,
      }
    );
  }

  async getOrCreateOperatingAccount(): Promise<Result<FinancialAccountRecord>> {
    return this.getOrCreateSingletonAccount(
      and(
        sql`${financialAccounts.userId} IS NULL`,
        eq(financialAccounts.accountType, 'operating')
      ),
      {
        userId: null,
        accountType: 'operating',
        accountClass: 'asset',
        name: 'System Operating Account',
      }
    );
  }

  /**
   * [AUDIT FIX P0-01]
   * Uses VALID_ACCOUNT_CLASSES_BY_TYPE (an *allowed set* per type, mirroring
   * tables.ts's ck_financial_accounts_type_class_matrix exactly) instead of
   * the previous EXPECTED_CLASSES map, which required a single hardcoded
   * class per type and had drifted from the schema (most notably:
   * `escrow -> asset` here vs. `escrow -> liability` in the schema).
   */
  async getSystemAccount(accountType: SystemAccountType): Promise<Result<FinancialAccountRecord>> {
    try {
      const [row] = await this.executor
        .select()
        .from(financialAccounts)
        .where(
          and(
            sql`${financialAccounts.userId} IS NULL`,
            eq(financialAccounts.accountType, accountType),
            eq(financialAccounts.status, 'active')
          )
        )
        .limit(1);

      if (!row) {
        return Result.fail(`System account of type "${accountType}" not found. Must be provisioned via bootstrap seed.`);
      }

      const validClasses = VALID_ACCOUNT_CLASSES_BY_TYPE[accountType];
      if (validClasses && !validClasses.includes(row.accountClass)) {
        return Result.fail(
          `Conta sistêmica "${accountType}" possui classe contábil incompatível ` +
          `(${row.accountClass} não está em [${validClasses.join(', ')}]).`
        );
      }

      return Result.ok({
        id: row.id,
        userId: row.userId,
        accountType: row.accountType as any,
        accountClass: row.accountClass as any,
        status: row.status as any,
        name: row.name,
        version: row.version,
      });
    } catch (err: any) {
      return Result.fail(err.message);
    }
  }

  async getTransactionById(transactionId: number): Promise<Result<FinancialTransactionRecord>> {
    try {
      const [row] = await this.executor
        .select()
        .from(financialTransactions)
        .where(eq(financialTransactions.id, transactionId))
        .limit(1);

      if (!row) {
        return Result.fail(`Transaction #${transactionId} not found.`);
      }

      return Result.ok({
        id: row.id,
        userId: row.userId,
        type: row.type as FinancialTransactionType,
        category: row.category as FinancialTransactionCategory,
        status: row.status as FinancialTransactionStatus,
        description: row.description,
        version: row.version,
        createdAt: new Date(row.createdAt),
        completedAt: row.completedAt ? new Date(row.completedAt) : null,
      });
    } catch (err: any) {
      return Result.fail(err.message);
    }
  }

  async getRefundsTotalForTransaction(originalTransactionId: number, assetId: number): Promise<bigint> {
    const refundTxs = await this.executor
      .select({ id: financialTransactions.id })
      .from(financialTransactions)
      .where(
        and(
          eq(financialTransactions.refundOfTransactionId, originalTransactionId),
          eq(financialTransactions.status, 'completed'),
          eq(financialTransactions.type, 'refund')
        )
      );

    if (refundTxs.length === 0) return 0n;

    const refundTxIds = refundTxs.map((t: any) => t.id);
    const entries = await this.executor
      .select({ amountBaseUnits: financialLedgerEntries.amountBaseUnits })
      .from(financialLedgerEntries)
      .where(
        and(
          inArray(financialLedgerEntries.transactionId, refundTxIds),
          eq(financialLedgerEntries.assetId, assetId),
          eq(financialLedgerEntries.direction, 'credit')
        )
      );

    let total = 0n;
    for (const entry of entries) {
      total += validateCanonicalBaseUnits(entry.amountBaseUnits || '0');
    }
    return total;
  }

  /**
   * [AUDIT FIX P0-03]
   * No longer inserts `createdAt`: accountBalances (tables.ts) only
   * declares `updatedAt`, not `createdAt`. Inserting an unknown field was a
   * direct schema/repository mismatch.
   */
  private async ensureAccountBalance(
    accountId: number,
    assetId: number,
    executorOverride?: FinanceDbExecutor
  ): Promise<void> {
    const exec = executorOverride || this.executor;
    const [existing] = await exec
      .select({ id: accountBalances.id })
      .from(accountBalances)
      .where(
        and(
          eq(accountBalances.accountId, accountId),
          eq(accountBalances.assetId, assetId)
        )
      )
      .limit(1);

    if (!existing) {
      try {
        await exec.insert(accountBalances).values({
          accountId,
          assetId,
          availableBaseUnits: '0',
          lockedBaseUnits: '0',
          version: 1,
          updatedAt: new Date(),
        });
      } catch (err: any) {
        if (!isUniqueConstraintViolation(err)) {
          throw err;
        }
      }
    }
  }

  async insertTransaction(data: {
    userId?: number | null;
    type: FinancialTransactionType;
    category: FinancialTransactionCategory;
    description: string;
    status: FinancialTransactionStatus;
    reversalOfTransactionId?: number;
    refundOfTransactionId?: number;
  }): Promise<Result<number, RepositoryError>> {
    try {
      const [tx] = await this.executor
        .insert(financialTransactions)
        .values({
          userId: data.userId || null,
          type: data.type,
          category: data.category,
          status: data.status,
          description: data.description,
          reversalOfTransactionId: data.reversalOfTransactionId || null,
          refundOfTransactionId: data.refundOfTransactionId || null,
          completedAt: data.status === 'completed' ? new Date() : null,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning({ id: financialTransactions.id });

      if (!tx) {
        return Result.err(RepositoryError.integrity('Falha ao inserir registro de transação financeira.'));
      }
      return Result.ok(tx.id);
    } catch (e: any) {
      return Result.err(RepositoryError.transient(e.message, e));
    }
  }

  async updateTransactionStatus(
    transactionId: number,
    status: FinancialTransactionStatus,
    expectedVersion?: number
  ): Promise<void> {
    const conditions = [eq(financialTransactions.id, transactionId)];
    if (expectedVersion !== undefined) {
      conditions.push(eq(financialTransactions.version, expectedVersion));
    }

    const res = await this.executor
      .update(financialTransactions)
      .set({
        status,
        version: sql`${financialTransactions.version} + 1`,
        completedAt: status === 'completed' ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(and(...conditions));

    const affected = res?.meta?.changes ?? res?.rowsAffected ?? 0;
    if (affected === 0) {
      throw new Error(
        `Falha ao atualizar status da transação ${transactionId} para '${status}'. Registro não encontrado ou versão incompatível.`
      );
    }
  }

  /**
   * [AUDIT FIX P1]
   * No longer silently coerces an unexpected `direction` value to 'credit'.
   * The schema's CHECK should prevent this at the source, but a
   * persistence layer should surface corruption, not mask it as valid data.
   */
  async getTransactionEntries(transactionId: number): Promise<Result<FinancialLedgerEntryRecord[]>> {
    try {
      const rows = await this.executor
        .select({
          accountId: financialLedgerEntries.accountId,
          assetId: financialLedgerEntries.assetId,
          direction: financialLedgerEntries.direction,
          amountBaseUnits: financialLedgerEntries.amountBaseUnits,
        })
        .from(financialLedgerEntries)
        .where(eq(financialLedgerEntries.transactionId, transactionId));

      const mappedRecords: FinancialLedgerEntryRecord[] = rows.map((r: any) => {
        validateCanonicalBaseUnits(String(r.amountBaseUnits));

        if (r.direction !== 'debit' && r.direction !== 'credit') {
          throw new Error(
            `Valor de 'direction' corrompido para lançamento contábil da transação ${transactionId}: '${r.direction}'.`
          );
        }

        return {
          accountId: Number(r.accountId),
          assetId: Number(r.assetId),
          direction: r.direction as 'debit' | 'credit',
          amountBaseUnits: String(r.amountBaseUnits),
        };
      });

      return Result.ok(mappedRecords);
    } catch (err: any) {
      return Result.fail(err.message);
    }
  }

  async listTransactions(userId?: number): Promise<Result<FinancialTransactionRecord[]>> {
    try {
      const query = userId
        ? this.executor.select().from(financialTransactions).where(eq(financialTransactions.userId, userId))
        : this.executor.select().from(financialTransactions);

      const rows = await query;
      const txs: FinancialTransactionRecord[] = rows.map((r: any) => ({
        id: r.id,
        userId: r.userId,
        type: r.type,
        category: r.category,
        status: r.status,
        description: r.description,
        version: r.version,
        createdAt: new Date(r.createdAt),
        completedAt: r.completedAt ? new Date(r.completedAt) : null,
      }));

      return Result.ok(txs);
    } catch (err: any) {
      return Result.fail(err.message);
    }
  }

  // --------------------------------------------------------------------------
  // DOUBLE-ENTRY LEDGER & IDEMPOTENCY
  // --------------------------------------------------------------------------

  async getIdempotencyRecord(
    key: string,
    scope: string
  ): Promise<IdempotencyRecord | null> {
    const [record] = await this.executor
      .select({
        status: idempotencyKeys.status,
        requestHash: idempotencyKeys.requestHash,
        transactionId: idempotencyKeys.financialTransactionId,
        expiresAt: idempotencyKeys.expiresAt,
      })
      .from(idempotencyKeys)
      .where(
        and(
          eq(idempotencyKeys.key, key),
          eq(idempotencyKeys.scope, scope)
        )
      )
      .limit(1);

    if (!record) return null;

    if (record.status === 'completed' && record.transactionId) {
      return {
        status: 'completed',
        transactionId: record.transactionId,
        requestHash: record.requestHash,
      };
    }

    if (record.status === 'failed') {
      return {
        status: 'failed',
        transactionId: null,
        requestHash: record.requestHash,
      };
    }

    const isExpiredProcessing =
      record.status === 'processing' &&
      record.expiresAt &&
      new Date(record.expiresAt).getTime() < Date.now();

    if (isExpiredProcessing) {
      return null;
    }

    return {
      status: 'processing',
      transactionId: null,
      requestHash: record.requestHash,
    };
  }

  /**
   * [AUDIT FIX P0-02 - CRITICAL]
   * On a UNIQUE conflict, this now:
   *   1. Reads the existing row to inspect its status/expiresAt/requestHash.
   *   2. Determines if it's reclaimable at all (failed, or expired
   *      processing) — same as the previous revision.
   *   3. NEW: requires existing.requestHash === requestHash before
   *      reclaiming. A same (key, scope) pair with a DIFFERENT requestHash
   *      means a semantically different request is trying to reuse another
   *      request's idempotency identity — this now throws
   *      IdempotencyKeyReusedWithDifferentRequestError instead of silently
   *      overwriting the stored hash.
   *   4. The actual UPDATE's WHERE clause also re-checks requestHash, so a
   *      concurrent reclaim attempt with a different hash can't race past
   *      the check above and win the UPDATE anyway.
   */
  async claimIdempotency(
    idempotencyKey: string,
    userId: number | null | undefined,
    scope: string,
    requestHash: string
  ): Promise<boolean> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    try {
      await this.executor.insert(idempotencyKeys).values({
        userId: userId ?? null,
        scope,
        key: idempotencyKey,
        requestHash,
        status: 'processing',
        expiresAt,
        createdAt: now,
        updatedAt: now,
      });
      return true;
    } catch (err: any) {
      if (!isUniqueConstraintViolation(err)) {
        throw err;
      }

      const [existing] = await this.executor
        .select({
          status: idempotencyKeys.status,
          requestHash: idempotencyKeys.requestHash,
          expiresAt: idempotencyKeys.expiresAt,
        })
        .from(idempotencyKeys)
        .where(
          and(
            eq(idempotencyKeys.key, idempotencyKey),
            eq(idempotencyKeys.scope, scope)
          )
        )
        .limit(1);

      if (!existing) {
        // Race: the row disappeared between the failed INSERT and this
        // SELECT. Extremely unlikely, but surfaced explicitly rather than
        // silently retried.
        throw new Error(
          `Falha de concorrência: idempotency key '${idempotencyKey}' (scope '${scope}') não encontrada após violação de UNIQUE.`
        );
      }

      const isExpiredProcessing =
        existing.status === 'processing' &&
        existing.expiresAt &&
        new Date(existing.expiresAt).getTime() < now.getTime();

      const isReclaimable = existing.status === 'failed' || isExpiredProcessing;

      if (!isReclaimable) {
        // Either 'completed', or 'processing' and still within its
        // expiresAt window — a legitimate concurrent/duplicate claim
        // attempt. Not an error: the caller should treat this as "already
        // claimed by someone else" and back off.
        return false;
      }

      if (existing.requestHash !== requestHash) {
        throw new IdempotencyKeyReusedWithDifferentRequestError(
          `Idempotency key '${idempotencyKey}' (scope '${scope}') já foi usada com um requestHash diferente. ` +
          `Isso indica reuso indevido da mesma chave para uma requisição semanticamente distinta.`
        );
      }

      const res = await this.executor
        .update(idempotencyKeys)
        .set({
          status: 'processing',
          financialTransactionId: null,
          expiresAt,
          updatedAt: now,
        })
        .where(
          and(
            eq(idempotencyKeys.key, idempotencyKey),
            eq(idempotencyKeys.scope, scope),
            eq(idempotencyKeys.requestHash, requestHash),
            or(
              eq(idempotencyKeys.status, 'failed'),
              and(
                eq(idempotencyKeys.status, 'processing'),
                lt(idempotencyKeys.expiresAt, now)
              )
            )
          )
        );

      const affected = res?.meta?.changes ?? res?.rowsAffected ?? 0;
      return affected > 0;
    }
  }

  /**
   * Call this from the use case's failure path right after
   * claimIdempotency() succeeds but the domain operation itself fails.
   */
  async failIdempotency(key: string, scope: string): Promise<void> {
    await this.executor
      .update(idempotencyKeys)
      .set({
        status: 'failed',
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(idempotencyKeys.key, key),
          eq(idempotencyKeys.scope, scope),
          eq(idempotencyKeys.status, 'processing')
        )
      );
    // Intentionally not throwing if 0 rows affected: the caller is on a
    // failure path already, and a missing/already-resolved row here
    // shouldn't mask the original domain error.
  }

  async completeIdempotency(key: string, scope: string, transactionId: number): Promise<void> {
    const res = await this.executor
      .update(idempotencyKeys)
      .set({
        status: 'completed',
        financialTransactionId: transactionId
      })
      .where(
        and(
          eq(idempotencyKeys.key, key),
          eq(idempotencyKeys.scope, scope),
          eq(idempotencyKeys.status, 'processing')
        )
      );

    const affected = res?.meta?.changes ?? res?.rowsAffected ?? 0;
    if (affected === 0) {
      throw new Error(
        `Falha ao concluir Idempotency Key (${key}): Registro de idempotência não encontrado ou não está em estado 'processing'.`
      );
    }
  }

  async insertLedgerEntries(entries: ReadonlyArray<LedgerEntry>, transactionId: number): Promise<Result<void, RepositoryError>> {
    try {
      const balanceByAsset = new Map<number, bigint>();

      const payload = entries.map(entry => {
        const amountBigInt = entry.amount.toBigInt();

        if (amountBigInt <= 0n) {
          throw new Error(`Invalid ledger entry amount: ${amountBigInt}`);
        }

        if (amountBigInt > MAX_BINDING_SAFE_BASE_UNITS_BIGINT) {
          throw new Money256OverflowError(
            `Quantia de lançamento contábil (${amountBigInt}) excede o limite binding-safe do D1 (${MAX_BINDING_SAFE_BASE_UNITS}).`
          );
        }

        const accountIdNum = Number(entry.accountId);
        const assetIdNum = Number(entry.amount.assetId);

        if (!Number.isInteger(accountIdNum) || accountIdNum <= 0) {
          throw new Error(`Invalid physical accountId: ${entry.accountId}`);
        }
        if (!Number.isInteger(assetIdNum) || assetIdNum <= 0) {
          throw new Error(`Invalid physical assetId: ${entry.amount.assetId}`);
        }

        const signedAmount = entry.type === 'debit' ? amountBigInt : -amountBigInt;
        balanceByAsset.set(assetIdNum, (balanceByAsset.get(assetIdNum) ?? 0n) + signedAmount);

        return {
          transactionId,
          accountId: accountIdNum,
          assetId: assetIdNum,
          direction: entry.type,
          amountBaseUnits: amountBigInt.toString(),
          createdAt: new Date(),
        };
      });

      for (const [assetId, netAmount] of balanceByAsset) {
        if (netAmount !== 0n) {
          throw new Error(
            `Lançamentos contábeis desbalanceados para transação ${transactionId}, asset ${assetId}: diferença débito-crédito = ${netAmount}.`
          );
        }
      }

      if (payload.length > 0) {
        await this.executor.insert(financialLedgerEntries).values(payload);
      }
      return Result.ok();
    } catch (e: any) {
      if (e instanceof Money256OverflowError) {
        return Result.err(RepositoryError.constraint(e.message, e));
      }
      return Result.err(RepositoryError.transient(e.message, e));
    }
  }

  async updateBalanceWithOCC(
    accountId: number | string,
    assetId: number | string,
    amount: bigint,
    type: 'debit' | 'credit',
    executorOverride?: FinanceDbExecutor
  ): Promise<BalanceUpdateResult> {
    const exec = executorOverride || this.executor;

    if (typeof amount !== 'bigint' || amount <= 0n) {
      throw new Error(`Invalid base units amount for OCC update: ${amount}`);
    }

    if (amount > MAX_BINDING_SAFE_BASE_UNITS_BIGINT) {
      throw new Money256OverflowError(
        `Quantia informada (${amount}) excede o limite binding-safe do D1 (${MAX_BINDING_SAFE_BASE_UNITS}).`
      );
    }

    const accIdNum = Number(accountId);
    const assetIdNum = Number(assetId);

    if (!Number.isInteger(accIdNum) || accIdNum <= 0) {
      throw new Error(`Invalid physical accountId: ${accountId}`);
    }
    if (!Number.isInteger(assetIdNum) || assetIdNum <= 0) {
      throw new Error(`Invalid physical assetId: ${assetId}`);
    }

    // 1. Validar status ativo do ativo financeiro (antes de qualquer escrita)
    const [assetRow] = await exec
      .select({ status: financialAssets.status })
      .from(financialAssets)
      .where(eq(financialAssets.id, assetIdNum))
      .limit(1);

    if (!assetRow) {
      throw new Error(`Financial asset #${assetIdNum} not found.`);
    }
    if (assetRow.status !== 'active') {
      throw new AssetInactiveError(`Ativo financeiro #${assetIdNum} está inativo ou suspenso.`);
    }

    // 2. Determinar a classe e status da conta com switch exaustivo
    //    (também antes de qualquer escrita)
    const [accRow] = await exec
      .select({
        accountClass: financialAccounts.accountClass,
        status: financialAccounts.status,
      })
      .from(financialAccounts)
      .where(eq(financialAccounts.id, accIdNum))
      .limit(1);

    if (!accRow) {
      throw new Error(`Account not found: ${accountId}`);
    }

    if (accRow.status !== 'active') {
      throw new AccountInactiveError(`Conta financeira #${accIdNum} está inativa ou suspensa.`);
    }

    const accClass = accRow.accountClass;
    let isDebitNormal: boolean;
    switch (accClass) {
      case 'asset':
      case 'expense':
        isDebitNormal = true;
        break;
      case 'liability':
      case 'equity':
      case 'revenue':
        isDebitNormal = false;
        break;
      default:
        throw new InvalidAccountClassError(`Classe contábil '${accClass}' inválida ou não suportada.`);
    }

    // 3. Só agora garantir que a linha de saldo exista (auto-provisionamento)
    await this.ensureAccountBalance(accIdNum, assetIdNum, exec);

    // 4. Selecionar o saldo com OCC version
    const [balance] = await exec
      .select({
        id: accountBalances.id,
        availableBaseUnits: accountBalances.availableBaseUnits,
        version: accountBalances.version,
      })
      .from(accountBalances)
      .where(
        and(
          eq(accountBalances.accountId, accIdNum),
          eq(accountBalances.assetId, assetIdNum)
        )
      )
      .limit(1);

    if (!balance) {
      throw new Error(`Balance not found for account ${accountId} and asset ${assetId}`);
    }

    const currentVersion = balance.version;
    const isIncrease = isDebitNormal ? type === 'debit' : type === 'credit';
    const currentAvailable = validateCanonicalBaseUnits(balance.availableBaseUnits || '0');
    const newAvailable = isIncrease
      ? currentAvailable + amount
      : currentAvailable - amount;

    if (newAvailable < 0n) {
      return 'INSUFFICIENT_BALANCE';
    }

    if (newAvailable > MAX_BINDING_SAFE_BASE_UNITS_BIGINT) {
      throw new Money256OverflowError(
        `Novo saldo disponível (${newAvailable}) excederia o limite binding-safe do D1 (${MAX_BINDING_SAFE_BASE_UNITS}).`
      );
    }

    const newAvailableStr = newAvailable.toString();

    const res = await exec
      .update(accountBalances)
      .set({
        availableBaseUnits: newAvailableStr,
        version: currentVersion + 1,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(accountBalances.id, balance.id),
          eq(accountBalances.version, currentVersion)
        )
      );

    const affected = res?.meta?.changes ?? res?.rowsAffected ?? 0;
    return affected > 0 ? 'UPDATED' : 'OCC_CONFLICT';
  }
}