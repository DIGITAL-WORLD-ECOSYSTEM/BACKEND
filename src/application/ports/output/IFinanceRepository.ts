import { Result } from '../../../shared/kernel/Result';
import { LedgerEntry } from '../../../domains/finance/entities/LedgerTransaction';

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
  | 'reversal'
  | 'inbound'
  | 'outbound';

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

export interface FinancialAccountRecord {
  id: number;
  userId: number | null;
  accountType: SystemAccountType | 'user_available';
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
  category: FinancialTransactionCategory | string;
  status: FinancialTransactionStatus;
  description: string;
  version: number;
  createdAt: Date;
  completedAt?: Date | null;
}

export interface IFinanceRepository {
  getTreasuryAccount(): Promise<Result<FinancialAccountRecord>>;
  getOrCreateUserAccount(userId: number): Promise<Result<FinancialAccountRecord>>;
  getOrCreateOperatingAccount(): Promise<Result<FinancialAccountRecord>>;
  getSystemAccount(accountType: SystemAccountType): Promise<Result<FinancialAccountRecord>>;
  getTreasuryBalance(): Promise<Result<AccountBalanceRecord[]>>;

  getTransactionById(transactionId: number): Promise<Result<FinancialTransactionRecord>>;
  getRefundsTotalForTransaction(originalTransactionId: number): Promise<bigint>;

  listTransactions(userId?: number): Promise<Result<FinancialTransactionRecord[]>>;
  getTransactionEntries(transactionId: number): Promise<Result<Array<{ accountId: number; assetId: number; direction: 'debit' | 'credit'; amountBaseUnits: string }>>>;

  getIdempotencyRecord(key: string, scope: string): Promise<{ status: string; requestHash: string; transactionId?: number } | null>;
  claimIdempotency(idempotencyKey: string, userId: number | null | undefined, scope: string, requestHash: string): Promise<boolean>;
  completeIdempotency(key: string, scope: string, transactionId: number): Promise<void>;
  insertTransaction(data: {
    userId?: number | null;
    type: FinancialTransactionType | string;
    category: FinancialTransactionCategory | string;
    description: string;
    status: FinancialTransactionStatus | string;
    reversalOfTransactionId?: number;
    refundOfTransactionId?: number;
  }): Promise<number>;
  insertLedgerEntries(entries: LedgerEntry[], transactionId: number): Promise<void>;
  updateBalanceWithOCC(
    accountId: string,
    assetId: string,
    amount: bigint,
    type: 'debit' | 'credit'
  ): Promise<boolean>;
  updateTransactionStatus(transactionId: number, status: FinancialTransactionStatus | string, expectedVersion?: number): Promise<void>;
  persistOutboxEvent(eventType: string, payload: any): Promise<void>;
}
