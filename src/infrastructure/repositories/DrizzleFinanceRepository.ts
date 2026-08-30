import { eq, and, sql } from 'drizzle-orm';
import {
  financialAccounts,
  accountBalances,
  financialTransactions,
  financialLedgerEntries,
} from '../../db/finance/tables';
import { idempotencyKeys, outboxEvents } from '../../db/infrastructure/tables';
import { Result } from '../../shared/kernel/Result';
import {
  IFinanceRepository,
  FinancialAccountRecord,
  AccountBalanceRecord,
  FinancialTransactionRecord,
} from '../../application/ports/output/IFinanceRepository';
import { LedgerEntry } from '../../domains/finance/entities/LedgerTransaction';

export type { FinancialAccountRecord, AccountBalanceRecord, FinancialTransactionRecord };

const MAX_BINDING_SAFE_BASE_UNITS = 9007199254740991; // Number.MAX_SAFE_INTEGER (2^53 - 1)

export class DrizzleFinanceRepository implements IFinanceRepository {
  constructor(private readonly db: any) {}

  private get executor() {
    return this.db;
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
        const [inserted] = await this.executor
          .insert(financialAccounts)
          .values({
            userId: null,
            accountType: 'treasury',
            accountClass: 'asset',
            name: 'ASPPIBRA DAO Main Treasury',
            status: 'active',
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .returning();

        return Result.ok({
          id: inserted.id,
          userId: inserted.userId,
          accountType: inserted.accountType as any,
          status: inserted.status as any,
          name: inserted.name,
          version: inserted.version,
        });
      }

      return Result.ok({
        id: row.id,
        userId: row.userId,
        accountType: row.accountType as any,
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

      const balances: AccountBalanceRecord[] = rows.map((r: any) => ({
        id: r.id,
        accountId: r.accountId,
        assetId: r.assetId,
        availableBaseUnits: r.availableBaseUnits.toString(),
        lockedBaseUnits: r.lockedBaseUnits.toString(),
        version: r.version,
      }));

      return Result.ok(balances);
    } catch (err: any) {
      return Result.fail(err.message);
    }
  }

  async getOrCreateUserAccount(userId: number): Promise<Result<FinancialAccountRecord>> {
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

      if (row) {
        return Result.ok({
          id: row.id,
          userId: row.userId,
          accountType: row.accountType as any,
          status: row.status as any,
          name: row.name,
          version: row.version,
        });
      }

      try {
        const [inserted] = await this.executor
          .insert(financialAccounts)
          .values({
            userId: userId,
            accountType: 'user_available',
            accountClass: 'liability',
            name: `User ${userId} Main Account`,
            status: 'active',
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .returning();

        return Result.ok({
          id: inserted.id,
          userId: inserted.userId,
          accountType: inserted.accountType as any,
          status: inserted.status as any,
          name: inserted.name,
          version: inserted.version,
        });
      } catch (insertErr: any) {
        if (!insertErr.message || (!insertErr.message.toLowerCase().includes('unique'))) {
          throw insertErr;
        }
        
        const [existing] = await this.executor
          .select()
          .from(financialAccounts)
          .where(
            and(
              eq(financialAccounts.userId, userId),
              eq(financialAccounts.accountType, 'user_available')
            )
          )
          .limit(1);
          
        if (existing) {
          return Result.ok({
            id: existing.id,
            userId: existing.userId,
            accountType: existing.accountType as any,
            status: existing.status as any,
            name: existing.name,
            version: existing.version,
          });
        }
        throw new Error('Falha de concorrência: Conta não encontrada mesmo após violação de UNIQUE.');
      }
    } catch (err: any) {
      return Result.fail(err.message);
    }
  }

  async getOrCreateOperatingAccount(): Promise<Result<FinancialAccountRecord>> {
    try {
      const [row] = await this.executor
        .select()
        .from(financialAccounts)
        .where(
          and(
            sql`${financialAccounts.userId} IS NULL`,
            eq(financialAccounts.accountType, 'operating')
          )
        )
        .limit(1);

      if (!row) {
        const [inserted] = await this.executor
          .insert(financialAccounts)
          .values({
            userId: null,
            accountType: 'operating',
            accountClass: 'asset',
            name: 'System Operating Account',
            status: 'active',
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .returning();

        return Result.ok({
          id: inserted.id,
          userId: inserted.userId,
          accountType: inserted.accountType as any,
          status: inserted.status as any,
          name: inserted.name,
          version: inserted.version,
        });
      }

      return Result.ok({
        id: row.id,
        userId: row.userId,
        accountType: row.accountType as any,
        status: row.status as any,
        name: row.name,
        version: row.version,
      });
    } catch (err: any) {
      return Result.fail(err.message);
    }
  }

  private async ensureAccountBalance(
    accountId: number,
    assetId: number,
    executorOverride?: any
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
          availableBaseUnits: 0,
          lockedBaseUnits: 0,
          version: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      } catch (err: any) {
        if (!err.message || (!err.message.includes('UNIQUE') && !err.message.includes('unique'))) {
          throw err;
        }
      }
    }
  }



  async insertTransaction(data: {
    userId?: number | null;
    type: string;
    category: string;
    description: string;
    status: string;
  }): Promise<number> {
    const [tx] = await this.executor
      .insert(financialTransactions)
      .values({
        userId: data.userId || null,
        type: data.type,
        category: data.category,
        status: data.status,
        description: data.description,
        completedAt: data.status === 'completed' ? new Date() : null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning({ id: financialTransactions.id });

    console.log('[insertTransaction] returned id:', tx?.id);
    if (!tx) throw new Error('Falha ao inserir registro de transação financeira.');
    return tx.id;
  }

  async updateTransactionStatus(transactionId: number, status: string): Promise<void> {
    const res = await this.executor
      .update(financialTransactions)
      .set({
        status: status as any,
        completedAt: status === 'completed' ? new Date() : undefined,
        updatedAt: new Date()
      })
      .where(
        and(
          eq(financialTransactions.id, transactionId),
          status === 'completed' 
            ? eq(financialTransactions.status, 'processing') 
            : sql`${financialTransactions.status} IN ('pending', 'processing')`
        )
      );

    const affected = (res?.meta?.changes ?? res?.rowsAffected ?? 0);
    if (affected === 0) {
      throw new Error(`State Machine Error: Transição de status inválida para a transação ${transactionId}. O status destino (${status}) requer que a transação esteja em 'processing' (se destino for completed) ou 'pending/processing'.`);
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
  ): Promise<{ status: string; requestHash: string; transactionId?: number } | null> {
    const [record] = await this.executor
      .select({
        status: idempotencyKeys.status,
        requestHash: idempotencyKeys.requestHash,
        transactionId: idempotencyKeys.financialTransactionId
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
    return {
      status: record.status,
      requestHash: record.requestHash,
      transactionId: record.transactionId || undefined
    };
  }

  async claimIdempotency(
    idempotencyKey: string,
    userId: number | null | undefined,
    scope: string,
    requestHash: string
  ): Promise<boolean> {
    try {
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      await this.executor.insert(idempotencyKeys).values({
        userId: userId ?? null,
        scope,
        key: idempotencyKey,
        requestHash,
        status: 'processing',
        expiresAt,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      return true;
    } catch (err: any) {
      const msg = (err?.message || '') + ' ' + (err?.cause?.message || '');
      const lowerMsg = msg.toLowerCase();
      // Strict check for D1/SQLite UNIQUE constraint violation
      if (lowerMsg.includes('unique constraint failed') || lowerMsg.includes('d1_error: unique constraint') || lowerMsg.includes('insert into "idempotency_keys"')) {
        return false;
      }
      throw err;
    }
  }

  async completeIdempotency(key: string, scope: string, transactionId: number): Promise<void> {
    await this.executor
      .update(idempotencyKeys)
      .set({
        status: 'completed',
        financialTransactionId: transactionId
      })
      .where(
        and(
          eq(idempotencyKeys.key, key),
          eq(idempotencyKeys.scope, scope)
        )
      );
  }

  async insertLedgerEntries(entries: LedgerEntry[], transactionId: number): Promise<void> {
    const payload = entries.map(entry => {
      const rawVal = (entry.amount as any)?.amount ?? entry.amount;
      const amountBigInt = typeof rawVal === 'bigint' ? rawVal : BigInt(rawVal);

      if (amountBigInt <= 0n || amountBigInt > BigInt(MAX_BINDING_SAFE_BASE_UNITS)) {
        throw new Error(`Invalid ledger entry amount: ${amountBigInt}`);
      }

      const amountNum = Number(amountBigInt);

      const accountIdNum = Number(entry.accountId);
      const assetIdNum = Number(entry.amount.assetId);

      if (!Number.isInteger(accountIdNum) || accountIdNum <= 0) {
        throw new Error(`Invalid physical accountId: ${entry.accountId}`);
      }
      if (!Number.isInteger(assetIdNum) || assetIdNum <= 0) {
        throw new Error(`Invalid physical assetId: ${entry.amount.assetId}`);
      }

      return {
        transactionId,
        accountId: accountIdNum,
        assetId: assetIdNum,
        direction: entry.type,
        amountBaseUnits: amountNum,
        createdAt: new Date(),
      };
    });

    if (payload.length > 0) {
      try {
        await this.executor.insert(financialLedgerEntries).values(payload);
      } catch (err: any) {
        console.log('[insertLedgerEntries ERROR]', { message: err.message, cause: err.cause?.message, raw: err });
        throw err;
      }
    }
  }

  async updateBalanceWithOCC(
    accountId: string,
    assetId: string,
    amount: bigint,
    type: 'debit' | 'credit',
    executorOverride?: any
  ): Promise<boolean> {
    const exec = executorOverride || this.executor;

    if (typeof amount !== 'bigint' || amount <= 0n || amount > BigInt(MAX_BINDING_SAFE_BASE_UNITS)) {
      throw new Error(`Invalid base units amount for OCC update: ${amount}`);
    }

    const amountNum = Number(amount);

    const accIdNum = Number(accountId);
    const assetIdNum = Number(assetId);

    if (!Number.isInteger(accIdNum) || accIdNum <= 0) {
      throw new Error(`Invalid physical accountId: ${accountId}`);
    }
    if (!Number.isInteger(assetIdNum) || assetIdNum <= 0) {
      throw new Error(`Invalid physical assetId: ${assetId}`);
    }

    // 1. Garantir que a linha de saldo exista (auto-provisionamento se necessário)
    await this.ensureAccountBalance(accIdNum, assetIdNum, exec);

    // 2. Determinar a classe da conta (asset vs liability) para aplicar a matemática correta
    const [accRow] = await exec
      .select({ accountClass: financialAccounts.accountClass })
      .from(financialAccounts)
      .where(eq(financialAccounts.id, accIdNum))
      .limit(1);

    if (!accRow) {
      throw new Error(`Account not found: ${accountId}`);
    }

    const accClass = accRow.accountClass;
    if (accClass !== 'asset' && accClass !== 'liability') {
      throw new Error(`Account class '${accClass}' is not supported in Treasury Ledger OCC. Only 'asset' or 'liability' allowed.`);
    }

    const isAssetClass = accClass === 'asset';

    // 3. Selecionar o saldo com OCC version
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

    // Regra contábil de movimentação de saldo disponível materializado:
    // - Para Passivo (liability, ex: user_available): Crédito aumenta saldo disponível, Débito reduz.
    // - Para Ativo (asset, ex: treasury, operating): Débito aumenta saldo do ativo, Crédito reduz.
    const isIncrease = isAssetClass ? type === 'debit' : type === 'credit';

    let res: any;
    if (isIncrease) {
      // Crédito em Passivo OU Débito em Ativo -> Incrementa saldo disponível
      res = await exec
        .update(accountBalances)
        .set({
          availableBaseUnits: sql`${accountBalances.availableBaseUnits} + ${amountNum}`,
          version: currentVersion + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(accountBalances.id, balance.id),
            eq(accountBalances.version, currentVersion),
            sql`${accountBalances.availableBaseUnits} + ${amountNum} <= 9007199254740991`
          )
        );
    } else {
      // Débito em Passivo OU Crédito em Ativo -> Decrementa saldo disponível
      res = await exec
        .update(accountBalances)
        .set({
          availableBaseUnits: sql`${accountBalances.availableBaseUnits} - ${amountNum}`,
          version: currentVersion + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(accountBalances.id, balance.id),
            eq(accountBalances.version, currentVersion),
            sql`${accountBalances.availableBaseUnits} >= ${amountNum}`
          )
        );
    }

    const affected = (res?.meta?.changes ?? res?.rowsAffected ?? 0);
    return affected > 0;
  }

  async persistOutboxEvent(eventType: string, payload: any): Promise<void> {
    const eventId = crypto.randomUUID();
    await this.executor.insert(outboxEvents).values({
      id: eventId,
      aggregateId: String(payload.transactionId ?? eventId),
      aggregateType: 'LedgerTransaction',
      aggregateVersion: 1,
      eventName: eventType,
      payload: JSON.stringify(payload),
      status: 'pending',
      leaseGeneration: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }
}
