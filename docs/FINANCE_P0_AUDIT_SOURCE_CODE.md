# Dossiê de Código Fonte — Auditoria P0 Finance Core

Este documento consolida o código-fonte **100% integral, real e sem cortes** dos 12 arquivos prioritários **P0** para a 1ª etapa de auditoria e saneamento do core financeiro (`BackEnd/`).

## Índice de Arquivos P0

1. [DrizzleUnitOfWork.ts](#src_infrastructure_repositories_DrizzleUnitOfWork_ts) (`src/infrastructure/repositories/DrizzleUnitOfWork.ts`) — *154 linhas*
   - **Foco de Fechamento**: Atomicidade real das mutações: transaction boundary, rollback, falha entre queries, commit failure, interação com D1/DO

2. [DrizzleFinanceRepository.ts](#src_infrastructure_repositories_DrizzleFinanceRepository_ts) (`src/infrastructure/repositories/DrizzleFinanceRepository.ts`) — *1549 linhas*
   - **Foco de Fechamento**: Persistência completa de todas as mutations + propagação de actor_user_id, authorized_by_user_id, source_type, correlation_id

3. [RecordTransferUseCase.ts](#src_application_finance_use-cases_RecordTransferUseCase_ts) (`src/application/finance/use-cases/RecordTransferUseCase.ts`) — *149 linhas*
   - **Foco de Fechamento**: Isolamento de custódia, ownership, limites de origem/destino, autorização e bloqueio de P2P indevido

4. [FinancialTransactionOrchestrator.ts](#src_application_finance_services_FinancialTransactionOrchestrator_ts) (`src/application/finance/services/FinancialTransactionOrchestrator.ts`) — *354 linhas*
   - **Foco de Fechamento**: Fechamento da cadeia inteira: idempotência → domínio → OCC → ledger → balance → outbox → auditoria

5. [EventInboxService.ts](#src_infrastructure_services_EventInboxService_ts) (`src/infrastructure/services/EventInboxService.ts`) — *187 linhas*
   - **Foco de Fechamento**: Crash/retry/lease expiry; garantir consumidor idempotente e transição de estado segura

6. [FinanceBootstrapService.ts](#src_infrastructure_services_FinanceBootstrapService_ts) (`src/infrastructure/services/FinanceBootstrapService.ts`) — *75 linhas*
   - **Foco de Fechamento**: Garantir que bootstrap nunca inicialize/altere produção indevidamente e seja explicitamente condicionado ao ambiente

7. [0011_treasury_singleton_and_forensic_audit.sql](#migrations_0011_treasury_singleton_and_forensic_audit_sql) (`migrations/0011_treasury_singleton_and_forensic_audit.sql`) — *20 linhas*
   - **Foco de Fechamento**: Confirmar que o modelo físico da auditoria forense corresponde exatamente ao que o código grava

8. [0012_finance_p0_hardening.sql](#migrations_0012_finance_p0_hardening_sql) (`migrations/0012_finance_p0_hardening.sql`) — *42 linhas*
   - **Foco de Fechamento**: [COMPANION P0] Enforce physical append-only triggers, leg ordinal, SQL assertion guard and system routes

9. [tables.ts](#src_db_finance_tables_ts) (`src/db/finance/tables.ts`) — *3586 linhas*
   - **Foco de Fechamento**: Constraints definitivas, unicidade, FK, status, versões, valores, cardinalidade e proteção do ledger

10. [IUnitOfWork.ts](#src_application_ports_output_IUnitOfWork_ts) (`src/application/ports/output/IUnitOfWork.ts`) — *31 linhas*
   - **Foco de Fechamento**: Contrato da UoW precisa representar a semântica transacional real que a infraestrutura efetivamente consegue entregar

11. [IFinanceRepository.ts](#src_application_ports_output_IFinanceRepository_ts) (`src/application/ports/output/IFinanceRepository.ts`) — *215 linhas*
   - **Foco de Fechamento**: Contrato precisa contemplar todas as mutations e metadados forenses exigidos

12. [IOutboxRepository.ts](#src_application_ports_output_IOutboxRepository_ts) (`src/application/ports/output/IOutboxRepository.ts`) — *75 linhas*
   - **Foco de Fechamento**: Garantir atomicidade lógica com a UoW e contrato de publicação/reprocessamento

13. [DrizzleOutboxRepository.ts](#src_infrastructure_repositories_DrizzleOutboxRepository_ts) (`src/infrastructure/repositories/DrizzleOutboxRepository.ts`) — *209 linhas*
   - **Foco de Fechamento**: Revalidar a afirmação de 'transacional' em conjunto com a nova UoW


---

<a id="src_infrastructure_repositories_DrizzleUnitOfWork_ts"></a>
## 1. `src/infrastructure/repositories/DrizzleUnitOfWork.ts`

- **Caminho absoluto**: `/home/sandro/Área de trabalho/BackEnd/src/infrastructure/repositories/DrizzleUnitOfWork.ts`
- **Total de linhas**: 154
- **O que precisa ser fechado**: Atomicidade real das mutações: transaction boundary, rollback, falha entre queries, commit failure, interação com D1/DO

```typescript
import { IUnitOfWork, IRepositoryFactory } from '../../application/ports/output/IUnitOfWork';
import { IUserRepository } from '../../application/ports/output/IUserRepository';
import { IAuthenticationRepository } from '../../application/ports/output/IAuthenticationRepository';
import { IWeb3Repository } from '../../application/ports/output/IWeb3Repository';
import { ICivilIdentityRepository } from '../../application/ports/output/ICivilIdentityRepository';
import { ISessionRepository } from '../../application/ports/output/ISessionRepository';
import { IOutboxRepository } from '../../application/ports/output/IOutboxRepository';
import { IPasswordResetRepository } from '../../application/ports/output/IPasswordResetRepository';

import { DrizzleUserRepositoryAdapter } from '../repositories/DrizzleUserRepositoryAdapter';
import { DrizzleAuthenticationRepositoryAdapter } from '../repositories/DrizzleAuthenticationRepositoryAdapter';
import { DrizzleWeb3RepositoryAdapter } from '../repositories/DrizzleWeb3RepositoryAdapter';
import { DrizzleCivilIdentityRepositoryAdapter } from '../repositories/DrizzleCivilIdentityRepositoryAdapter';
import { DrizzleSessionRepository } from './DrizzleSessionRepository';
import { ISsiRepository } from '../../application/ports/output/ISsiRepository';
import { DrizzleSsiRepository } from './DrizzleSsiRepository';
import { DrizzleOutboxRepository } from './DrizzleOutboxRepository';
import { DrizzlePasswordResetRepository } from './DrizzlePasswordResetRepository';
import { IFinanceRepository } from '../../application/ports/output/IFinanceRepository';
import { DrizzleFinanceRepository, FinanceDatabase, FinanceTransaction } from './DrizzleFinanceRepository';
import { Result } from '../../shared/kernel/Result';
import { IAuthTransactionRepository } from '../../application/ports/output/IAuthTransactionRepository';
import { DrizzleAuthTransactionRepository } from './DrizzleAuthTransactionRepository';
import { isD1Database } from './db_helper';
import { PostingSession, PostingCapabilityToken } from '../../domains/finance/contracts/PostingSession';
import { IPostingExecutor } from '../../application/ports/output/IPostingExecutor';
import { D1AtomicPostingExecutor } from '../services/D1AtomicPostingExecutor';
import { FinancialError } from '../../domains/finance/errors/FinancialError';

class DrizzleRepositoryFactory implements IRepositoryFactory {
  private _postingSession?: PostingSession;
  private _postingExecutor?: IPostingExecutor;

  constructor(
    private readonly tx: FinanceTransaction,
    private readonly db?: FinanceDatabase,
    private readonly postingCapabilityToken?: typeof PostingCapabilityToken
  ) {}

  getUserRepository(): IUserRepository {
    return new DrizzleUserRepositoryAdapter((this.tx || this.db) as any);
  }

  getAuthTransactionRepository(): IAuthTransactionRepository {
    return new DrizzleAuthTransactionRepository((this.tx || this.db) as any);
  }

  getAuthenticationRepository(): IAuthenticationRepository {
    return new DrizzleAuthenticationRepositoryAdapter(this.tx as any);
  }

  getWeb3Repository(): IWeb3Repository {
    return new DrizzleWeb3RepositoryAdapter(this.tx as any);
  }

  getSessionRepository(): ISessionRepository {
    return new DrizzleSessionRepository(this.tx as any);
  }

  getCivilIdentityRepository(): ICivilIdentityRepository {
    return new DrizzleCivilIdentityRepositoryAdapter(this.tx as any);
  }

  getSsiRepository(): ISsiRepository {
    return new DrizzleSsiRepository(this.tx as any);
  }

  getOutboxRepository(): IOutboxRepository {
    return new DrizzleOutboxRepository(this.tx as any);
  }

  getPasswordResetRepository(): IPasswordResetRepository {
    return new DrizzlePasswordResetRepository(this.tx as any);
  }

  getFinanceRepository(): IFinanceRepository {
    return new DrizzleFinanceRepository((this.tx || this.db) as any);
  }

  getPostingSession(): PostingSession {
    if (!this._postingSession) {
      if (!this.postingCapabilityToken) {
        throw new Error('PostingCapabilityToken não disponível nesta fábrica transacional.');
      }
      const isD1 = isD1Database(this.db || this.tx);
      const mode = isD1 ? 'd1-batch' : 'sqlite-transaction';
      const sessionId = `ps_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      this._postingSession = PostingSession.createAuthorizedSession(this.postingCapabilityToken, mode, sessionId);
    }
    return this._postingSession;
  }

  getPostingExecutor(): IPostingExecutor {
    if (!this._postingExecutor) {
      this._postingExecutor = new D1AtomicPostingExecutor(this.tx || this.db);
    }
    return this._postingExecutor;
  }
}


export class DrizzleUnitOfWork implements IUnitOfWork {
  constructor(private readonly db: FinanceDatabase) {}

  async execute<T>(work: (factory: IRepositoryFactory) => Promise<Result<T>>): Promise<Result<T>> {
    if (typeof this.db?.transaction === 'function') {
      let result: Result<T> | null = null;
      try {
        await (this.db as any).transaction(
          async (tx: FinanceTransaction) => {
            const factory = new DrizzleRepositoryFactory(tx, this.db, PostingCapabilityToken);
            result = await work(factory);

            if (result && result.isFailure) {
              if (typeof (tx as any).rollback === 'function') {
                await Promise.resolve((tx as any).rollback()).catch(() => {});
              }
              throw new Error('ROLLBACK_TRIGGERED_BY_RESULT_FAIL');
            }
          },
          { behavior: 'immediate' }
        );
        if (result) return result;
        return Result.fail('Transação concluída sem resultado retornado pelo callback.');
      } catch (err: any) {
        // Se o erro foi gerado intencionalmente por result.isFailure, devolve o Result.fail original
        const resVal = result as (Result<T> | null);
        if (resVal && resVal.isFailure) {
          return resVal;
        }
        if (err?.message === 'ROLLBACK_TRIGGERED_BY_RESULT_FAIL' && resVal && resVal.isFailure) {
          return resVal;
        }
        if (err instanceof FinancialError) {
          return Result.fail(err);
        }
        const errorMessage = err?.message || String(err);
        // Se a callback retornou Result.ok(), mas o COMMIT/banco falhou, DEVE RETORNAR FALHA! (DOD-05)
        return Result.fail(`Falha na transação do banco de dados (Commit/Execution): ${errorMessage}`);
      }
    }

    if (isD1Database(this.db)) {
      throw new Error(
        'DrizzleUnitOfWork exige driver com transações interativas (BEGIN IMMEDIATE). O driver Cloudflare D1 não suporta transações interativas — utilize o D1AtomicPostingExecutor para lotes contábeis atômicos.'
      );
    }

    // BLOCKER FIX: If there is no transaction support, we must FAIL immediately,
    // not fallback to a non-transactional execution.
    throw new Error('Driver de banco de dados atual não suporta transações atômicas (db.transaction is not a function). Operação abortada por segurança.');
  }
}


```


---

<a id="src_infrastructure_repositories_DrizzleFinanceRepository_ts"></a>
## 2. `src/infrastructure/repositories/DrizzleFinanceRepository.ts`

- **Caminho absoluto**: `/home/sandro/Área de trabalho/BackEnd/src/infrastructure/repositories/DrizzleFinanceRepository.ts`
- **Total de linhas**: 1549
- **O que precisa ser fechado**: Persistência completa de todas as mutations + propagação de actor_user_id, authorized_by_user_id, source_type, correlation_id

```typescript
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
  async failIdempotency(key: string, scope: string, failureCode?: string): Promise<void> {
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
  }

  async releaseIdempotencyClaim(key: string, scope: string): Promise<void> {
    await this.executor
      .delete(idempotencyKeys)
      .where(
        and(
          eq(idempotencyKeys.key, key),
          eq(idempotencyKeys.scope, scope),
          eq(idempotencyKeys.status, 'processing')
        )
      );
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
          eq(accountBalances.version, currentVersion)
        )
      );

    const affected = res?.meta?.changes ?? res?.rowsAffected ?? 0;
    return affected > 0 ? 'UPDATED' : 'OCC_CONFLICT';
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
```


---

<a id="src_application_finance_use-cases_RecordTransferUseCase_ts"></a>
## 3. `src/application/finance/use-cases/RecordTransferUseCase.ts`

- **Caminho absoluto**: `/home/sandro/Área de trabalho/BackEnd/src/application/finance/use-cases/RecordTransferUseCase.ts`
- **Total de linhas**: 149
- **O que precisa ser fechado**: Isolamento de custódia, ownership, limites de origem/destino, autorização e bloqueio de P2P indevido

```typescript
import { IUnitOfWork } from '../../ports/output/IUnitOfWork';
import { Result } from '../../../shared/kernel/Result';
import { LedgerTransaction, LedgerEntry } from '../../../domains/finance/entities/LedgerTransaction';
import { Money256 } from '../../../domains/finance/value-objects/Money256';
import { AccountingEntryPolicy } from '../../../domains/finance/policies/AccountingEntryPolicy';
import { FinancialTransactionOrchestrator, OrchestratorResult } from '../services/FinancialTransactionOrchestrator';
import { CanonicalRequestHashService } from '../services/CanonicalRequestHashService';
import {
  CustodyAuthorizationPolicy,
  AuthorizationContext,
  CustodyOperationSpec,
} from '../../../domains/finance/contracts/AuthorizationContext';

export interface TransferCommand {
  sourceUserId: number;
  destinationUserId: number;
  amountBaseUnits: string;
  assetId: number;
  description: string;
  idempotencyKey: string;
  requestHash?: string;
  // Forensic & Authorization fields (Gate 4 & Gate 10)
  authenticatedUserId?: number;
  actorUserId?: number;
  authorizedByUserId?: number;
  capabilities?: string[];
  roles?: string[];
  delegatedForUserId?: number | null;
  sourceType?: string;
  sourceId?: string;
  correlationId?: string;
  scope?: string;
}

export class RecordTransferUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(command: TransferCommand): Promise<Result<OrchestratorResult>> {
    try {
      if (command.sourceUserId === command.destinationUserId) {
        return Result.fail('Transferência exige usuários de origem e destino distintos.');
      }

      const amount = Money256.fromString(command.amountBaseUnits, command.assetId);

      return await this.uow.execute(async (factory) => {
        const repo = factory.getFinanceRepository();

        const sourceAccRes = await repo.getOrCreateUserAccount(command.sourceUserId);
        if (sourceAccRes.isFailure) throw new Error(sourceAccRes.error || 'Conta de origem não encontrada');

        const destAccRes = await repo.getOrCreateUserAccount(command.destinationUserId);
        if (destAccRes.isFailure) throw new Error(destAccRes.error || 'Conta de destino não encontrada');

        const sourceAcc = sourceAccRes.getValue();
        if (sourceAcc.status !== 'active') {
          throw new Error('Conta de origem está inativa ou suspensa.');
        }

        const destAcc = destAccRes.getValue();
        if (destAcc.status !== 'active') {
          throw new Error('Conta de destino está inativa ou suspensa.');
        }

        const sourceAccountId = sourceAcc.id;
        const destinationAccountId = destAcc.id;

        if (sourceAccountId === destinationAccountId) {
          throw new Error('Auto-transferência para a mesma conta é proibida.');
        }

        // 1. Custody & Authorization Gate (Gate 4)
        const principalId = command.actorUserId ?? command.authenticatedUserId ?? command.sourceUserId;
        const authCtx: AuthorizationContext = {
          principalId,
          principalType: 'user',
          capabilities: command.capabilities ?? (command.roles?.includes('admin') ? ['admin', 'finance.custody.debit'] : []),
          delegatedForUserId: command.delegatedForUserId ?? null,
          correlationId: command.correlationId ?? `corr_tx_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
        };

        const opSpec: CustodyOperationSpec = {
          operationType: 'transfer',
          sourceAccountId,
          sourceAccountOwnerId: sourceAcc.userId,
          destinationAccountId,
          destinationAccountOwnerId: destAcc.userId,
          assetId: command.assetId,
          amountBaseUnits: amount.amount,
        };

        const authDecision = CustodyAuthorizationPolicy.canDebitSourceAccount(authCtx, opSpec);
        if (!authDecision.allowed) {
          throw new Error(`403 Forbidden: Autorização de custódia negada: ${authDecision.reason}`);
        }

        // 2. Accounting Leg Generation
        const rawEntries = AccountingEntryPolicy.createTransferEntries({
          sourceAccountId,
          destinationAccountId,
          amount,
          description: command.description,
        });

        const ledgerEntries: LedgerEntry[] = rawEntries.map(
          (r) =>
            new LedgerEntry({
              accountId: String(r.accountId),
              amount: r.amount,
              type: r.entryType,
              description: r.description,
            })
        );

        // 3. Deterministic Idempotency & Forensic Lineage (Gate 8 & Gate 10)
        const scope = command.scope ?? 'finance';

        const transaction = LedgerTransaction.create({
          idempotencyKey: command.idempotencyKey,
          description: command.description,
          entries: ledgerEntries,
          transactionType: 'transfer',
          category: 'operational',
          userId: command.sourceUserId,
          actorUserId: authDecision.actorUserId,
          authorizedByUserId: authDecision.authorizedByUserId,
          sourceType: (command.sourceType as any) ?? null,
          sourceId: command.sourceId ?? String(sourceAccountId),
          correlationId: authCtx.correlationId,
          scope,
        });

        if (command.requestHash !== undefined) {
          const canonicalHash = CanonicalRequestHashService.calculateHash(transaction);
          if (command.requestHash !== canonicalHash) {
            throw new Error('409 Conflict: O requestHash fornecido não coincide com o hash canônico do payload de transferência.');
          }
        }

        const orchestrator = new FinancialTransactionOrchestrator(repo, factory.getOutboxRepository());
        const orchestratorResult = await orchestrator.executePosting(transaction);
        return Result.ok(orchestratorResult);
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Falha ao realizar transferência.';
      return Result.fail(message);
    }
  }
}

```


---

<a id="src_application_finance_services_FinancialTransactionOrchestrator_ts"></a>
## 4. `src/application/finance/services/FinancialTransactionOrchestrator.ts`

- **Caminho absoluto**: `/home/sandro/Área de trabalho/BackEnd/src/application/finance/services/FinancialTransactionOrchestrator.ts`
- **Total de linhas**: 354
- **O que precisa ser fechado**: Fechamento da cadeia inteira: idempotência → domínio → OCC → ledger → balance → outbox → auditoria

```typescript
import { IFinanceRepository } from '../../ports/output/IFinanceRepository';
import { IOutboxRepository } from '../../ports/output/IOutboxRepository';
import { IDomainEvent, LedgerTransactionPostedEvent } from '../../../shared/kernel/DomainEvent';
import { LedgerTransaction } from '../../../domains/finance/entities/LedgerTransaction';
import {
  IdempotencyConflictError,
  IdempotencyInProgressError,
  OptimisticConcurrencyError,
  InsufficientBalanceError,
  InvalidLedgerTransactionError,
  InvalidStateTransitionError,
} from '../../../domains/finance/errors/FinancialError';
import { LedgerImbalanceError } from '../../../domains/finance/errors/LedgerImbalanceError';
import { CanonicalRequestHashService } from './CanonicalRequestHashService';
import { AccountStatusPolicy } from '../../../domains/finance/policies/AccountStatusPolicy';
import { AssetStatusPolicy } from '../../../domains/finance/policies/AssetStatusPolicy';
import { AccountClassPolicy } from '../../../domains/finance/policies/AccountClassPolicy';
import { FinancialTransactionStateMachine } from '../../../domains/finance/services/FinancialTransactionStateMachine';
import { parsePositiveSafeIntegerId } from '../../../domains/finance/value-objects/Money256';

export interface OrchestratorResult {
  transactionId: number;
  isReplayed: boolean;
}

function assertNever(value: never): never {
  throw new Error(`Unhandled BalanceUpdateResult case: ${value}`);
}

export class FinancialTransactionOrchestrator {
  /**
   * O Orchestrator exige um repositório transacional vinculado ao Unit of Work (BEGIN IMMEDIATE).
   * Ele atua como a Autoridade Física Central de escrita no ledger financeiro.
   *
   * Todas as etapas de persistência (Claim Idempotency, Insert Transaction, Insert Entries, OCC Balance Updates,
   * Outbox Event e Complete Idempotency) ocorrem obrigatoriamente dentro do mesmo boundary transacional do banco.
   */
  constructor(
    private readonly financeRepo: IFinanceRepository,
    private readonly outboxRepo: IOutboxRepository
  ) {
    if (!outboxRepo) {
      throw new Error('IOutboxRepository é obrigatório para execução atômica no FinancialTransactionOrchestrator.');
    }
  }

  /**
   * Valida rigorosamente o invariante FIN-001 de partidas dobradas antes da persistência:
   * Para cada ativo: SUM(débitos) === SUM(créditos)
   */
  private validateDoubleEntry(transaction: LedgerTransaction): void {
    const assetBalances = new Map<number, bigint>();

    for (const entry of transaction.entries) {
      const assetId = entry.amount.assetId;
      const current = assetBalances.get(assetId) ?? 0n;
      const delta = entry.type === 'debit' ? entry.amount.amount : -entry.amount.amount;
      assetBalances.set(assetId, current + delta);
    }

    for (const [assetId, netBalance] of assetBalances.entries()) {
      if (netBalance !== 0n) {
        throw new LedgerImbalanceError(
          `Desbalanceamento contábil no ativo #${assetId}: soma dos débitos difere dos créditos (diferença: ${netBalance.toString()}).`
        );
      }
    }
  }

  /**
   * Pré-validação obrigatória de todas as entidades participantes (contas e ativos).
   * Executada ANTES da reivindicação de idempotência e de qualquer escrita no banco de dados.
   *
   * Garante que:
   * 1. Todos os ativos únicos existem e estão 'active' (AssetStatusPolicy).
   * 2. Todas as contas únicas existem e estão 'active' (AccountStatusPolicy).
   * 3. Todas as contas possuem classificação contábil compatível com seu tipo (AccountClassPolicy).
   *
   * Como é executada sobre o conjunto de IDs únicos da transação, elimina a brecha
   * do delta zero (onde debitSum === creditSum fazia o OCC pular a validação da conta).
   */
  private async preValidateEntities(transaction: LedgerTransaction): Promise<void> {
    const accountIds = new Set<number>();
    const assetIds = new Set<number>();

    for (const entry of transaction.entries) {
      const parsedAccId = parsePositiveSafeIntegerId(entry.accountId, 'entry.accountId');
      accountIds.add(parsedAccId);
      assetIds.add(entry.amount.assetId);
    }

    // 1. Validar todos os ativos participantes
    for (const assetId of assetIds) {
      const assetRes = await this.financeRepo.getAssetById(assetId);
      if (assetRes.isFailure) {
        throw new Error(
          assetRes.error || `Ativo financeiro #${assetId} não encontrado.`
        );
      }
      const asset = assetRes.getValue();
      AssetStatusPolicy.validateActive({
        id: asset.id,
        status: asset.status,
        code: asset.code,
      });
    }

    // 2. Validar todas as contas participantes
    for (const accountId of accountIds) {
      const accountRes = await this.financeRepo.getAccountById(accountId);
      if (accountRes.isFailure) {
        throw new Error(
          accountRes.error || `Conta financeira #${accountId} não encontrada.`
        );
      }
      const account = accountRes.getValue();

      // Validação de status operacional: pode movimentar?
      AccountStatusPolicy.validateActive({
        id: account.id,
        status: account.status,
        name: account.name,
      });

      // Validação de classe contábil: classificação compatível?
      if (account.accountClass) {
        AccountClassPolicy.validate(account.accountType, account.accountClass);
      }
    }
  }

  /**
   * Executa o fluxo atômico de escrita no ledger:
   * 0. Validação estrita do invariante do Ledger (mínimo 2 lançamentos, ao menos 1 débito e 1 crédito, e balanço nulo).
   * 1. PRE-POSTING GATE: Pré-validação de todas as contas e ativos participantes (elimina bypass de delta-zero).
   * 2. Validação da transição de estado da transação: pending -> processing via State Machine.
   * 3. Cálculo do Hash Canônico do payload financeiro.
   * 4. Reclamação atômica de Idempotência.
   * 5. Inserção do registro da transação financeira em 'processing'.
   * 6. Inserção dos lançamentos contábeis imutáveis.
   * 7. Atualização dos saldos materializados via OCC com ordenação determinística por (accountId, assetId).
   * 8. Transição de status para 'completed' via State Machine.
   * 9. Registro de evento no Outbox.
   * 10. Conclusão da Idempotência.
   */
  public async executePosting(
    transaction: LedgerTransaction,
    requestHashOverride?: string
  ): Promise<OrchestratorResult> {
    // Invariante FIN-001: Validação do número mínimo de lançamentos
    if (!transaction.entries || transaction.entries.length < 2) {
      throw new InvalidLedgerTransactionError(
        'Invariante do Ledger violado: Uma transação financeira deve conter no mínimo 2 lançamentos contábeis.'
      );
    }

    const hasDebit = transaction.entries.some((e) => e.type === 'debit');
    const hasCredit = transaction.entries.some((e) => e.type === 'credit');
    if (!hasDebit || !hasCredit) {
      throw new InvalidLedgerTransactionError(
        'Invariante do Ledger violado: Uma transação financeira exige no mínimo 1 lançamento de débito e 1 de crédito.'
      );
    }

    // Invariante: Todas as quantias de lançamentos contábeis devem ser estritamente maiores que zero (> 0)
    for (const entry of transaction.entries) {
      if (entry.amount.amount <= 0n) {
        throw new InvalidLedgerTransactionError(
          `Invariante do Ledger violado: Quantia de lançamento contábil inválida (${entry.amount.amount.toString()}). O valor deve ser estritamente positivo.`
        );
      }
    }

    this.validateDoubleEntry(transaction);

    // 1. Hash canônico calculado pelo servidor (ou override fornecido para testes)
    const computedHash = requestHashOverride || CanonicalRequestHashService.calculateHash(transaction);

    const scope = transaction.scope || 'finance';

    // 2. Reivindicação atômica de idempotência antes de qualquer I/O de validação mutável
    const claimed = await this.financeRepo.claimIdempotency(
      transaction.idempotencyKey,
      transaction.userId,
      scope,
      computedHash
    );

    if (!claimed) {
      const existing = await this.financeRepo.getIdempotencyRecord(transaction.idempotencyKey, scope);
      if (!existing) {
        throw new IdempotencyInProgressError('Conflito de concorrência ao verificar chave de idempotência.');
      }

      if (existing.requestHash === computedHash) {
        if (existing.status === 'completed' && existing.transactionId) {
          // Replay determinístico imediato: zero chamadas a entidades mutáveis ou checagens de saldo
          return { transactionId: existing.transactionId, isReplayed: true };
        }
        throw new IdempotencyInProgressError();
      } else {
        throw new IdempotencyConflictError();
      }
    }

    // 3. PRE-POSTING GATE: Pré-validação obrigatória de entidades (executa apenas para transações novas)
    await this.preValidateEntities(transaction);

    // 4. State Machine: validação da transição inicial para 'processing'
    const processingTransition = FinancialTransactionStateMachine.transition(
      transaction.status,
      'processing'
    );
    if (processingTransition.isFailure) {
      throw new InvalidStateTransitionError(
        processingTransition.error || 'Transição de estado para processing inválida.'
      );
    }
    const processingStatus = processingTransition.getValue();

    // 5. Inserção do registro pai da transação com o status derivado da State Machine
    const txResult = await this.financeRepo.insertTransaction({
      userId: transaction.userId ?? null,
      actorUserId: transaction.actorUserId ?? transaction.userId ?? null,
      authorizedByUserId: transaction.authorizedByUserId ?? null,
      type: transaction.transactionType ?? 'adjustment',
      category: transaction.category || 'operational',
      description: transaction.description,
      status: processingStatus,
      reversalOfTransactionId: transaction.reversalOfTransactionId,
      refundOfTransactionId: transaction.refundOfTransactionId,
      sourceType: transaction.sourceType ?? null,
      sourceId: transaction.sourceId ?? null,
      correlationId: transaction.correlationId ?? null,
    });
    if (txResult.isFailure) {
      throw new Error(txResult.typedError?.message || txResult.error || 'Falha ao inserir registro de transação financeira.');
    }
    const transactionId = txResult.getValue();

    // 6. Inserção dos lançamentos contábeis imutáveis
    const entriesResult = await this.financeRepo.insertLedgerEntries(transaction.entries, transactionId);
    if (entriesResult.isFailure) {
      throw new Error(entriesResult.typedError?.message || entriesResult.error || 'Falha ao inserir lançamentos contábeis.');
    }

    // 7. Consolidação e agregação de saldos por (accountId, assetId) para evitar falhas de saldo intermediário (intra-transaction) e otimizar I/O.
    interface AccountAssetKey {
      accountId: string;
      assetId: number;
      debitSum: bigint;
      creditSum: bigint;
    }

    const aggregatedMap = new Map<string, AccountAssetKey>();

    for (const entry of transaction.entries) {
      const key = `${entry.accountId}:${entry.amount.assetId}`;
      const existing = aggregatedMap.get(key) || {
        accountId: entry.accountId,
        assetId: entry.amount.assetId,
        debitSum: 0n,
        creditSum: 0n,
      };

      if (entry.type === 'debit') {
        existing.debitSum += entry.amount.amount;
      } else {
        existing.creditSum += entry.amount.amount;
      }
      aggregatedMap.set(key, existing);
    }

    // Ordenação determinística de execução por (accountId, assetId) para prevenção de lock contention / deadlock em operações concorrentes.
    const sortedDeltas = Array.from(aggregatedMap.values()).sort((a, b) => {
      if (a.accountId !== b.accountId) {
        return a.accountId < b.accountId ? -1 : 1;
      }
      return a.assetId < b.assetId ? -1 : a.assetId > b.assetId ? 1 : 0;
    });

    // 8. Execução do OCC de saldos apenas para deltas líquidos não-nulos (contas já pré-validadas na etapa 1)
    for (const delta of sortedDeltas) {
      if (delta.debitSum === delta.creditSum) {
        continue; // Débitos e créditos idênticos na mesma conta cancelam-se com variação nula de saldo
      }

      const isNetDebit = delta.debitSum > delta.creditSum;
      const netAmount = isNetDebit
        ? delta.debitSum - delta.creditSum
        : delta.creditSum - delta.debitSum;
      const netType: 'debit' | 'credit' = isNetDebit ? 'debit' : 'credit';

      const updateResult = await this.financeRepo.updateBalanceWithOCC(
        delta.accountId,
        delta.assetId,
        netAmount,
        netType
      );

      switch (updateResult) {
        case 'UPDATED':
          break;
        case 'INSUFFICIENT_BALANCE':
          throw new InsufficientBalanceError(
            `saldo insuficiente para a conta #${delta.accountId} e ativo #${delta.assetId}.`
          );
        case 'OCC_CONFLICT':
          throw new OptimisticConcurrencyError(
            `Falha de concorrência otimista (OCC version mismatch) para a conta #${delta.accountId}.`
          );
        default:
          assertNever(updateResult);
      }
    }

    // 9. State Machine: validação da transição para 'completed'
    const completedTransition = FinancialTransactionStateMachine.transition(
      processingStatus,
      'completed'
    );
    if (completedTransition.isFailure) {
      throw new InvalidStateTransitionError(
        completedTransition.error || 'Transição de estado para completed inválida.'
      );
    }
    const completedStatus = completedTransition.getValue();

    // 10. Atualização do status da transação para 'completed'
    await this.financeRepo.updateTransactionStatus(transactionId, completedStatus);

    // 11. Persistência de Evento no Outbox (atomicidade estrita: falha no outbox aborta e faz rollback)
    const event = new LedgerTransactionPostedEvent(
      transactionId,
      transaction.idempotencyKey,
      computedHash,
      new Date()
    );
    const outboxResult = await this.outboxRepo.saveEvent(
      event,
      transactionId,
      'LedgerTransaction',
      1
    );
    if (outboxResult.isFailure) {
      throw new Error(`Falha ao persistir evento no outbox: ${String(outboxResult.error)}`);
    }

    // 12. Conclusão do registro de Idempotência
    await this.financeRepo.completeIdempotency(transaction.idempotencyKey, scope, transactionId);

    return { transactionId, isReplayed: false };
  }
}

```


---

<a id="src_infrastructure_services_EventInboxService_ts"></a>
## 5. `src/infrastructure/services/EventInboxService.ts`

- **Caminho absoluto**: `/home/sandro/Área de trabalho/BackEnd/src/infrastructure/services/EventInboxService.ts`
- **Total de linhas**: 187
- **O que precisa ser fechado**: Crash/retry/lease expiry; garantir consumidor idempotente e transição de estado segura

```typescript
import { Result } from '../../shared/kernel/Result';
import { eventInbox } from '../../db/infrastructure/tables';
import { eq, and, sql, lt } from 'drizzle-orm';
import { CanonicalRequestHashService } from '../../application/finance/services/CanonicalRequestHashService';
import { ExternalEventPayloadConflictError } from '../../domains/finance/errors/FinancialError';
import { isUniqueConstraintViolation } from '../repositories/DrizzleFinanceRepository';

export interface RecordWebhookEventInput {
  eventId: string;
  providerId: number;
  eventType?: string;
  externalEventId: string;
  payload: Record<string, any>;
  workerId?: string;
  leaseDurationMs?: number;
}

export class EventInboxService {
  /**
   * P0: Event Inbox com claim condicional SQL atômico, leaseGeneration e verificação de payloadHash (FIN-014, FIN-015, FIN-021).
   */
  async processEventOnce<T>(
    db: any,
    input: RecordWebhookEventInput,
    handler: () => Promise<Result<T>>
  ): Promise<Result<{ isDuplicate: boolean; result?: T }>> {
    const workerId = input.workerId || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `worker-${Math.random().toString(36).substring(2)}`);
    const leaseDurationMs = input.leaseDurationMs || 30000; // 30s
    let computedPayloadHash: string;
    try {
      computedPayloadHash = CanonicalRequestHashService.calculateHash(input.payload);
    } catch (e: any) {
      return Result.fail(`Payload inválido para canonicalização: ${e.message}`);
    }
    const serializedPayload = JSON.stringify(input.payload);
    const now = new Date();
    const leaseExpiresAt = new Date(now.getTime() + leaseDurationMs);

    let activeLeaseGeneration = 1;

    try {
      // 1. Verificar registro existente
      const [existing] = await db
        .select()
        .from(eventInbox)
        .where(
          and(
            eq(eventInbox.providerId, input.providerId),
            eq(eventInbox.externalEventId, input.externalEventId)
          )
        )
        .limit(1);

      if (existing) {
        // Validação FIN-014: Mesma id de evento com payload divergente
        if (existing.payloadHash && existing.payloadHash !== computedPayloadHash) {
          throw new ExternalEventPayloadConflictError(
            `Conflito de integridade: Evento #${input.externalEventId} do provider #${input.providerId} recebido com payload divergente.`
          );
        }

        if (existing.status === 'processed') {
          return Result.ok({ isDuplicate: true });
        }

        // Se estiver em processing com lease válido mantido por OUTRO worker -> aguardar/rejeitar
        if (
          existing.status === 'processing' &&
          existing.leaseExpiresAt &&
          new Date(existing.leaseExpiresAt) > now &&
          existing.leaseOwner !== workerId
        ) {
          return Result.ok({ isDuplicate: true });
        }

        // Claim atômico condicional de lease
        activeLeaseGeneration = (existing.leaseGeneration || 0) + 1;

        const nowSec = Math.floor(now.getTime() / 1000);
        const updateRes = await db
          .update(eventInbox)
          .set({
            status: 'processing',
            leaseOwner: workerId,
            leaseGeneration: activeLeaseGeneration,
            leaseExpiresAt,
            processingStartedAt: now,
            attempts: sql`${eventInbox.attempts} + 1`,
          })
          .where(
            and(
              eq(eventInbox.id, existing.id),
              sql`(${eventInbox.status} = 'pending' OR ${eventInbox.status} = 'failed' OR ${eventInbox.leaseExpiresAt} < ${nowSec} OR ${eventInbox.leaseOwner} = ${workerId})`
            )
          );

        const affected = (updateRes?.meta?.changes ?? updateRes?.rowsAffected ?? 0);
        if (affected === 0) {
          // Outro worker obteve o lease concorrentemente
          return Result.ok({ isDuplicate: true });
        }
      } else {
        // Inserir registro inicial como 'processing'
        await db.insert(eventInbox).values({
          id: input.eventId,
          providerId: input.providerId,
          eventType: input.eventType || 'generic',
          externalEventId: input.externalEventId,
          payload: serializedPayload,
          payloadHash: computedPayloadHash,
          status: 'processing',
          leaseOwner: workerId,
          leaseGeneration: 1,
          leaseExpiresAt,
          attempts: 1,
          processingStartedAt: now,
          createdAt: now,
        });
        activeLeaseGeneration = 1;
      }
    } catch (err: any) {
      if (err instanceof ExternalEventPayloadConflictError) {
        return Result.fail(err.message);
      }
      if (isUniqueConstraintViolation(err)) {
        return Result.ok({ isDuplicate: true });
      }
      return Result.fail(`Erro ao gerenciar inbox de eventos: ${err.message}`);
    }

    // 2. Executar Handler de Negócio
    let handlerResult: Result<T>;
    try {
      handlerResult = await handler();
    } catch (handlerErr: any) {
      handlerResult = Result.fail(handlerErr.message || 'Erro inesperado no handler do evento.');
    }

    if (handlerResult.isFailure) {
      // Marcar como failed no inbox condicionado ao leaseGeneration
      await db
        .update(eventInbox)
        .set({
          status: 'failed',
          lastError: handlerResult.error,
          leaseOwner: null,
          leaseExpiresAt: null,
        })
        .where(
          and(
            eq(eventInbox.providerId, input.providerId),
            eq(eventInbox.externalEventId, input.externalEventId),
            eq(eventInbox.leaseOwner, workerId),
            eq(eventInbox.leaseGeneration, activeLeaseGeneration)
          )
        );

      return Result.fail(`Falha ao processar evento externo: ${handlerResult.error}`);
    }

    // 3. Atualizar status para 'processed' APÓS sucesso total (FIN-021: Condicionado a leaseOwner e leaseGeneration)
    const finalUpdateRes = await db
      .update(eventInbox)
      .set({
        status: 'processed',
        processedAt: new Date(),
        leaseOwner: null,
        leaseExpiresAt: null,
      })
      .where(
        and(
          eq(eventInbox.providerId, input.providerId),
          eq(eventInbox.externalEventId, input.externalEventId),
          eq(eventInbox.leaseOwner, workerId),
          eq(eventInbox.leaseGeneration, activeLeaseGeneration)
        )
      );

    const finalAffected = (finalUpdateRes?.meta?.changes ?? finalUpdateRes?.rowsAffected ?? 0);
    if (finalAffected === 0) {
      // Worker expirou e perdeu o lease durante a execução do handler
      return Result.fail('Stale Worker Error: O lease do worker expirou antes da conclusão do evento (FIN-021).');
    }

    return Result.ok({ isDuplicate: false, result: handlerResult.getValue() });
  }
}

```


---

<a id="src_infrastructure_services_FinanceBootstrapService_ts"></a>
## 6. `src/infrastructure/services/FinanceBootstrapService.ts`

- **Caminho absoluto**: `/home/sandro/Área de trabalho/BackEnd/src/infrastructure/services/FinanceBootstrapService.ts`
- **Total de linhas**: 75
- **O que precisa ser fechado**: Garantir que bootstrap nunca inicialize/altere produção indevidamente e seja explicitamente condicionado ao ambiente

```typescript
import { IUnitOfWork } from '../../application/ports/output/IUnitOfWork';
import { Result } from '../../shared/kernel/Result';
import { LedgerTransaction, LedgerEntry } from '../../domains/finance/entities/LedgerTransaction';
import { Money256 } from '../../domains/finance/value-objects/Money256';
import { FinancialTransactionOrchestrator } from '../../application/finance/services/FinancialTransactionOrchestrator';
import {
  TreasuryBootstrapOptions,
  TreasuryBootstrapResult,
} from '../../application/ports/output/IFinanceRepository';

export type { TreasuryBootstrapOptions, TreasuryBootstrapResult };

export class FinanceBootstrapService {
  /**
   * Provisiona a infraestrutura básica de contas sistêmicas do Finance Core:
   * 1. Ativo Padrão (ex: BRL, USD, USDT)
   * 2. Contas Sistêmicas com userId = NULL (cumprindo ownerRuleCheck e FIN-019).
   * 3. Lançamento contábil de abertura atômico via FinancialTransactionOrchestrator.
   *
   * Todo o processo executa sob um único Unit of Work (uma única transação de escrita).
   */
  static async seedSystemAccounts(
    uow: IUnitOfWork,
    options: TreasuryBootstrapOptions = {}
  ): Promise<Result<TreasuryBootstrapResult>> {
    if (process.env.NODE_ENV === 'production' && !options.allowProductionBootstrap) {
      return Result.fail<TreasuryBootstrapResult>(
        'Bloqueio de Segurança: Bootstrap de contas sistêmicas em produção exige confirmação explícita (allowProductionBootstrap: true).'
      );
    }

    return uow.execute(async (factory) => {
      const financeRepo = factory.getFinanceRepository();
      const outboxRepo = factory.getOutboxRepository();

      // 1. Provisiona infraestrutura (ativo, contas sistêmicas e saldos zerados)
      const infraRes = await financeRepo.provisionTreasuryInfrastructure(options);
      if (infraRes.isFailure) {
        return Result.fail<TreasuryBootstrapResult>(
          infraRes.errorObject || infraRes.error || 'Falha ao provisionar infraestrutura contábil sistêmica.'
        );
      }
      const infra = infraRes.getValue();

      // 2. Se houver saldo inicial especificado (> 0n), executa lançamento contábil via Orchestrator
      const initialBalance = options.initialBalanceBaseUnits ?? 0n;
      if (initialBalance > 0n) {
        const openingTransaction = LedgerTransaction.create({
          idempotencyKey: `finance:bootstrap:opening-balance:${infra.treasuryAccountId}:${infra.assetId}`,
          description: 'Genesis Opening Balance Equity Allocation',
          transactionType: 'adjustment',
          businessReason: 'genesis_opening_balance',
          category: 'operational',
          entries: [
            new LedgerEntry({
              accountId: String(infra.treasuryAccountId),
              amount: Money256.fromBigInt(initialBalance, infra.assetId),
              type: 'debit',
            }),
            new LedgerEntry({
              accountId: String(infra.openingEquityAccountId),
              amount: Money256.fromBigInt(initialBalance, infra.assetId),
              type: 'credit',
            }),
          ],
        });

        const orchestrator = new FinancialTransactionOrchestrator(financeRepo, outboxRepo);
        await orchestrator.executePosting(openingTransaction);
      }

      return Result.ok<TreasuryBootstrapResult>(infra);
    });
  }
}

```


---

<a id="migrations_0011_treasury_singleton_and_forensic_audit_sql"></a>
## 7. `migrations/0011_treasury_singleton_and_forensic_audit.sql`

- **Caminho absoluto**: `/home/sandro/Área de trabalho/BackEnd/migrations/0011_treasury_singleton_and_forensic_audit.sql`
- **Total de linhas**: 20
- **O que precisa ser fechado**: Confirmar que o modelo físico da auditoria forense corresponde exatamente ao que o código grava

```sql
-- 0011_treasury_singleton_and_forensic_audit.sql
-- Forensic DDL Hardening: Treasury Active Singleton Invariant & Forensic Audit Lineage

-- 1. Forensic Deduplication of Active Treasury Accounts:
-- Retain the canonical active treasury (minimum ID) and deactivate any duplicates in an auditable way.
UPDATE financial_accounts
SET status = 'inactive',
    name = name || ' [MIGRATED_DUPLICATE_0011]',
    updated_at = unixepoch() * 1000
WHERE account_type = 'treasury'
  AND status = 'active'
  AND id > (SELECT MIN(id) FROM financial_accounts WHERE account_type = 'treasury' AND status = 'active');--> statement-breakpoint

-- 2. Restore active treasury singleton partial unique index (dropped in migration 0009)
CREATE UNIQUE INDEX IF NOT EXISTS uq_treasury_active_singleton
ON financial_accounts (account_type) WHERE account_type = 'treasury' AND status = 'active';--> statement-breakpoint

-- 3. Forensic Lineage & Audit Columns on financial_transactions
ALTER TABLE financial_transactions ADD COLUMN actor_user_id integer;--> statement-breakpoint
ALTER TABLE financial_transactions ADD COLUMN authorized_by_user_id integer;

```


---

<a id="migrations_0012_finance_p0_hardening_sql"></a>
## 8. `migrations/0012_finance_p0_hardening.sql`

- **Caminho absoluto**: `/home/sandro/Área de trabalho/BackEnd/migrations/0012_finance_p0_hardening.sql`
- **Total de linhas**: 42
- **O que precisa ser fechado**: [COMPANION P0] Enforce physical append-only triggers, leg ordinal, SQL assertion guard and system routes

```sql
-- 0012_finance_p0_hardening.sql
-- Finance Core P0 Hardening: Forensic Timestamps, Structural Leg Ordinal, SQL Assertions, System Routes & Ledger Immutability

-- 1. Forensic Timestamps on financial_transactions
ALTER TABLE financial_transactions ADD COLUMN reversed_at integer;--> statement-breakpoint
ALTER TABLE financial_transactions ADD COLUMN refunded_at integer;--> statement-breakpoint

-- 2. Structural Ledger Leg Ordinal (P1-14)
ALTER TABLE financial_ledger_entries ADD COLUMN entry_ordinal integer NOT NULL DEFAULT 0;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_ledger_entry_ordinal ON financial_ledger_entries (transaction_id, entry_ordinal);--> statement-breakpoint

-- 3. SQL Mutation-Count Assertion Guard Table (Gate 11 / PLAN-02)
CREATE TABLE IF NOT EXISTS _sql_assertions (
  id integer PRIMARY KEY CHECK (id = 1),
  guard integer NOT NULL CHECK (guard = 1)
);--> statement-breakpoint

-- 4. System Account Routes Table (Gate 13 / P1-10)
CREATE TABLE IF NOT EXISTS system_account_routes (
  id integer PRIMARY KEY AUTOINCREMENT,
  account_type text NOT NULL,
  provider_id integer REFERENCES fiat_providers(id) ON DELETE RESTRICT,
  account_id integer NOT NULL REFERENCES financial_accounts(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at integer NOT NULL DEFAULT (unixepoch())
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS uq_system_route_provider ON system_account_routes (account_type, provider_id) WHERE status = 'active' AND provider_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_system_route_global ON system_account_routes (account_type) WHERE status = 'active' AND provider_id IS NULL;--> statement-breakpoint

-- 5. Physical SQLite Append-Only Triggers for Ledger Entries (Gate 5)
CREATE TRIGGER IF NOT EXISTS trg_ledger_entries_no_update
BEFORE UPDATE ON financial_ledger_entries
BEGIN
  SELECT RAISE(ABORT, 'LEDGER_IS_APPEND_ONLY: Atualizações em lançamentos contábeis são proibidas.');
END;--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS trg_ledger_entries_no_delete
BEFORE DELETE ON financial_ledger_entries
BEGIN
  SELECT RAISE(ABORT, 'LEDGER_IS_APPEND_ONLY: Exclusões de lançamentos contábeis são proibidas.');
END;

```


---

<a id="src_db_finance_tables_ts"></a>
## 9. `src/db/finance/tables.ts`

- **Caminho absoluto**: `/home/sandro/Área de trabalho/BackEnd/src/db/finance/tables.ts`
- **Total de linhas**: 3586
- **O que precisa ser fechado**: Constraints definitivas, unicidade, FK, status, versões, valores, cardinalidade e proteção do ledger

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

    actorUserId: integer('actor_user_id').references(
      () => users.id,
      {
        onDelete: 'restrict',
      },
    ),

    authorizedByUserId: integer('authorized_by_user_id').references(
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

    reversedAt: integer('reversed_at', {
      mode: 'timestamp_ms',
    }),

    refundedAt: integer('refunded_at', {
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

    entryOrdinal: integer('entry_ordinal')
      .notNull()
      .default(0),

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

    uqLedgerEntryOrdinal: uniqueIndex(
      'uq_ledger_entry_ordinal',
    ).on(table.transactionId, table.entryOrdinal),

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

    providerId: integer('provider_id')
      .notNull()
      .references(() => fiatProviders.id, {
        onDelete: 'restrict',
      }),

    fiatAccountId: integer('fiat_account_id').references(
      () => fiatAccounts.id,
      {
        onDelete: 'restrict',
      },
    ),

    externalTransactionId: text('external_transaction_id').notNull(),

    rawAmount: text('raw_amount').notNull(),

    amountBaseUnits: text('amount_base_units'),

    direction: text('direction', {
      enum: ['credit', 'debit'],
    }).notNull(),

    assetId: integer('asset_id').references(
      () => financialAssets.id,
      {
        onDelete: 'restrict',
      },
    ),

    rawDescription: text('raw_description'),

    bankTimestamp: integer('bank_timestamp', {
      mode: 'timestamp_ms',
    }),

    documentNumber: text('document_number'),

    runningBalanceBaseUnits: text('running_balance_base_units'),

    sourceFile: text('source_file'),

    sourceFileHash: text('source_file_hash'),

    rowFingerprint: text('row_fingerprint'),

    rawPayload: text('raw_payload'),

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
    })
      .notNull()
      .default('pending'),

    reconciliationStatus: text('reconciliation_status', {
      enum: ['unmatched', 'matched', 'ignored', 'discrepancy'],
    })
      .notNull()
      .default('unmatched'),

    financialTransactionId: integer('financial_transaction_id').references(
      () => financialTransactions.id,
      {
        onDelete: 'restrict',
      },
    ),

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

    settledAt: integer('settled_at', {
      mode: 'timestamp_ms',
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

    fiatAccountIdx: index(
      'idx_fiat_external_transactions_fiat_account',
    ).on(table.fiatAccountId),

    statusIdx: index(
      'idx_fiat_external_transactions_status',
    ).on(table.status),

    reconStatusIdx: index(
      'idx_fiat_external_transactions_recon_status',
    ).on(table.reconciliationStatus),

    fingerprintUq: uniqueIndex(
      'uq_fiat_external_transactions_fingerprint',
    ).on(table.rowFingerprint),

    externalIdCheck: check(
      'ck_fiat_external_transaction_id_nonempty',
      sql`length(trim(${table.externalTransactionId})) > 0`,
    ),

    directionCheck: check(
      'ck_fiat_external_tx_direction',
      sql`${table.direction} IN ('credit', 'debit')`,
    ),

    reconciliationStatusCheck: check(
      'ck_fiat_external_tx_reconciliation_status',
      sql`${table.reconciliationStatus} IN ('unmatched', 'matched', 'ignored', 'discrepancy')`,
    ),

    statusCheck: check(
      'ck_fiat_external_tx_status',
      sql`${table.status} IN ('pending', 'processing', 'completed', 'failed', 'cancelled', 'reversed', 'unknown')`,
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

/* ============================================================================
 * 17. SQL ASSERTIONS & SYSTEM ACCOUNT ROUTES
 * ========================================================================== */

export const sqlAssertions = sqliteTable(
  '_sql_assertions',
  {
    id: integer('id').primaryKey(),
    guard: integer('guard').notNull(),
  },
  (table) => ({
    guardCheck: check('ck_sql_assertions_guard', sql`${table.guard} = 1`),
    idCheck: check('ck_sql_assertions_id', sql`${table.id} = 1`),
  })
);

export const systemAccountRoutes = sqliteTable(
  'system_account_routes',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    accountType: text('account_type').notNull(),
    providerId: integer('provider_id').references(() => fiatProviders.id, { onDelete: 'restrict' }),
    accountId: integer('account_id').notNull().references(() => financialAccounts.id, { onDelete: 'restrict' }),
    status: text('status', { enum: ['active', 'inactive'] }).notNull().default('active'),
    createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`).notNull(),
  },
  (table) => ({
    providerRouteUq: uniqueIndex('uq_system_route_provider')
      .on(table.accountType, table.providerId)
      .where(sql`${table.status} = 'active' AND ${table.providerId} IS NOT NULL`),
    globalRouteUq: uniqueIndex('uq_system_route_global')
      .on(table.accountType)
      .where(sql`${table.status} = 'active' AND ${table.providerId} IS NULL`),
  })
);

export type SystemAccountRoute = typeof systemAccountRoutes.$inferSelect;
export type NewSystemAccountRoute = typeof systemAccountRoutes.$inferInsert;


```


---

<a id="src_application_ports_output_IUnitOfWork_ts"></a>
## 10. `src/application/ports/output/IUnitOfWork.ts`

- **Caminho absoluto**: `/home/sandro/Área de trabalho/BackEnd/src/application/ports/output/IUnitOfWork.ts`
- **Total de linhas**: 31
- **O que precisa ser fechado**: Contrato da UoW precisa representar a semântica transacional real que a infraestrutura efetivamente consegue entregar

```typescript
import { Result } from '../../../shared/kernel/Result';
import { IUserRepository } from './IUserRepository';
import { IAuthenticationRepository } from './IAuthenticationRepository';
import { IWeb3Repository } from './IWeb3Repository';
import { ICivilIdentityRepository } from './ICivilIdentityRepository';
import { ISessionRepository } from './ISessionRepository';
import { IOutboxRepository } from './IOutboxRepository';
import { IPasswordResetRepository } from './IPasswordResetRepository';
import { ISsiRepository } from './ISsiRepository';
import { IFinanceRepository } from './IFinanceRepository';

export interface IRepositoryFactory {
  getUserRepository(): IUserRepository;
  getAuthTransactionRepository(): import('./IAuthTransactionRepository').IAuthTransactionRepository;
  getAuthenticationRepository(): IAuthenticationRepository;
  getWeb3Repository(): IWeb3Repository;
  getSessionRepository(): ISessionRepository;
  getCivilIdentityRepository(): ICivilIdentityRepository;
  getSsiRepository(): ISsiRepository;
  getOutboxRepository(): IOutboxRepository;
  getPasswordResetRepository(): IPasswordResetRepository;
  getFinanceRepository(): IFinanceRepository;
  getPostingSession(): import('../../../domains/finance/contracts/PostingSession').PostingSession;
  getPostingExecutor(): import('./IPostingExecutor').IPostingExecutor;
}


export interface IUnitOfWork {
  execute<T>(work: (factory: IRepositoryFactory) => Promise<Result<T>>): Promise<Result<T>>;
}


```


---

<a id="src_application_ports_output_IFinanceRepository_ts"></a>
## 11. `src/application/ports/output/IFinanceRepository.ts`

- **Caminho absoluto**: `/home/sandro/Área de trabalho/BackEnd/src/application/ports/output/IFinanceRepository.ts`
- **Total de linhas**: 215
- **O que precisa ser fechado**: Contrato precisa contemplar todas as mutations e metadados forenses exigidos

```typescript
import { Result } from '../../../shared/kernel/Result';
import { RepositoryError } from '../../../shared/kernel/RepositoryError';
import { LedgerEntry } from '../../../domains/finance/entities/LedgerTransaction';
import { FinancialLedgerEntryRecord } from '../../../domains/finance/contracts/FinancialLedgerEntryRecord';
import type { FinancialAccountClass } from '../../../domains/finance/policies/AccountClassPolicy';

export type SystemAccountType =
  | 'treasury'
  | 'operating'
  | 'reserve'
  | 'fees'
  | 'escrow'
  | 'reward_expense'
  | 'yield_expense'
  | 'clearing'
  | 'opening_balance_equity'
  | 'payment_revenue'
  | 'refund_expense';

export type FinancialTransactionType =
  | 'deposit'
  | 'withdrawal'
  | 'transfer'
  | 'payment'
  | 'refund'
  | 'fee'
  | 'reward'
  | 'yield'
  | 'conversion'
  | 'adjustment'
  | 'reversal';

export type FinancialTransactionStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'reversed'
  | 'refunded';

export type FinancialTransactionCategory =
  | 'membership'
  | 'rwa_yield'
  | 'grant'
  | 'operational'
  | 'payment'
  | 'trading'
  | 'withdrawal'
  | 'deposit'
  | 'fee'
  | 'other';

export type FinancialAccountStatus = 'active' | 'inactive' | 'suspended';
export type FinancialAssetStatus = 'active' | 'inactive' | 'suspended';

export type BalanceUpdateResult = 'UPDATED' | 'INSUFFICIENT_BALANCE' | 'OCC_CONFLICT';

export interface TreasuryBootstrapOptions {
  currencyCode?: string;
  initialBalanceBaseUnits?: bigint;
  allowProductionBootstrap?: boolean;
}

export interface TreasuryBootstrapResult {
  assetId: number;
  treasuryAccountId: number;
  operatingAccountId: number;
  feeAccountId: number;
  rewardExpenseAccountId: number;
  yieldExpenseAccountId: number;
  clearingAccountId: number;
  openingEquityAccountId: number;
  paymentRevenueAccountId: number;
  refundExpenseAccountId: number;
}

export type IdempotencyRecord =
  | { status: 'processing'; transactionId: null; requestHash: string }
  | { status: 'completed'; transactionId: number; requestHash: string }
  | { status: 'failed'; transactionId: null; requestHash: string };

export type IdempotencyClaimResult =
  | { status: 'CLAIMED' }
  | { status: 'COMPLETED'; transactionId: number; requestHash: string }
  | { status: 'PROCESSING'; requestHash: string }
  | { status: 'CONFLICT'; requestHash: string };

export interface LedgerTransactionCommittedEvent {
  transactionId: number;
  idempotencyKey: string;
  requestHash: string;
  [key: string]: unknown;
}

export interface FinancialAccountRecord {
  id: number;
  userId: number | null;
  accountType: SystemAccountType | 'user_available';
  accountClass: FinancialAccountClass;
  status: FinancialAccountStatus;
  name: string;
  version: number;
}

export interface AccountBalanceRecord {
  id: number;
  accountId: number;
  assetId: number;
  availableBaseUnits: string;
  lockedBaseUnits: string;
  version: number;
}

export interface FinancialTransactionRecord {
  id: number;
  userId: number | null;
  type: FinancialTransactionType;
  category: FinancialTransactionCategory;
  status: FinancialTransactionStatus;
  description: string;
  version: number;
  createdAt: Date;
  completedAt?: Date | null;
}

export interface IFinanceRepository {
  getAccountById(accountId: number): Promise<Result<FinancialAccountRecord>>;
  getUserAccount(userId: number): Promise<Result<FinancialAccountRecord>>;
  getAccountBalance(accountId: number, assetId: number): Promise<Result<AccountBalanceRecord>>;
  getTreasuryAccount(): Promise<Result<FinancialAccountRecord>>;
  getOrCreateUserAccount(userId: number): Promise<Result<FinancialAccountRecord>>;
  getOrCreateOperatingAccount(): Promise<Result<FinancialAccountRecord>>;
  getSystemAccount(accountType: SystemAccountType): Promise<Result<FinancialAccountRecord>>;
  resolveSystemAccount(accountType: SystemAccountType | string, providerId?: number | null): Promise<Result<FinancialAccountRecord>>;
  getTreasuryBalance(): Promise<Result<AccountBalanceRecord[]>>;
  getAssetById(assetId: number): Promise<Result<{ id: number; code: string; status: FinancialAssetStatus }>>;

  getTransactionById(transactionId: number): Promise<Result<FinancialTransactionRecord>>;
  getRefundsTotalForTransaction(originalTransactionId: number, assetId: number): Promise<bigint>;

  listTransactions(userId?: number, options?: { cursor?: number; limit?: number }): Promise<Result<FinancialTransactionRecord[]>>;
  getTransactionEntries(transactionId: number): Promise<Result<FinancialLedgerEntryRecord[]>>;

  getIdempotencyRecord(key: string, scope: string): Promise<IdempotencyRecord | null>;
  claimIdempotency(idempotencyKey: string, userId: number | null | undefined, scope: string, requestHash: string): Promise<boolean | IdempotencyClaimResult>;
  completeIdempotency(key: string, scope: string, transactionId: number): Promise<void>;
  failIdempotency(key: string, scope: string, failureCode?: string): Promise<void>;
  releaseIdempotencyClaim(key: string, scope: string): Promise<void>;
  insertTransaction(data: {
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
  }): Promise<Result<number, RepositoryError>>;
  insertLedgerEntries(entries: ReadonlyArray<LedgerEntry>, transactionId: number): Promise<Result<void, RepositoryError>>;
  updateBalanceWithOCC(
    accountId: number | string,
    assetId: number | string,
    amount: bigint,
    type: 'debit' | 'credit'
  ): Promise<BalanceUpdateResult>;
  updateTransactionStatus(transactionId: number, status: FinancialTransactionStatus, expectedVersion?: number): Promise<void>;
  // NOTE: persistOutboxEvent removed — use IOutboxRepository.saveEvent() within the same UoW transaction.

  /**
   * Provisiona a infraestrutura básica do Finance Core (Ativo padrão, contas sistêmicas e saldos zerados)
   * dentro do contexto transacional do repositório.
   */
  provisionTreasuryInfrastructure(
    options?: TreasuryBootstrapOptions
  ): Promise<Result<TreasuryBootstrapResult, RepositoryError>>;

  // Ingestion-first External Bank Transactions
  insertFiatExternalTransaction(data: {
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
  }): Promise<Result<number, RepositoryError>>;

  getFiatExternalTransactionByFingerprint(rowFingerprint: string): Promise<Result<any | null, RepositoryError>>;
  updateFiatExternalTransactionReconciliation(
    id: number,
    update: {
      status?: string;
      reconciliationStatus: 'unmatched' | 'matched' | 'ignored' | 'discrepancy';
      financialTransactionId?: number | null;
      amountBaseUnits?: string | null;
      assetId?: number | null;
    }
  ): Promise<Result<void, RepositoryError>>;
}

```


---

<a id="src_application_ports_output_IOutboxRepository_ts"></a>
## 12. `src/application/ports/output/IOutboxRepository.ts`

- **Caminho absoluto**: `/home/sandro/Área de trabalho/BackEnd/src/application/ports/output/IOutboxRepository.ts`
- **Total de linhas**: 75
- **O que precisa ser fechado**: Garantir atomicidade lógica com a UoW e contrato de publicação/reprocessamento

```typescript
import { IDomainEvent } from '../../../shared/kernel/DomainEvent';
import { Result } from '../../../shared/kernel/Result';

export interface OutboxEventRecord {
  id: string; // UUID
  aggregateId: string | number;
  aggregateType: string;
  aggregateVersion: number;
  eventName: string;
  payload: string; // JSON
  metadata?: string | null; // JSON
  attempts: number;
  status: 'pending' | 'processing' | 'published' | 'failed' | 'dead_letter';
  publishedAt?: Date | null;
  leaseOwner?: string | null;
  leaseGeneration?: number;
  leaseExpiresAt?: Date | null;
  error?: string | null;
  createdAt: Date;
}

export interface IOutboxRepository {
  /**
   * Persiste um evento de domínio no Outbox (UoW transactional context).
   */
  saveEvent(
    event: IDomainEvent,
    aggregateId: number | string,
    aggregateType: string,
    aggregateVersion: number
  ): Promise<Result<void>>;

  /**
   * Adquire um lease atômico (CAS com fencing token leaseGeneration) para eventos pendentes/expirados.
   */
  claimPendingLease(
    ownerId: string,
    leaseDurationMs?: number,
    limit?: number
  ): Promise<Result<OutboxEventRecord[]>>;

  /**
   * Renova o lease de um evento em processamento se a geração do token corresponder.
   */
  renewLease?(
    ownerId: string,
    eventId: string,
    currentGeneration: number,
    durationMs?: number
  ): Promise<Result<boolean>>;

  /**
   * Registra a recepção idempotente do consumidor via event_consumer_receipts.
   */
  recordConsumerReceipt(consumerId: string, eventId: string): Promise<Result<boolean>>;

  /**
   * Marca o evento como publicado garantindo a titularidade do lease (CAS via leaseGeneration).
   */
  markPublished?(
    eventId: string,
    ownerId: string,
    currentGeneration: number
  ): Promise<Result<boolean>>;

  /**
   * Marca o evento como falho liberando o lease para reprocessamento futuro.
   */
  markFailed?(
    eventId: string,
    ownerId: string,
    currentGeneration: number,
    error: string
  ): Promise<Result<boolean>>;
}

```


---

<a id="src_infrastructure_repositories_DrizzleOutboxRepository_ts"></a>
## 13. `src/infrastructure/repositories/DrizzleOutboxRepository.ts`

- **Caminho absoluto**: `/home/sandro/Área de trabalho/BackEnd/src/infrastructure/repositories/DrizzleOutboxRepository.ts`
- **Total de linhas**: 209
- **O que precisa ser fechado**: Revalidar a afirmação de 'transacional' em conjunto com a nova UoW

```typescript
import { IDomainEvent } from '../../shared/kernel/DomainEvent';
import { Result } from '../../shared/kernel/Result';
import { IOutboxRepository, OutboxEventRecord } from '../../application/ports/output/IOutboxRepository';
import { outboxEvents, eventConsumerReceipts } from '../../db/infrastructure/tables';
import { eq, and, inArray, asc, sql } from 'drizzle-orm';

export class DrizzleOutboxRepository implements IOutboxRepository {
  constructor(private db: any) {}

  async saveEvent(event: IDomainEvent, aggregateId: number, aggregateType: string, aggregateVersion: number): Promise<Result<void>> {
    try {
      const eventId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : (await import('crypto')).randomUUID();
      await this.db.insert(outboxEvents).values({
        id: eventId,
        aggregateId: String(aggregateId),
        aggregateType,
        aggregateVersion,
        eventName: event.eventName || (event.constructor.name !== 'Object' ? event.constructor.name : 'LedgerTransactionPosted.v1'),
        payload: JSON.stringify(event),
        metadata: JSON.stringify({ occurredOn: event.dateTimeOccurred }),
        attempts: 0,
        status: 'pending',
        leaseGeneration: 0,
        createdAt: new Date(),
      });
      return Result.ok();
    } catch (error: any) {
      return Result.fail(`Failed to save outbox event: ${error.message}`);
    }
  }

  async claimPendingLease(
    ownerId: string,
    leaseDurationMs: number = 30000,
    limit: number = 10
  ): Promise<Result<OutboxEventRecord[]>> {
    try {
      const now = new Date();
      const leaseExpiresAt = new Date(now.getTime() + leaseDurationMs);

      // Select candidate events that are pending/failed or whose lease is expired
      const candidates = await this.db
        .select()
        .from(outboxEvents)
        .where(
          and(
            sql`${outboxEvents.status} IN ('pending', 'failed', 'processing')`,
            sql`(${outboxEvents.leaseExpiresAt} IS NULL OR ${outboxEvents.leaseExpiresAt} < ${now})`
          )
        )
        .orderBy(asc(outboxEvents.createdAt))
        .limit(limit);

      if (candidates.length === 0) {
        return Result.ok([]);
      }

      const claimedEvents: OutboxEventRecord[] = [];

      for (const candidate of candidates) {
        const nextGen = (candidate.leaseGeneration ?? 0) + 1;
        const res = await this.db
          .update(outboxEvents)
          .set({
            leaseOwner: ownerId,
            leaseGeneration: nextGen,
            attempts: sql`${outboxEvents.attempts} + 1`,
            leaseExpiresAt,
            status: 'processing',
          })
          .where(
            and(
              eq(outboxEvents.id, candidate.id),
              eq(outboxEvents.leaseGeneration, candidate.leaseGeneration ?? 0),
              sql`(${outboxEvents.status} IN ('pending', 'failed') OR (${outboxEvents.status} = 'processing' AND (${outboxEvents.leaseExpiresAt} <= ${now} OR ${outboxEvents.leaseOwner} = ${ownerId})))`
            )
          );

        const affected = (res?.meta?.changes ?? res?.rowsAffected ?? 0);
        if (affected > 0) {
          claimedEvents.push({
            ...candidate,
            leaseOwner: ownerId,
            leaseGeneration: nextGen,
            attempts: (candidate.attempts ?? 0) + 1,
            leaseExpiresAt,
            status: 'processing',
          });
        }
      }

      return Result.ok(claimedEvents);
    } catch (error: any) {
      return Result.fail(`Failed to claim outbox lease: ${error.message}`);
    }
  }

  async renewLease(
    ownerId: string,
    eventId: string,
    currentGeneration: number,
    durationMs: number = 30000
  ): Promise<Result<boolean>> {
    try {
      const now = new Date();
      const newExpiresAt = new Date(now.getTime() + durationMs);

      const res = await this.db
        .update(outboxEvents)
        .set({
          leaseExpiresAt: newExpiresAt,
        })
        .where(
          and(
            eq(outboxEvents.id, eventId),
            eq(outboxEvents.leaseOwner, ownerId),
            eq(outboxEvents.leaseGeneration, currentGeneration),
            sql`${outboxEvents.leaseExpiresAt} > ${now}`,
            eq(outboxEvents.status, 'processing')
          )
        );

      const affected = (res?.meta?.changes ?? res?.rowsAffected ?? 0);
      return Result.ok(affected > 0);
    } catch (error: any) {
      return Result.fail(`Failed to renew outbox lease: ${error.message}`);
    }
  }

  async recordConsumerReceipt(consumerId: string, eventId: string): Promise<Result<boolean>> {
    try {
      const id = `${consumerId}:${eventId}`;
      await this.db.insert(eventConsumerReceipts).values({
        id,
        consumerId,
        eventId,
        processedAt: new Date(),
      });
      return Result.ok(true);
    } catch (error: any) {
      if (error.message && (error.message.includes('UNIQUE') || error.message.includes('unique'))) {
        return Result.ok(false);
      }
      return Result.fail(`Failed to record consumer receipt: ${error.message}`);
    }
  }

  async markPublished(
    eventId: string,
    ownerId: string,
    currentGeneration: number
  ): Promise<Result<boolean>> {
    try {
      const res = await this.db
        .update(outboxEvents)
        .set({
          status: 'published',
          publishedAt: new Date(),
          leaseOwner: null,
          leaseExpiresAt: null,
        })
        .where(
          and(
            eq(outboxEvents.id, eventId),
            eq(outboxEvents.leaseOwner, ownerId),
            eq(outboxEvents.leaseGeneration, currentGeneration),
            eq(outboxEvents.status, 'processing')
          )
        );

      const affected = (res?.meta?.changes ?? res?.rowsAffected ?? 0);
      return Result.ok(affected > 0);
    } catch (error: any) {
      return Result.fail(`Failed to mark outbox event as published: ${error.message}`);
    }
  }

  async markFailed(
    eventId: string,
    ownerId: string,
    currentGeneration: number,
    error: string
  ): Promise<Result<boolean>> {
    try {
      const res = await this.db
        .update(outboxEvents)
        .set({
          status: 'failed',
          error,
          leaseOwner: null,
          leaseExpiresAt: null,
        })
        .where(
          and(
            eq(outboxEvents.id, eventId),
            eq(outboxEvents.leaseOwner, ownerId),
            eq(outboxEvents.leaseGeneration, currentGeneration),
            eq(outboxEvents.status, 'processing')
          )
        );

      const affected = (res?.meta?.changes ?? res?.rowsAffected ?? 0);
      return Result.ok(affected > 0);
    } catch (error: any) {
      return Result.fail(`Failed to mark outbox event as failed: ${error.message}`);
    }
  }
}


```


---
