import { Result } from '../../../shared/kernel/Result';
import { LedgerEntry } from '../../../domains/finance/entities/LedgerTransaction';

export interface FinancialAccountRecord {
  id: number;
  userId: number | null;
  accountType: 'user_available' | 'treasury' | 'operating' | 'reserve' | 'fees' | 'escrow';
  status: 'active' | 'inactive' | 'suspended';
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
  type: 'deposit' | 'withdrawal' | 'transfer' | 'payment' | 'refund' | 'fee' | 'reward' | 'yield' | 'conversion' | 'adjustment';
  category: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'reversed' | 'refunded';
  description: string;
  createdAt: Date;
  completedAt?: Date | null;
}

export interface IFinanceRepository {
  getTreasuryAccount(): Promise<Result<FinancialAccountRecord>>;
  getOrCreateUserAccount(userId: number): Promise<Result<FinancialAccountRecord>>;
  getOrCreateOperatingAccount(): Promise<Result<FinancialAccountRecord>>;
  getTreasuryBalance(): Promise<Result<AccountBalanceRecord[]>>;

  listTransactions(userId?: number): Promise<Result<FinancialTransactionRecord[]>>;

  getIdempotencyRecord(key: string, scope: string): Promise<{ status: string; requestHash: string; transactionId?: number } | null>;
  claimIdempotency(idempotencyKey: string, userId: number | null | undefined, scope: string, requestHash: string): Promise<boolean>;
  completeIdempotency(key: string, scope: string, transactionId: number): Promise<void>;
  insertTransaction(data: {
    userId?: number | null;
    type: string;
    category: string;
    description: string;
    status: string;
  }): Promise<number>;
  insertLedgerEntries(entries: LedgerEntry[], transactionId: number): Promise<void>;
  updateBalanceWithOCC(
    accountId: string,
    assetId: string,
    amount: bigint,
    type: 'debit' | 'credit'
  ): Promise<boolean>;
  updateTransactionStatus(transactionId: number, status: string): Promise<void>;
  persistOutboxEvent(eventType: string, payload: any): Promise<void>;
}
