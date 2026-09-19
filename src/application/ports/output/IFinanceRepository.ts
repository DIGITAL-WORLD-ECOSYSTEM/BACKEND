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
