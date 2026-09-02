import { eq, and, sql } from 'drizzle-orm';
import {
  financialAccounts,
  accountBalances,
  financialTransactions,
  financialLedgerEntries,
  financialAssets,
} from '../../db/finance/tables';
import { idempotencyKeys, outboxEvents } from '../../db/infrastructure/tables';
import { Result } from '../../shared/kernel/Result';
import {
  IFinanceRepository,
  FinancialAccountRecord,
  AccountBalanceRecord,
  FinancialTransactionRecord,
  SystemAccountType,
} from '../../application/ports/output/IFinanceRepository';
import { LedgerEntry } from '../../domains/finance/entities/LedgerTransaction';

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
        return Result.fail('Treasury account not found. Must be provisioned via bootstrap seed.');
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

  async getAssetById(assetId: number): Promise<Result<{ id: number; code: string; status: string }>> {
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
        status: row.status,
      });
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
        if (!isUniqueConstraintViolation(insertErr)) {
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

      const EXPECTED_CLASSES: Record<string, string> = {
        payment_revenue: 'revenue',
        refund_expense: 'expense',
        fees: 'revenue',
        reward_expense: 'expense',
        yield_expense: 'expense',
        operating: 'asset',
        treasury: 'asset',
        reserve: 'asset',
        escrow: 'asset',
        clearing: 'asset',
        opening_balance_equity: 'equity',
      };

      const expectedClass = EXPECTED_CLASSES[accountType];
      if (expectedClass && row.accountClass !== expectedClass) {
        return Result.fail(
          `Conta sistêmica "${accountType}" possui classe contábil incompatível (${row.accountClass} !== ${expectedClass}).`
        );
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
        type: row.type as any,
        category: row.category as any,
        status: row.status as any,
        description: row.description,
        version: row.version,
        createdAt: new Date(row.createdAt),
        completedAt: row.completedAt ? new Date(row.completedAt) : null,
      });
    } catch (err: any) {
      return Result.fail(err.message);
    }
  }

  async getRefundsTotalForTransaction(originalTransactionId: number): Promise<bigint> {
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
          sql`${financialLedgerEntries.transactionId} IN (${sql.join(refundTxIds.map((id: number) => sql`${id}`), sql`, `)})`,
          eq(financialLedgerEntries.direction, 'credit')
        )
      );

    let total = 0n;
    for (const entry of entries) {
      total += BigInt(entry.amountBaseUnits || '0');
    }
    return total;
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
          availableBaseUnits: '0',
          lockedBaseUnits: '0',
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
    reversalOfTransactionId?: number;
    refundOfTransactionId?: number;
  }): Promise<number> {
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

    if (!tx) throw new Error('Falha ao inserir registro de transação financeira.');
    return tx.id;
  }

  async updateTransactionStatus(transactionId: number, status: string, expectedVersion?: number): Promise<void> {
    let whereCondition;
    if (status === 'completed') {
      whereCondition = eq(financialTransactions.status, 'processing');
    } else if (status === 'reversed') {
      whereCondition = eq(financialTransactions.status, 'completed');
    } else if (status === 'processing') {
      whereCondition = eq(financialTransactions.status, 'pending');
    } else {
      whereCondition = sql`${financialTransactions.status} IN ('pending', 'processing')`;
    }

    const conditions = [eq(financialTransactions.id, transactionId), whereCondition];
    if (expectedVersion !== undefined) {
      conditions.push(eq(financialTransactions.version, expectedVersion));
    }

    const res = await this.executor
      .update(financialTransactions)
      .set({
        status: status as any,
        version: sql`${financialTransactions.version} + 1`,
        completedAt: status === 'completed' ? new Date() : undefined,
        updatedAt: new Date()
      })
      .where(and(...conditions));

    const affected = (res?.meta?.changes ?? res?.rowsAffected ?? 0);
    if (affected === 0) {
      throw new Error(`State Machine Error: Transição de status inválida para a transação ${transactionId}. Não foi possível atualizar status para '${status}'.`);
    }
  }

  async getTransactionEntries(transactionId: number): Promise<Result<Array<{ accountId: number; assetId: number; direction: 'debit' | 'credit'; amountBaseUnits: string }>>> {
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

      return Result.ok(rows as any);
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
      if (isUniqueConstraintViolation(err)) {
        return false;
      }
      throw err;
    }
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
          eq(idempotencyKeys.scope, scope)
        )
      );

    const affected = (res?.meta?.changes ?? res?.rowsAffected ?? 0);
    if (affected === 0) {
      throw new Error(`Falha ao concluir Idempotency Key (${key}): Registro de idempotência não encontrado ou em estado inconsistente.`);
    }
  }

  async insertLedgerEntries(entries: LedgerEntry[], transactionId: number): Promise<void> {
    const payload = entries.map(entry => {
      const rawVal = (entry.amount as any)?.amount ?? entry.amount;
      const amountBigInt = typeof rawVal === 'bigint' ? rawVal : BigInt(rawVal);

      if (amountBigInt <= 0n) {
        throw new Error(`Invalid ledger entry amount: ${amountBigInt}`);
      }

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
        amountBaseUnits: amountBigInt.toString(),
        createdAt: new Date(),
      };
    });

    if (payload.length > 0) {
      await this.executor.insert(financialLedgerEntries).values(payload);
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

    if (typeof amount !== 'bigint' || amount <= 0n) {
      throw new Error(`Invalid base units amount for OCC update: ${amount}`);
    }

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
    const isDebitNormal = accClass === 'asset' || accClass === 'expense';

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
    const isIncrease = isDebitNormal ? type === 'debit' : type === 'credit';
    const currentAvailable = BigInt(balance.availableBaseUnits || '0');
    const newAvailable = isIncrease
      ? currentAvailable + amount
      : currentAvailable - amount;

    if (newAvailable < 0n) {
      return false; // Saldo insuficiente
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
    });
  }
}
