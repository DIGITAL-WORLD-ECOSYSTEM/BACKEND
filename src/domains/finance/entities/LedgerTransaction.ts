import { Money } from './Money';

export interface LedgerEntryProps {
  id?: string;
  accountId: string;
  amount: Money;
  type: 'debit' | 'credit';
  description?: string;
}

export class LedgerEntry {
  public readonly id: string;
  public readonly accountId: string;
  public readonly amount: Money;
  public readonly type: 'debit' | 'credit';
  public readonly description?: string;

  constructor(props: LedgerEntryProps) {
    this.id = props.id || crypto.randomUUID();
    this.accountId = props.accountId;
    this.amount = props.amount;
    this.type = props.type;
    this.description = props.description;

    if (!this.amount.isPositive()) {
      throw new Error('LedgerEntry amount must be strictly positive');
    }
  }
}

export interface LedgerTransactionProps {
  id?: string;
  idempotencyKey: string;
  description: string;
  entries: LedgerEntry[];
  status?: 'pending' | 'committed' | 'failed';
  createdAt?: Date;
}

export class LedgerTransaction {
  public readonly id: string;
  public readonly idempotencyKey: string;
  public readonly description: string;
  public readonly entries: LedgerEntry[];
  public readonly status: 'pending' | 'committed' | 'failed';
  public readonly createdAt: Date;

  constructor(props: LedgerTransactionProps) {
    this.id = props.id || crypto.randomUUID();
    this.idempotencyKey = props.idempotencyKey;
    this.description = props.description;
    this.entries = props.entries;
    this.status = props.status || 'pending';
    this.createdAt = props.createdAt || new Date();

    this.validateDoubleEntry();
  }

  /**
   * INVARIANTE: Double-Entry Ledger
   * A soma dos débitos deve ser exatamente igual à soma dos créditos, agrupados por ativo.
   */
  private validateDoubleEntry() {
    if (this.entries.length < 2) {
      throw new Error('Transaction must have at least two entries');
    }

    const balances = new Map<string, bigint>();

    for (const entry of this.entries) {
      const assetId = entry.amount.assetId;
      const currentBalance = balances.get(assetId) || 0n;

      if (entry.type === 'debit') {
        balances.set(assetId, currentBalance + entry.amount.amount);
      } else {
        balances.set(assetId, currentBalance - entry.amount.amount);
      }
    }

    for (const [assetId, balance] of balances.entries()) {
      if (balance !== 0n) {
        throw new Error(`Double-entry validation failed for asset ${assetId}: Debits and Credits do not balance (Diff: ${balance.toString()})`);
      }
    }
  }
}
