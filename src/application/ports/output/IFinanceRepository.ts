import { Result } from '../../../shared/kernel/Result';
import { LedgerEntry } from '../../../domains/finance/entities/LedgerTransaction';
import { FinancialLedgerEntryRecord } from '../../../domains/finance/contracts/FinancialLedgerEntryRecord';

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
export type FinancialAssetStatus = 'active' | 'inactive' | 'suspended';

export type BalanceUpdateResult = 'UPDATED' | 'INSUFFICIENT_BALANCE' | 'OCC_CONFLICT';

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
  getTreasuryAccount(): Promise<Result<FinancialAccountRecord>>;
  getOrCreateUserAccount(userId: number): Promise<Result<FinancialAccountRecord>>;
  getOrCreateOperatingAccount(): Promise<Result<FinancialAccountRecord>>;
  getSystemAccount(accountType: SystemAccountType): Promise<Result<FinancialAccountRecord>>;
  getTreasuryBalance(): Promise<Result<AccountBalanceRecord[]>>;
  getAssetById(assetId: number): Promise<Result<{ id: number; code: string; status: FinancialAssetStatus }>>;

  getTransactionById(transactionId: number): Promise<Result<FinancialTransactionRecord>>;
  getRefundsTotalForTransaction(originalTransactionId: number, assetId: number): Promise<bigint>;

  listTransactions(userId?: number): Promise<Result<FinancialTransactionRecord[]>>;
  getTransactionEntries(transactionId: number): Promise<Result<FinancialLedgerEntryRecord[]>>;

  getIdempotencyRecord(key: string, scope: string): Promise<IdempotencyRecord | null>;
  claimIdempotency(idempotencyKey: string, userId: number | null | undefined, scope: string, requestHash: string): Promise<boolean | IdempotencyClaimResult>;
  completeIdempotency(key: string, scope: string, transactionId: number): Promise<void>;
  insertTransaction(data: {
    userId?: number | null;
    type: FinancialTransactionType;
    category: FinancialTransactionCategory;
    description: string;
    status: FinancialTransactionStatus;
    reversalOfTransactionId?: number;
    refundOfTransactionId?: number;
  }): Promise<number>;
  insertLedgerEntries(entries: LedgerEntry[], transactionId: number): Promise<void>;
  updateBalanceWithOCC(
    accountId: number | string,
    assetId: number | string,
    amount: bigint,
    type: 'debit' | 'credit'
  ): Promise<BalanceUpdateResult>;
  updateTransactionStatus(transactionId: number, status: FinancialTransactionStatus, expectedVersion?: number): Promise<void>;
  persistOutboxEvent(eventType: string, payload: LedgerTransactionCommittedEvent | Record<string, unknown>): Promise<void>;
}
