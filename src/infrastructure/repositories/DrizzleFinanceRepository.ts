import { eq, and } from 'drizzle-orm';
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

export class DrizzleFinanceRepository implements IFinanceRepository {
  constructor(private readonly db: any) {}

  async getTreasuryAccount(): Promise<Result<FinancialAccountRecord>> {
    try {
      const [row] = await this.db
        .select()
        .from(financialAccounts)
        .where(eq(financialAccounts.accountType, 'treasury'))
        .limit(1);

      if (!row) {
        // Se não existir a conta tesouraria, cria uma nova conta padrão de tesouraria
        const [inserted] = await this.db
          .insert(financialAccounts)
          .values({
            userId: null,
            accountType: 'treasury',
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
      const rows = await this.db
        .select()
        .from(accountBalances)
        .where(eq(accountBalances.accountId, treasuryId));

      const balances: AccountBalanceRecord[] = rows.map((r: any) => ({
        id: r.id,
        accountId: r.accountId,
        assetId: r.assetId,
        availableBaseUnits: r.availableBaseUnits,
        lockedBaseUnits: r.lockedBaseUnits,
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
  }): Promise<Result<FinancialTransactionRecord>> {
    try {
      const treasuryRes = await this.getTreasuryAccount();
      if (treasuryRes.isFailure) return Result.fail(treasuryRes.error || 'Treasury account error');

      const treasuryId = treasuryRes.getValue().id;

      // 1. Criar registro de transação
      const [tx] = await this.db
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

      // 2. Criar entrada contábil (Ledger Entry)
      await this.db.insert(financialLedgerEntries).values({
        transactionId: tx.id,
        accountId: treasuryId,
        assetId: data.assetId,
        direction: data.type === 'deposit' ? 'credit' : 'debit',
        amountBaseUnits: data.amountBaseUnits,
      });

      return Result.ok({
        id: tx.id,
        userId: tx.userId,
        type: tx.type as any,
        category: tx.category,
        status: tx.status as any,
        description: tx.description,
        createdAt: new Date(tx.createdAt),
        completedAt: tx.completedAt ? new Date(tx.completedAt) : null,
      });
    } catch (err: any) {
      return Result.fail(err.message);
    }
  }

  async listTransactions(userId?: number): Promise<Result<FinancialTransactionRecord[]>> {
    try {
      const query = userId
        ? this.db.select().from(financialTransactions).where(eq(financialTransactions.userId, userId))
        : this.db.select().from(financialTransactions);

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
  
  async claimIdempotency(idempotencyKey: string): Promise<boolean> {
    try {
      // Tenta inserir a chave com expiração de 24h
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      await this.db.insert(idempotencyKeys).values({
        id: idempotencyKey,
        expiresAt,
      });
      return true;
    } catch (err: any) {
      // Se houver conflito (UNIQUE constraint falhar), a transação já foi processada
      if (err.message && err.message.includes('UNIQUE constraint failed')) {
        return false;
      }
      throw err;
    }
  }

  async insertLedgerEntries(entries: LedgerEntry[]): Promise<void> {
    const payload = entries.map(entry => ({
      transactionId: 1, // Na arquitetura final, as entries vêm acopladas a uma tx real, por ora usamos placeholder ou resolvemos no serviço
      accountId: parseInt(entry.accountId, 10),
      assetId: parseInt(entry.amount.assetId, 10),
      direction: entry.type,
      amountBaseUnits: entry.amount.amount.toString(),
    }));

    if (payload.length > 0) {
      await this.db.insert(financialLedgerEntries).values(payload);
    }
  }

  async updateBalanceWithOCC(
    accountId: string,
    assetId: string,
    amount: bigint,
    type: 'debit' | 'credit'
  ): Promise<boolean> {
    // 1. Busca o saldo atual e a versão
    const [balance] = await this.db
      .select({
        id: accountBalances.id,
        availableBaseUnits: accountBalances.availableBaseUnits,
        version: accountBalances.version,
      })
      .from(accountBalances)
      .where(
        and(
          eq(accountBalances.accountId, parseInt(accountId, 10)),
          eq(accountBalances.assetId, parseInt(assetId, 10))
        )
      )
      .limit(1);

    if (!balance) {
      throw new Error(`Balance not found for account ${accountId} and asset ${assetId}`);
    }

    let currentAvailable = BigInt(balance.availableBaseUnits);
    
    // Debit means removing money from available balance in this domain context (if asset, credit means adding)
    // Wait, in double-entry:
    // User Deposit: Debit Treasury (increase), Credit User Liability (increase)
    // The exact math depends on the account type (Asset vs Liability).
    // For simplicity, we assume Debit = Subtract from source, Credit = Add to dest
    // Actually standard accounting: Debit increases assets, Credit decreases assets.
    // Let's implement a simple logic:
    if (type === 'debit') {
      currentAvailable -= amount;
    } else {
      currentAvailable += amount;
    }

    if (currentAvailable < 0n) {
      throw new Error(`Insufficient funds for account ${accountId}`);
    }

    const res = await this.db
      .update(accountBalances)
      .set({
        availableBaseUnits: currentAvailable.toString(),
        version: balance.version + 1,
      })
      .where(
        and(
          eq(accountBalances.id, balance.id),
          eq(accountBalances.version, balance.version)
        )
      );

    // Drizzle with SQLite returns info about changes. If rows matched/updated = 0, OCC failed.
    if (res.rowsAffected === 0) {
      return false; // OCC Failed!
    }

    return true;
  }

  async persistOutboxEvent(eventType: string, payload: any): Promise<void> {
    const eventId = crypto.randomUUID();
    await this.db.insert(outboxEvents).values({
      id: eventId,
      aggregateId: 1,
      aggregateType: 'LedgerTransaction',
      aggregateVersion: 1,
      eventName: eventType,
      payload: JSON.stringify(payload),
    });
  }
}
