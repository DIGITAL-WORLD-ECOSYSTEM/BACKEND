import { eq } from 'drizzle-orm';
import {
  financialAccounts,
  accountBalances,
  financialTransactions,
  financialLedgerEntries,
} from '../../db/finance/tables';
import { Result } from '../../shared/kernel/Result';
import {
  IFinanceRepository,
  FinancialAccountRecord,
  AccountBalanceRecord,
  FinancialTransactionRecord,
} from '../../application/ports/output/IFinanceRepository';

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
}
