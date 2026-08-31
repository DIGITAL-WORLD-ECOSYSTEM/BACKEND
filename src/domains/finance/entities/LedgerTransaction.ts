import { Money } from './Money';
import { LedgerImbalanceError } from '../errors/LedgerImbalanceError';

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
  userId?: number | null;
  transactionType?: string;
  category?: string;
  status?: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'reversed';
  createdAt?: Date;
}

export class LedgerTransaction {
  public readonly id: string;
  public readonly idempotencyKey: string;
  public readonly description: string;
  public readonly entries: LedgerEntry[];
  public readonly userId: number | null;
  public readonly transactionType: string;
  public readonly category?: string;
  public readonly status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'reversed';
  public readonly createdAt: Date;

  constructor(props: LedgerTransactionProps) {
    this.id = props.id || crypto.randomUUID();
    this.idempotencyKey = props.idempotencyKey;
    this.description = props.description;
    this.entries = props.entries;
    this.userId = props.userId ?? null;
    this.transactionType = props.transactionType ?? 'adjustment';
    this.category = props.category;
    this.status = props.status || 'pending';
    this.createdAt = props.createdAt || new Date();

    this.validateDoubleEntry();
  }

  /**
   * Fábrica de Domínio Canônica para Movimentações de Tesouraria
   */
  static createTreasuryMovement(props: {
    direction: 'INBOUND' | 'OUTBOUND';
    treasuryAccountId: number;
    userAccountId: number;
    amount: Money;
    category?: string;
    type: string;
    description: string;
    idempotencyKey: string;
    userId?: number | null;
  }): LedgerTransaction {
    const entries: LedgerEntry[] = [];
    const treasuryIdStr = String(props.treasuryAccountId);
    const userIdStr = String(props.userAccountId);

    if (props.direction === 'INBOUND') {
      // INBOUND: User Account (Liability) -> CREDIT (aumenta saldo do usuário)
      // Tesouraria (Asset) -> DEBIT (aumenta saldo da tesouraria)
      entries.push(new LedgerEntry({ accountId: userIdStr, amount: props.amount, type: 'credit', description: props.description }));
      entries.push(new LedgerEntry({ accountId: treasuryIdStr, amount: props.amount, type: 'debit', description: 'Treasury receipt' }));
    } else {
      // OUTBOUND: User Account (Liability) -> DEBIT (reduz saldo do usuário)
      // Tesouraria (Asset) -> CREDIT (reduz saldo da tesouraria)
      entries.push(new LedgerEntry({ accountId: userIdStr, amount: props.amount, type: 'debit', description: props.description }));
      entries.push(new LedgerEntry({ accountId: treasuryIdStr, amount: props.amount, type: 'credit', description: 'Treasury release' }));
    }

    return new LedgerTransaction({
      idempotencyKey: props.idempotencyKey,
      description: props.description,
      userId: props.userId ?? null,
      transactionType: props.type,
      category: props.category,
      entries,
    });
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
        throw new LedgerImbalanceError(`Double-entry validation failed for asset ${assetId}: Debits and Credits do not balance (Diff: ${balance.toString()})`);
      }
    }
  }
}
