import { Result } from '../../../shared/kernel/Result';

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
  getTreasuryBalance(): Promise<Result<AccountBalanceRecord[]>>;
  createTransaction(data: {
    userId?: number | null;
    type: 'deposit' | 'withdrawal' | 'transfer' | 'payment' | 'refund' | 'fee' | 'reward' | 'yield' | 'conversion' | 'adjustment';
    category?: string;
    description: string;
    amountBaseUnits: string;
    assetId: number;
  }): Promise<Result<FinancialTransactionRecord>>;
  listTransactions(userId?: number): Promise<Result<FinancialTransactionRecord[]>>;
}
