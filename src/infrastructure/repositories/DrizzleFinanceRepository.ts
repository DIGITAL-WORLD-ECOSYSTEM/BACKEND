import { eq, and, or, lt, inArray, sql, asc, desc } from 'drizzle-orm';
import {
  financialAccounts,
  accountBalances,
  financialTransactions,
  financialLedgerEntries,
  financialAssets,
  fiatExternalTransactions,
  systemAccountRoutes,
  MAX_UINT256_BASE_UNITS_TEXT,
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
  TreasuryBootstrapOptions,
  TreasuryBootstrapResult,
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
import { AccountClassPolicy } from '../../domains/finance/policies/AccountClassPolicy';
import { BaseSQLiteDatabase, SQLiteTransaction } from 'drizzle-orm/sqlite-core';
import { IPostingExecutor } from '../../application/ports/output/IPostingExecutor';
import { D1AtomicPostingExecutor } from '../services/D1AtomicPostingExecutor';
import { isD1Database } from './db_helper';
import { PostingSession, issueBoundaryPostingSession } from '../../domains/finance/contracts/PostingSession';

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

export type FinanceDatabase = BaseSQLiteDatabase<'async', any, any>;
export type FinanceTransaction = SQLiteTransaction<'async', any, any, any>;
export type FinanceDbExecutor = FinanceDatabase | FinanceTransaction;

const MAX_UINT256_BASE_UNITS_BIGINT = BigInt(MAX_UINT256_BASE_UNITS_TEXT);

export function validateCanonicalBaseUnits(val: string): bigint {
  if (!val || !/^(0|[1-9][0-9]*)$/.test(val)) {
    throw new InvalidMoneyFormatError(
      `Formato de baseUnits inválido em storage persistence ('${val}'). Deve ser string decimal canônica sem zeros à esquerda.`
    );
  }
  const parsed = BigInt(val);
  if (parsed > MAX_UINT256_BASE_UNITS_BIGINT) {
    throw new Money256OverflowError(
      `Valor numérico ('${val}') excede o limite uint256 (${MAX_UINT256_BASE_UNITS_TEXT}).`
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
        .orderBy(asc(financialAccounts.id))
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
            accountType: insertValues.accountType as any,
            accountClass: insertValues.accountClass as any,
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

  async getUserAccount(userId: number): Promise<Result<FinancialAccountRecord>> {
    try {
      const [row] = await this.executor
        .select()
        .from(financialAccounts)
        .where(
          and(
            eq(financialAccounts.userId, userId),
            eq(financialAccounts.accountType, 'user_available')
          )
        )
        .limit(1);

      if (!row) {
        return Result.fail(`Conta de usuário não encontrada para userId ${userId}.`);
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
      return Result.fail(`Falha ao obter conta de usuário: ${err?.message || String(err)}`);
    }
  }

  async getAccountBalance(accountId: number, assetId: number): Promise<Result<AccountBalanceRecord>> {
    try {
      const [row] = await this.executor
        .select({
          id: accountBalances.id,
          accountId: accountBalances.accountId,
          assetId: accountBalances.assetId,
          availableBaseUnits: accountBalances.availableBaseUnits,
          lockedBaseUnits: accountBalances.lockedBaseUnits,
          version: accountBalances.version,
        })
        .from(accountBalances)
        .where(
          and(
            eq(accountBalances.accountId, accountId),
            eq(accountBalances.assetId, assetId)
          )
        )
        .limit(1);

      if (!row) {
        return Result.fail(`Saldo não encontrado para conta #${accountId} e ativo #${assetId}.`);
      }

      return Result.ok(row);
    } catch (err: any) {
      return Result.fail(`Falha ao obter saldo: ${err?.message || String(err)}`);
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
      const validClasses = AccountClassPolicy.getAllowedClasses(accountType);
      if (validClasses.length === 0) {
        return Result.fail(`Tipo de conta sistêmica "${accountType}" não é reconhecido por AccountClassPolicy (fail-closed).`);
      }

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
        .orderBy(asc(financialAccounts.id))
        .limit(1);

      if (!row) {
        return Result.fail(`System account of type "${accountType}" not found. Must be provisioned via bootstrap seed.`);
      }

      if (!(validClasses as readonly string[]).includes(row.accountClass)) {
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

  async resolveSystemAccount(
    accountType: SystemAccountType | string,
    providerId?: number | null
  ): Promise<Result<FinancialAccountRecord>> {
    try {
      if (providerId !== undefined && providerId !== null) {
        const [providerRoute] = await this.executor
          .select({ accountId: systemAccountRoutes.accountId })
          .from(systemAccountRoutes)
          .where(
            and(
              eq(systemAccountRoutes.accountType, accountType),
              eq(systemAccountRoutes.providerId, providerId),
              eq(systemAccountRoutes.status, 'active')
            )
          )
          .limit(1);

        if (providerRoute) {
          return await this.getAccountById(providerRoute.accountId);
        }
      }

      const [globalRoute] = await this.executor
        .select({ accountId: systemAccountRoutes.accountId })
        .from(systemAccountRoutes)
        .where(
          and(
            eq(systemAccountRoutes.accountType, accountType),
            sql`${systemAccountRoutes.providerId} IS NULL`,
            eq(systemAccountRoutes.status, 'active')
          )
        )
        .limit(1);

      if (globalRoute) {
        return await this.getAccountById(globalRoute.accountId);
      }

      return await this.getSystemAccount(accountType as any);
    } catch (err: any) {
      return Result.fail(`Erro ao resolver rota de conta sistêmica: ${err.message}`);
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
    assetId: number
  ): Promise<void> {
    const [existing] = await this.executor
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
        await this.executor.insert(accountBalances).values({
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
    actorUserId?: number | null;
    authorizedByUserId?: number | null;
    type: FinancialTransactionType;
    category: FinancialTransactionCategory;
    description: string;
    status: FinancialTransactionStatus;
    reversalOfTransactionId?: number;
    refundOfTransactionId?: number;
    sourceType?: string | null;
    sourceId?: string | null;
    correlationId?: string | null;
  }): Promise<Result<number, RepositoryError>> {
    try {
      const [tx] = await this.executor
        .insert(financialTransactions)
        .values({
          userId: data.userId || null,
          actorUserId: data.actorUserId || null,
          authorizedByUserId: data.authorizedByUserId || null,
          type: data.type,
          category: data.category,
          status: data.status,
          sourceType: data.sourceType || null,
          sourceId: data.sourceId || null,
          correlationId: data.correlationId || null,
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
      const msg = e?.message || String(e);
      if (
        msg.includes('UNIQUE constraint failed') ||
        msg.includes('PRIMARY KEY must be unique') ||
        msg.includes('SQLITE_CONSTRAINT_UNIQUE') ||
        msg.includes('uq_financial_tx_active_reversal')
      ) {
        return Result.err(RepositoryError.conflict(`Conflito de integridade/unicidade na transação financeira: ${msg}`, e));
      }
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

    const updates: Record<string, unknown> = {
      status,
      version: sql`${financialTransactions.version} + 1`,
      updatedAt: new Date(),
    };

    if (status === 'completed') {
      updates.completedAt = new Date();
    } else if (status === 'failed' || status === 'cancelled') {
      updates.completedAt = null;
    }
    // Para 'reversed' e 'refunded': o completedAt histórico original é rigorosamente preservado!

    const res = await this.executor
      .update(financialTransactions)
      .set(updates)
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

        const accountIdNum = Number(r.accountId);
        const assetIdNum = Number(r.assetId);

        if (!Number.isSafeInteger(accountIdNum) || accountIdNum <= 0) {
          throw new Error(`Invalid accountId from database for transaction ${transactionId}: ${r.accountId}`);
        }
        if (!Number.isSafeInteger(assetIdNum) || assetIdNum <= 0) {
          throw new Error(`Invalid assetId from database for transaction ${transactionId}: ${r.assetId}`);
        }

        return {
          accountId: accountIdNum,
          assetId: assetIdNum,
          direction: r.direction as 'debit' | 'credit',
          amountBaseUnits: String(r.amountBaseUnits),
        };
      });

      return Result.ok(mappedRecords);
    } catch (err: any) {
      return Result.fail(err.message);
    }
  }

  async listTransactions(userId?: number, options?: { cursor?: number; limit?: number }): Promise<Result<FinancialTransactionRecord[]>> {
    try {
      const limit = options?.limit ? Math.min(Math.max(options.limit, 1), 100) : 100;
      const conditions = [];
      if (userId) {
        conditions.push(eq(financialTransactions.userId, userId));
      }
      if (options?.cursor) {
        conditions.push(lt(financialTransactions.id, options.cursor));
      }

      const query = conditions.length > 0
        ? this.executor.select().from(financialTransactions).where(and(...conditions)).orderBy(desc(financialTransactions.id)).limit(limit)
        : this.executor.select().from(financialTransactions).orderBy(desc(financialTransactions.id)).limit(limit);

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
        leaseOwner: idempotencyKeys.leaseOwner,
        leaseGeneration: idempotencyKeys.leaseGeneration,
        expiresAt: idempotencyKeys.expiresAt,
        responseStatus: idempotencyKeys.responseStatus,
        responsePayload: idempotencyKeys.responsePayload,
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
        leaseOwner: record.leaseOwner,
        leaseGeneration: record.leaseGeneration,
        expiresAt: record.expiresAt,
        responseStatus: record.responseStatus,
        responsePayload: record.responsePayload,
      };
    }

    if (record.status === 'failed') {
      return {
        status: 'failed',
        transactionId: null,
        requestHash: record.requestHash,
        leaseOwner: record.leaseOwner,
        leaseGeneration: record.leaseGeneration,
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
      leaseOwner: record.leaseOwner,
      leaseGeneration: record.leaseGeneration,
      expiresAt: record.expiresAt,
      responseStatus: record.responseStatus,
      responsePayload: record.responsePayload,
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
    requestHash: string,
    options?: { leaseOwner?: string; leaseTimeoutMs?: number }
  ): Promise<boolean> {
    const now = new Date();
    const leaseTimeoutMs = options?.leaseTimeoutMs ?? 24 * 60 * 60 * 1000;
    const expiresAt = new Date(now.getTime() + leaseTimeoutMs);
    const leaseOwner = options?.leaseOwner ?? `worker_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    try {
      await this.executor.insert(idempotencyKeys).values({
        userId: userId ?? null,
        scope,
        key: idempotencyKey,
        requestHash,
        status: 'processing',
        leaseOwner,
        leaseGeneration: 1,
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
          leaseGeneration: idempotencyKeys.leaseGeneration,
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

      // Atomic CAS Reclaim with monotonic lease generation increment and new owner
      const res = await this.executor
        .update(idempotencyKeys)
        .set({
          status: 'processing',
          financialTransactionId: null,
          leaseOwner,
          leaseGeneration: sql`${idempotencyKeys.leaseGeneration} + 1`,
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
  /**
   * Call this from the use case's failure path right after
   * claimIdempotency() succeeds but the domain operation itself fails.
   * [AUDIT FIX P0-05] Aplica lease fencing estrito para impedir que stale workers alterem leases subsequentes.
   */
  async failIdempotency(
    key: string,
    scope: string,
    options?: { leaseOwner?: string; leaseGeneration?: number; failureCode?: string } | string
  ): Promise<void> {
    const opts = typeof options === 'object' && options !== null ? options : {};
    const conditions = [
      eq(idempotencyKeys.key, key),
      eq(idempotencyKeys.scope, scope),
      eq(idempotencyKeys.status, 'processing'),
    ];
    if (opts.leaseOwner) {
      conditions.push(eq(idempotencyKeys.leaseOwner, opts.leaseOwner));
    }
    if (typeof opts.leaseGeneration === 'number') {
      conditions.push(eq(idempotencyKeys.leaseGeneration, opts.leaseGeneration));
    }

    await this.executor
      .update(idempotencyKeys)
      .set({
        status: 'failed',
        updatedAt: new Date(),
      })
      .where(and(...conditions));
  }

  /**
   * [AUDIT FIX P0-06] Aplica lease fencing estrito na liberação de claim.
   */
  async releaseIdempotencyClaim(
    key: string,
    scope: string,
    options?: { leaseOwner?: string; leaseGeneration?: number }
  ): Promise<void> {
    const conditions = [
      eq(idempotencyKeys.key, key),
      eq(idempotencyKeys.scope, scope),
      eq(idempotencyKeys.status, 'processing'),
    ];
    if (options?.leaseOwner) {
      conditions.push(eq(idempotencyKeys.leaseOwner, options.leaseOwner));
    }
    if (typeof options?.leaseGeneration === 'number') {
      conditions.push(eq(idempotencyKeys.leaseGeneration, options.leaseGeneration));
    }

    await this.executor
      .delete(idempotencyKeys)
      .where(and(...conditions));
  }

  async completeIdempotency(
    key: string,
    scope: string,
    transactionId: number,
    options?: { leaseOwner?: string; leaseGeneration?: number; responseStatus?: number; responsePayload?: string }
  ): Promise<void> {
    const updateSet: any = {
      status: 'completed',
      financialTransactionId: transactionId,
      updatedAt: new Date(),
    };
    if (options?.responseStatus !== undefined && options?.responseStatus !== null) {
      updateSet.responseStatus = options.responseStatus;
    }
    if (options?.responsePayload !== undefined && options?.responsePayload !== null) {
      updateSet.responsePayload = options.responsePayload;
    }

    const whereConditions = [
      eq(idempotencyKeys.key, key),
      eq(idempotencyKeys.scope, scope),
      eq(idempotencyKeys.status, 'processing'),
    ];
    if (options?.leaseOwner !== undefined && options?.leaseOwner !== null) {
      whereConditions.push(eq(idempotencyKeys.leaseOwner, options.leaseOwner));
    }
    if (options?.leaseGeneration !== undefined && options?.leaseGeneration !== null) {
      whereConditions.push(eq(idempotencyKeys.leaseGeneration, options.leaseGeneration));
    }

    const res = await this.executor
      .update(idempotencyKeys)
      .set(updateSet)
      .where(and(...whereConditions));

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

      const payload = entries.map((entry, index) => {
        const amountBigInt = entry.amount.toBigInt();

        if (amountBigInt <= 0n) {
          throw new Error(`Invalid ledger entry amount: ${amountBigInt}`);
        }

        if (amountBigInt > MAX_UINT256_BASE_UNITS_BIGINT) {
          throw new Money256OverflowError(
            `Quantia de lançamento contábil (${amountBigInt}) excede o limite uint256 (${MAX_UINT256_BASE_UNITS_TEXT}).`
          );
        }

        const accountIdNum = Number(entry.accountId);
        const assetIdNum = Number(entry.amount.assetId);

        if (!Number.isSafeInteger(accountIdNum) || accountIdNum <= 0) {
          throw new Error(`Invalid physical accountId: ${entry.accountId}`);
        }
        if (!Number.isSafeInteger(assetIdNum) || assetIdNum <= 0) {
          throw new Error(`Invalid physical assetId: ${entry.amount.assetId}`);
        }

        const signedAmount = entry.type === 'debit' ? amountBigInt : -amountBigInt;
        balanceByAsset.set(assetIdNum, (balanceByAsset.get(assetIdNum) ?? 0n) + signedAmount);

        return {
          transactionId,
          entryOrdinal: index,
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
    type: 'debit' | 'credit'
  ): Promise<BalanceUpdateResult> {
    if (typeof amount !== 'bigint' || amount <= 0n) {
      throw new Error(`Invalid base units amount for OCC update: ${amount}`);
    }

    if (amount > MAX_UINT256_BASE_UNITS_BIGINT) {
      throw new Money256OverflowError(
        `Quantia informada (${amount}) excede o limite uint256 (${MAX_UINT256_BASE_UNITS_TEXT}).`
      );
    }

    const accIdNum = Number(accountId);
    const assetIdNum = Number(assetId);

    if (!Number.isSafeInteger(accIdNum) || accIdNum <= 0) {
      throw new Error(`Invalid physical accountId: ${accountId}`);
    }
    if (!Number.isSafeInteger(assetIdNum) || assetIdNum <= 0) {
      throw new Error(`Invalid physical assetId: ${assetId}`);
    }

    // 1. Validar status ativo do ativo financeiro (antes de qualquer escrita)
    const [assetRow] = await this.executor
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
    const [accRow] = await this.executor
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
    await this.ensureAccountBalance(accIdNum, assetIdNum);

    // 4. Selecionar o saldo com OCC version
    const [balance] = await this.executor
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

    if (newAvailable > MAX_UINT256_BASE_UNITS_BIGINT) {
      throw new Money256OverflowError(
        `Novo saldo disponível (${newAvailable}) excederia o limite uint256 (${MAX_UINT256_BASE_UNITS_TEXT}).`
      );
    }

    const newAvailableStr = newAvailable.toString();

    const res = await this.executor
      .update(accountBalances)
      .set({
        availableBaseUnits: newAvailableStr,
        version: currentVersion + 1,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(accountBalances.id, balance.id),
          eq(accountBalances.version, currentVersion),
          sql`(SELECT status FROM financial_accounts WHERE id = ${accIdNum}) = 'active'`
        )
      );

    const affected = res?.meta?.changes ?? res?.rowsAffected ?? 0;
    return affected > 0 ? 'UPDATED' : 'OCC_CONFLICT';
  }

  private _postingSession?: PostingSession;

  /**
   * [AUDIT FIX P0-01, P0-02] Emissão de PostingSession restrita à fronteira transacional.
   */
  public getPostingSession(): PostingSession {
    if (!this._postingSession) {
      const isD1 = isD1Database(this.db);
      const mode = isD1 ? 'd1-batch' : 'sqlite-transaction';
      const boundaryId = `repo_boundary_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      this._postingSession = issueBoundaryPostingSession(mode, boundaryId);
    }
    return this._postingSession;
  }

  public getPostingExecutor(): IPostingExecutor {
    return new D1AtomicPostingExecutor(this.db);
  }


  async insertFiatExternalTransaction(data: {
    providerId: number;
    fiatAccountId?: number | null;
    externalTransactionId: string;
    rawAmount: string;
    amountBaseUnits?: string | null;
    direction: 'credit' | 'debit';
    assetId?: number | null;
    rawDescription?: string | null;
    bankTimestamp?: Date | number | null;
    documentNumber?: string | null;
    runningBalanceBaseUnits?: string | null;
    sourceFile?: string | null;
    sourceFileHash?: string | null;
    rowFingerprint?: string | null;
    rawPayload?: string | null;
    status?: string;
    reconciliationStatus?: 'unmatched' | 'matched' | 'ignored' | 'discrepancy';
    financialTransactionId?: number | null;
  }): Promise<Result<number, RepositoryError>> {
    try {
      const bankDate = data.bankTimestamp
        ? typeof data.bankTimestamp === 'number'
          ? new Date(data.bankTimestamp)
          : data.bankTimestamp
        : null;

      const [row] = await this.executor
        .insert(fiatExternalTransactions)
        .values({
          providerId: data.providerId,
          fiatAccountId: data.fiatAccountId ?? null,
          externalTransactionId: data.externalTransactionId,
          rawAmount: data.rawAmount,
          amountBaseUnits: data.amountBaseUnits ?? null,
          direction: data.direction,
          assetId: data.assetId ?? null,
          rawDescription: data.rawDescription ?? null,
          bankTimestamp: bankDate,
          documentNumber: data.documentNumber ?? null,
          runningBalanceBaseUnits: data.runningBalanceBaseUnits ?? null,
          sourceFile: data.sourceFile ?? null,
          sourceFileHash: data.sourceFileHash ?? null,
          rowFingerprint: data.rowFingerprint ?? null,
          rawPayload: data.rawPayload ?? null,
          status: (data.status as any) || 'pending',
          reconciliationStatus: data.reconciliationStatus || 'unmatched',
          financialTransactionId: data.financialTransactionId ?? null,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning({ id: fiatExternalTransactions.id });

      if (!row) {
        return Result.err(
          RepositoryError.integrity('Falha ao inserir transação externa fiat.')
        );
      }
      return Result.ok(row.id);
    } catch (e: any) {
      return Result.err(RepositoryError.transient(e.message, e));
    }
  }

  async getFiatExternalTransactionByFingerprint(
    rowFingerprint: string
  ): Promise<Result<any | null, RepositoryError>> {
    try {
      const [row] = await this.executor
        .select()
        .from(fiatExternalTransactions)
        .where(eq(fiatExternalTransactions.rowFingerprint, rowFingerprint))
        .limit(1);

      return Result.ok(row || null);
    } catch (e: any) {
      return Result.err(RepositoryError.transient(e.message, e));
    }
  }

  async updateFiatExternalTransactionReconciliation(
    id: number,
    update: {
      status?: string;
      reconciliationStatus: 'unmatched' | 'matched' | 'ignored' | 'discrepancy';
      financialTransactionId?: number | null;
      amountBaseUnits?: string | null;
      assetId?: number | null;
    }
  ): Promise<Result<void, RepositoryError>> {
    try {
      const setPayload: Record<string, any> = {
        reconciliationStatus: update.reconciliationStatus,
        updatedAt: new Date(),
      };
      if (update.status !== undefined) {
        setPayload.status = update.status;
      }
      if (update.financialTransactionId !== undefined) {
        setPayload.financialTransactionId = update.financialTransactionId;
      }
      if (update.amountBaseUnits !== undefined) {
        setPayload.amountBaseUnits = update.amountBaseUnits;
      }
      if (update.assetId !== undefined) {
        setPayload.assetId = update.assetId;
      }

      await this.executor
        .update(fiatExternalTransactions)
        .set(setPayload)
        .where(eq(fiatExternalTransactions.id, id));

      return Result.ok(undefined);
    } catch (e: any) {
      return Result.err(RepositoryError.transient(e.message, e));
    }
  }

  /**
   * Provisiona a infraestrutura básica do Finance Core (Ativo padrão, contas sistêmicas e saldos zerados)
   * dentro do contexto transacional do repositório (this.executor).
   */
  async provisionTreasuryInfrastructure(
    options: TreasuryBootstrapOptions = {}
  ): Promise<Result<TreasuryBootstrapResult, RepositoryError>> {
    const currency = options.currencyCode || 'BRL';

    try {
      // 1. Assegurar Ativo Financeiro
      let [asset] = await this.executor
        .select()
        .from(financialAssets)
        .where(eq(financialAssets.code, currency))
        .limit(1);

      if (!asset) {
        try {
          await this.executor.insert(financialAssets).values({
            code: currency,
            symbol: currency === 'BRL' ? 'R$' : '$',
            name: `${currency} Base Currency`,
            decimals: 2,
            type: 'fiat',
            status: 'active',
            createdAt: new Date(),
            updatedAt: new Date(),
          });
        } catch (insertErr: any) {
          if (!isUniqueConstraintViolation(insertErr)) {
            return Result.err(RepositoryError.transient(`Falha ao inserir ativo ${currency}: ${insertErr.message}`, insertErr));
          }
        }
        [asset] = await this.executor
          .select()
          .from(financialAssets)
          .where(eq(financialAssets.code, currency))
          .limit(1);
      }

      if (!asset) {
        return Result.err(RepositoryError.notFound(`Ativo ${currency} não pôde ser criado ou recuperado.`));
      }

      const assetId = asset.id;

      // Helper para buscar ou criar conta sistêmica com userId = null
      const ensureSystemAccount = async (
        accountType:
          | 'treasury'
          | 'operating'
          | 'fees'
          | 'reward_expense'
          | 'yield_expense'
          | 'clearing'
          | 'opening_balance_equity'
          | 'payment_revenue'
          | 'refund_expense',
        accountClass: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense',
        name: string
      ) => {
        let [acc] = await this.executor
          .select()
          .from(financialAccounts)
          .where(
            and(
              eq(financialAccounts.accountType, accountType),
              eq(financialAccounts.status, 'active')
            )
          )
          .limit(1);

        if (!acc) {
          try {
            await this.executor.insert(financialAccounts).values({
              userId: null,
              accountType,
              accountClass,
              status: 'active',
              name,
              createdAt: new Date(),
              updatedAt: new Date(),
            });
          } catch (insertErr: any) {
            if (!isUniqueConstraintViolation(insertErr)) {
              throw insertErr;
            }
          }
          [acc] = await this.executor
            .select()
            .from(financialAccounts)
            .where(
              and(
                eq(financialAccounts.accountType, accountType),
                eq(financialAccounts.status, 'active')
              )
            )
            .limit(1);
        }

        if (!acc) {
          throw new Error(`Conta sistêmica '${accountType}' não pôde ser criada ou recuperada.`);
        }
        return acc;
      };

      // Provisionar todas as contas sistêmicas necessárias
      const treasuryAcc = await ensureSystemAccount('treasury', 'asset', 'Treasury Primary Vault');
      const operatingAcc = await ensureSystemAccount('operating', 'asset', 'System Operating Vault');
      const feeAcc = await ensureSystemAccount('fees', 'revenue', 'System Fee Collector');
      const rewardExpenseAcc = await ensureSystemAccount('reward_expense', 'expense', 'System Reward Expense');
      const yieldExpenseAcc = await ensureSystemAccount('yield_expense', 'expense', 'System Yield Expense');
      const clearingAcc = await ensureSystemAccount('clearing', 'asset', 'System FX Clearing Account');
      const openingEquityAcc = await ensureSystemAccount('opening_balance_equity', 'equity', 'System Opening Balance Equity');
      const paymentRevenueAcc = await ensureSystemAccount('payment_revenue', 'revenue', 'System Payment Revenue Account');
      const refundExpenseAcc = await ensureSystemAccount('refund_expense', 'expense', 'System Refund Expense Account');

      const systemAccounts = [
        treasuryAcc.id,
        operatingAcc.id,
        feeAcc.id,
        rewardExpenseAcc.id,
        yieldExpenseAcc.id,
        clearingAcc.id,
        openingEquityAcc.id,
        paymentRevenueAcc.id,
        refundExpenseAcc.id,
      ];

      // Assegurar saldo zerado inicial para cada conta sistêmica
      for (const accId of systemAccounts) {
        const [existingBal] = await this.executor
          .select({ id: accountBalances.id })
          .from(accountBalances)
          .where(
            and(
              eq(accountBalances.accountId, accId),
              eq(accountBalances.assetId, assetId)
            )
          )
          .limit(1);

        if (!existingBal) {
          try {
            await this.executor.insert(accountBalances).values({
              accountId: accId,
              assetId,
              availableBaseUnits: '0',
              lockedBaseUnits: '0',
              version: 1,
              updatedAt: new Date(),
            });
          } catch (balErr: any) {
            if (!isUniqueConstraintViolation(balErr)) {
              throw balErr;
            }
          }
        }
      }

      return Result.ok({
        assetId,
        treasuryAccountId: treasuryAcc.id,
        operatingAccountId: operatingAcc.id,
        feeAccountId: feeAcc.id,
        rewardExpenseAccountId: rewardExpenseAcc.id,
        yieldExpenseAccountId: yieldExpenseAcc.id,
        clearingAccountId: clearingAcc.id,
        openingEquityAccountId: openingEquityAcc.id,
        paymentRevenueAccountId: paymentRevenueAcc.id,
        refundExpenseAccountId: refundExpenseAcc.id,
      });
    } catch (err: any) {
      return Result.err(RepositoryError.transient(err?.message || 'Falha ao provisionar infraestrutura contábil', err));
    }
  }
}