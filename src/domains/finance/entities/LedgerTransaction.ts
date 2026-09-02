import { Money256 } from '../value-objects/Money256';
import { LedgerImbalanceError } from '../errors/LedgerImbalanceError';

export type LedgerEntryType = 'debit' | 'credit';

export type FinancialTransactionStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'reversed'
  | 'refunded';

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

export interface LedgerEntryProps {
  id?: string;
  accountId: string;
  amount: Money256;
  type: LedgerEntryType;
  description?: string;
}

export class LedgerEntry {
  public readonly id: string;
  public readonly accountId: string;
  public readonly amount: Money256;
  public readonly type: LedgerEntryType;
  public readonly description?: string;

  constructor(props: LedgerEntryProps) {
    if (!props.accountId || props.accountId.trim().length === 0) {
      throw new Error('LedgerEntry accountId is required');
    }

    if (!this.isValidAccountId(props.accountId)) {
      throw new Error(`Invalid LedgerEntry accountId: ${props.accountId}`);
    }

    if (!props.amount) {
      throw new Error('LedgerEntry amount is required');
    }

    if (!props.amount.isPositive()) {
      throw new Error('LedgerEntry amount must be strictly positive');
    }

    this.id = props.id || crypto.randomUUID();
    this.accountId = props.accountId;
    this.amount = props.amount;
    this.type = props.type;
    this.description = props.description;
  }

  private isValidAccountId(accountId: string): boolean {
    return /^\d+$/.test(accountId);
  }
}

export interface LedgerTransactionProps {
  id?: string;
  idempotencyKey: string;
  description: string;
  entries: ReadonlyArray<LedgerEntry>;
  userId?: number | null;
  transactionType?: FinancialTransactionType;
  category?: FinancialTransactionCategory;
  status?: FinancialTransactionStatus;
  reversalOfTransactionId?: number;
  refundOfTransactionId?: number;
  createdAt?: Date;
}

export class LedgerTransaction {
  public readonly id: string;
  public readonly idempotencyKey: string;
  public readonly description: string;
  public readonly entries: ReadonlyArray<LedgerEntry>;
  public readonly userId: number | null;
  public readonly transactionType: FinancialTransactionType;
  public readonly category?: FinancialTransactionCategory;
  public readonly status: FinancialTransactionStatus;
  public readonly reversalOfTransactionId?: number;
  public readonly refundOfTransactionId?: number;
  public readonly createdAt: Date;

  constructor(props: LedgerTransactionProps) {
    if (!props.idempotencyKey || props.idempotencyKey.trim().length === 0) {
      throw new Error('Idempotency key is required');
    }

    if (props.idempotencyKey.length > 255) {
      throw new Error('Idempotency key exceeds maximum length of 255 characters');
    }

    if (!props.description || props.description.trim().length === 0) {
      throw new Error('Transaction description is required');
    }

    if (!props.entries || props.entries.length < 2) {
      throw new Error('Transaction must have at least two entries');
    }

    if (
      props.userId !== null &&
      props.userId !== undefined &&
      (!Number.isSafeInteger(props.userId) || props.userId <= 0)
    ) {
      throw new Error(`Invalid userId: ${props.userId}`);
    }

    this.id = props.id || crypto.randomUUID();
    this.idempotencyKey = props.idempotencyKey;
    this.description = props.description;
    this.entries = Object.freeze([...props.entries]);
    this.userId = props.userId ?? null;
    this.transactionType = props.transactionType ?? 'adjustment';
    this.category = props.category;
    this.status = props.status ?? 'pending';
    this.reversalOfTransactionId = props.reversalOfTransactionId;
    this.refundOfTransactionId = props.refundOfTransactionId;
    this.createdAt = props.createdAt ?? new Date();

    this.validateDoubleEntry();
  }

  /**
   * INVARIANTE FIN-001: Double-Entry Ledger
   *
   * Para cada ativo:
   * SUM(debits) === SUM(credits)
   *
   * A validação ocorre no domínio antes que o agregado possa
   * ser utilizado pelo pipeline de persistência.
   */
  private validateDoubleEntry(): void {
    const balances = new Map<number, bigint>();

    for (const entry of this.entries) {
      const assetId = entry.amount.assetId;
      const currentBalance = balances.get(assetId) ?? 0n;

      if (entry.type === 'debit') {
        balances.set(assetId, currentBalance + entry.amount.amount);
      } else {
        balances.set(assetId, currentBalance - entry.amount.amount);
      }
    }

    for (const [assetId, balance] of balances.entries()) {
      if (balance !== 0n) {
        throw new LedgerImbalanceError(
          `Double-entry validation failed for asset #${assetId}: ` +
          `Debits and Credits do not balance (Diff: ${balance.toString()})`
        );
      }
    }
  }
}
