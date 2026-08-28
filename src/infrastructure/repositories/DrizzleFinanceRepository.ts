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

  async createTransaction(data: {
    userId?: number | null;
    type: 'deposit' | 'withdrawal' | 'transfer' | 'payment' | 'refund' | 'fee' | 'reward' | 'yield' | 'conversion' | 'adjustment';
    category?: string;
    description: string;
    amountBaseUnits: string;
    assetId: number;
    userAccountId?: number;
  }): Promise<Result<FinancialTransactionRecord>> {
    try {
      const amountNum = Number(data.amountBaseUnits);
      if (isNaN(amountNum) || amountNum <= 0 || amountNum > MAX_BINDING_SAFE_BASE_UNITS) {
        return Result.fail(`Invalid monetary amount range: ${data.amountBaseUnits}`);
      }

      const treasuryRes = await this.getTreasuryAccount();
      if (treasuryRes.isFailure) return Result.fail(treasuryRes.error || 'Treasury account error');
      const treasuryId = treasuryRes.getValue().id;

      const runTx = async (tx: any) => {
        // 1. Criar registro de transação
        const [transaction] = await tx
          .insert(financialTransactions)
          .values({
            userId: data.userId || null,
            type: data.type,
            category: (data.category as any) || 'operational',
            status: 'completed',
            description: data.description,
            completedAt: new Date(),
          })
          .returning();

        // 2. Definir conta do usuário / contrapartida
        let counterpartAccountId = data.userAccountId;
        if (!counterpartAccountId && data.userId) {
          const [userAcc] = await tx
            .select({ id: financialAccounts.id })
            .from(financialAccounts)
            .where(
              and(
                eq(financialAccounts.userId, data.userId),
                eq(financialAccounts.accountType, 'user_available')
              )
            )
            .limit(1);
          counterpartAccountId = userAcc?.id;
        }

        if (!counterpartAccountId) {
          const [opAcc] = await tx
            .insert(financialAccounts)
            .values({
              userId: data.userId || null,
              accountType: data.userId ? 'user_available' : 'operating',
              accountClass: data.userId ? 'liability' : 'asset',
              name: data.userId ? `User ${data.userId} Main Account` : 'System Operating Account',
              status: 'active',
            })
            .returning();
          counterpartAccountId = opAcc.id;
        }

        // 3. Double-entry posting
        const isDeposit = data.type === 'deposit' || data.type === 'transfer' || data.type === 'yield';
        const leg1Direction = isDeposit ? 'debit' : 'credit';
        const leg2Direction = isDeposit ? 'credit' : 'debit';

        await tx.insert(financialLedgerEntries).values([
          {
            transactionId: transaction.id,
            accountId: counterpartAccountId,
            assetId: data.assetId,
            direction: leg1Direction,
            amountBaseUnits: amountNum,
          },
          {
            transactionId: transaction.id,
            accountId: treasuryId,
            assetId: data.assetId,
            direction: leg2Direction,
            amountBaseUnits: amountNum,
          },
        ]);

        return transaction;
      };

      const resultTx = typeof this.executor.transaction === 'function'
        ? await this.executor.transaction(runTx)
        : await runTx(this.executor);

      return Result.ok({
        id: resultTx.id,
        userId: resultTx.userId,
        type: resultTx.type as any,
        category: resultTx.category,
        status: resultTx.status as any,
        description: resultTx.description,
        createdAt: new Date(resultTx.createdAt),
        completedAt: resultTx.completedAt ? new Date(resultTx.completedAt) : null,
      });
    } catch (err: any) {
      return Result.fail(err.message);
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
        completedAt: new Date(),
      })
      .returning({ id: financialTransactions.id });

    if (!tx) throw new Error('Falha ao inserir registro de transação financeira.');
    return tx.id;
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
  
  async claimIdempotency(
    idempotencyKey: string,
    userId?: number | null,
    scope: string = 'finance',
    requestHash: string = 'hash_placeholder'
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
      });
      return true;
    } catch (err: any) {
      if (err.message && (err.message.includes('UNIQUE') || err.message.includes('unique'))) {
        return false;
      }
      throw err;
    }
  }

  async insertLedgerEntries(entries: LedgerEntry[], transactionId: number): Promise<void> {
    const payload = entries.map(entry => {
      const rawVal = (entry.amount as any)?.amount ?? entry.amount;
      const amountNum = typeof rawVal === 'number' ? rawVal : Number(rawVal);

      if (isNaN(amountNum) || amountNum <= 0 || amountNum > MAX_BINDING_SAFE_BASE_UNITS) {
        throw new Error(`Invalid ledger entry amount: ${entry.amount.amount}`);
      }

      return {
        transactionId,
        accountId: parseInt(entry.accountId, 10),
        assetId: parseInt(entry.amount.assetId, 10),
        direction: entry.type,
        amountBaseUnits: amountNum,
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
    type: 'debit' | 'credit'
  ): Promise<boolean> {
    const amountNum = Number(amount);
    if (isNaN(amountNum) || amountNum <= 0 || amountNum > MAX_BINDING_SAFE_BASE_UNITS) {
      throw new Error(`Invalid base units amount for OCC update: ${amount}`);
    }

    const accIdNum = parseInt(accountId, 10);
    const assetIdNum = parseInt(assetId, 10);

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

    let res: any;
    if (type === 'debit') {
      // Debit: Subtract amount from available balance if balance >= amount
      res = await this.executor
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
    } else {
      // Credit: Add amount to available balance satisfying INV-BALANCE-001 (<= 9007199254740991)
      res = await this.executor
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
    });
  }
}
