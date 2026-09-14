import { Money256, parsePositiveSafeIntegerId } from '../value-objects/Money256';
import {
  LedgerEntryDirection,
  isLedgerEntryDirection,
} from '../value-objects/BaseUnits';
import { LedgerImbalanceError } from '../errors/LedgerImbalanceError';
import {
  InvalidLedgerTransactionError,
  InvalidMoneyFormatError,
  InvalidIdentifierError,
} from '../errors/FinancialError';

export type LedgerEntryType = LedgerEntryDirection;

export const FINANCIAL_TRANSACTION_STATUSES = [
  'pending',
  'processing',
  'completed',
  'failed',
  'cancelled',
  'reversed',
] as const;

export type FinancialTransactionStatus = typeof FINANCIAL_TRANSACTION_STATUSES[number];

export function isFinancialTransactionStatus(
  value: unknown
): value is FinancialTransactionStatus {
  return (
    typeof value === 'string' &&
    FINANCIAL_TRANSACTION_STATUSES.includes(value as FinancialTransactionStatus)
  );
}

/**
 * Catálogo de tipos contábeis formalmente conhecidos na arquitetura financeira.
 */
export const KNOWN_FINANCIAL_TRANSACTION_TYPES = [
  'deposit',
  'withdrawal',
  'transfer',
  'payment',
  'refund',
  'fee',
  'reward',
  'yield',
  'conversion',
  'adjustment',
  'reversal',
] as const;

export type FinancialTransactionType = typeof KNOWN_FINANCIAL_TRANSACTION_TYPES[number];
export const FINANCIAL_TRANSACTION_TYPES = KNOWN_FINANCIAL_TRANSACTION_TYPES;

/**
 * Subconjunto de tipos financeiros EFETIVAMENTE SUPORTADOS em produção.
 * 'conversion' está intencionalmente excluído deste subconjunto (FIN-TX-001).
 */
export const SUPPORTED_FINANCIAL_TRANSACTION_TYPES = [
  'deposit',
  'withdrawal',
  'transfer',
  'payment',
  'refund',
  'fee',
  'reward',
  'yield',
  'adjustment',
  'reversal',
] as const;

export type SupportedFinancialTransactionType = typeof SUPPORTED_FINANCIAL_TRANSACTION_TYPES[number];

export function isFinancialTransactionType(
  value: unknown
): value is FinancialTransactionType {
  return (
    typeof value === 'string' &&
    KNOWN_FINANCIAL_TRANSACTION_TYPES.includes(value as FinancialTransactionType)
  );
}

export function isSupportedFinancialTransactionType(
  value: unknown
): value is SupportedFinancialTransactionType {
  return (
    typeof value === 'string' &&
    SUPPORTED_FINANCIAL_TRANSACTION_TYPES.includes(value as SupportedFinancialTransactionType)
  );
}

export const FINANCIAL_TRANSACTION_CATEGORIES = [
  'membership',
  'rwa_yield',
  'grant',
  'operational',
  'payment',
  'trading',
  'withdrawal',
  'deposit',
  'fee',
  'other',
] as const;

export type FinancialTransactionCategory = typeof FINANCIAL_TRANSACTION_CATEGORIES[number];

export function isFinancialTransactionCategory(
  value: unknown
): value is FinancialTransactionCategory {
  return (
    typeof value === 'string' &&
    FINANCIAL_TRANSACTION_CATEGORIES.includes(value as FinancialTransactionCategory)
  );
}

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuidV4(value: unknown): value is string {
  return typeof value === 'string' && UUID_V4_REGEX.test(value.trim());
}

export function normalizeUuidV4(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || !isUuidV4(value)) {
    throw new InvalidIdentifierError(`${fieldName} must be a valid UUID v4.`);
  }
  return value.trim().toLowerCase();
}

function normalizeRequiredText(
  value: unknown,
  fieldName: string,
  maxLength: number
): string {
  if (typeof value !== 'string') {
    throw new InvalidLedgerTransactionError(`${fieldName} must be a string.`);
  }

  const normalized = value.trim().normalize('NFC');

  if (normalized.length === 0) {
    throw new InvalidLedgerTransactionError(`${fieldName} is required.`);
  }

  if (normalized.length > maxLength) {
    throw new InvalidLedgerTransactionError(
      `${fieldName} exceeds maximum length of ${maxLength} characters.`
    );
  }

  if (/[\u0000-\u001F\u007F]/u.test(normalized)) {
    throw new InvalidLedgerTransactionError(
      `${fieldName} contains forbidden control characters.`
    );
  }

  return normalized;
}

export interface LedgerEntryProps {
  id?: string;
  accountId: string;
  amount: Money256;
  type: LedgerEntryDirection;
  description?: string;
}

export class LedgerEntry {
  public readonly id: string;
  public readonly accountId: string;
  public readonly amount: Money256;
  public readonly type: LedgerEntryDirection;
  public readonly description?: string;

  constructor(props: LedgerEntryProps) {
    if (!props || typeof props !== 'object') {
      throw new InvalidLedgerTransactionError('LedgerEntry props must be a valid non-null object.');
    }

    if (props.id !== undefined && props.id !== null) {
      if (typeof props.id !== 'string') {
        throw new InvalidIdentifierError('LedgerEntry id must be a string.');
      }
      const trimmedId = props.id.trim();
      if (
        trimmedId.length === 0 ||
        trimmedId.length > 255 ||
        /[\u0000-\u001F\u007F]/u.test(trimmedId)
      ) {
        throw new InvalidIdentifierError(
          'Invalid LedgerEntry id: must be non-empty string up to 255 characters without control characters.'
        );
      }
      this.id = trimmedId;
    } else {
      this.id = crypto.randomUUID().toLowerCase();
    }

    if (typeof props.accountId !== 'string') {
      throw new InvalidIdentifierError('LedgerEntry accountId is required and must be a string.');
    }

    const trimmedAccountId = props.accountId.trim();
    if (!/^[1-9]\d*$/.test(trimmedAccountId)) {
      throw new InvalidIdentifierError(
        'Invalid LedgerEntry accountId. Must be a positive integer string without signs, spaces or decimals.'
      );
    }

    const numericAccountId = Number(trimmedAccountId);
    if (!Number.isSafeInteger(numericAccountId) || numericAccountId <= 0) {
      throw new InvalidIdentifierError(
        'Invalid LedgerEntry accountId. Out of safe integer range.'
      );
    }

    if (!props.amount) {
      throw new InvalidMoneyFormatError('LedgerEntry amount is required.');
    }

    if (!(props.amount instanceof Money256)) {
      throw new InvalidMoneyFormatError('LedgerEntry amount must be an instance of Money256.');
    }

    if (!props.amount.isPositive()) {
      throw new InvalidMoneyFormatError('LedgerEntry amount must be strictly positive (> 0).');
    }

    if (!isLedgerEntryDirection(props.type)) {
      throw new InvalidLedgerTransactionError(
        `Invalid LedgerEntry direction: "${String(props.type)}". Must be "debit" or "credit".`
      );
    }

    if (props.description !== undefined && props.description !== null) {
      if (typeof props.description !== 'string') {
        throw new InvalidLedgerTransactionError('LedgerEntry description must be a string.');
      }
      const trimmedDesc = props.description.trim().normalize('NFC');
      if (trimmedDesc.length > 255) {
        throw new InvalidLedgerTransactionError('LedgerEntry description exceeds maximum length of 255 characters.');
      }
      if (/[\u0000-\u001F\u007F]/u.test(trimmedDesc)) {
        throw new InvalidLedgerTransactionError('LedgerEntry description contains forbidden control characters.');
      }
      this.description = trimmedDesc.length > 0 ? trimmedDesc : undefined;
    } else {
      this.description = undefined;
    }

    this.accountId = trimmedAccountId;
    this.amount = props.amount;
    this.type = props.type;

    Object.freeze(this);
  }
}

export interface CreateLedgerTransactionProps {
  idempotencyKey: string;
  description: string;
  entries: readonly LedgerEntry[];
  userId?: number | null;
  transactionType: SupportedFinancialTransactionType;
  category: FinancialTransactionCategory;
  reversalOfTransactionId?: number;
  refundOfTransactionId?: number;
}

export interface LedgerTransactionSnapshot {
  publicId: string;
  databaseId: number;
  idempotencyKey: string;
  description: string;
  entries: readonly LedgerEntry[];
  userId: number | null;
  transactionType: FinancialTransactionType;
  category: FinancialTransactionCategory;
  status: FinancialTransactionStatus;
  createdAtEpochMs: number;
  reversalOfTransactionId?: number;
  refundOfTransactionId?: number;
}

export class LedgerTransaction {
  public readonly id: string; // Alias para publicId para compatibilidade de API
  public readonly publicId: string;
  public readonly databaseId?: number;
  public readonly idempotencyKey: string;
  public readonly description: string;
  public readonly entries: ReadonlyArray<LedgerEntry>;
  public readonly userId: number | null;
  public readonly transactionType: FinancialTransactionType;
  public readonly category: FinancialTransactionCategory;
  public readonly status: FinancialTransactionStatus;
  public readonly reversalOfTransactionId?: number;
  public readonly refundOfTransactionId?: number;
  private readonly createdAtEpochMs: number;

  public get createdAt(): Date {
    return new Date(this.createdAtEpochMs);
  }

  private constructor(params: {
    publicId: string;
    databaseId?: number;
    idempotencyKey: string;
    description: string;
    entries: readonly LedgerEntry[];
    userId: number | null;
    transactionType: FinancialTransactionType;
    category: FinancialTransactionCategory;
    status: FinancialTransactionStatus;
    createdAtEpochMs: number;
    reversalOfTransactionId?: number;
    refundOfTransactionId?: number;
  }) {
    this.publicId = params.publicId;
    this.id = params.publicId;
    this.databaseId = params.databaseId;
    this.idempotencyKey = params.idempotencyKey;
    this.description = params.description;
    this.entries = Object.freeze([...params.entries]);
    this.userId = params.userId;
    this.transactionType = params.transactionType;
    this.category = params.category;
    this.status = params.status;
    this.createdAtEpochMs = params.createdAtEpochMs;
    this.reversalOfTransactionId = params.reversalOfTransactionId;
    this.refundOfTransactionId = params.refundOfTransactionId;

    Object.freeze(this);
  }

  /**
   * Factory de Criação de Transação (Nova Transação em Memória).
   * A identidade financeira pública (publicId) é SEMPRE gerada internamente via UUID v4 canônico em lowercase.
   * O timestamp de criação é estritamente derivado do servidor (Date.now()).
   */
  public static create(props: CreateLedgerTransactionProps): LedgerTransaction {
    if (!props || typeof props !== 'object') {
      throw new InvalidLedgerTransactionError('LedgerTransaction creation props must be a valid non-null object.');
    }

    const idempotencyKey = normalizeRequiredText(props.idempotencyKey, 'Idempotency key', 255);
    const description = normalizeRequiredText(props.description, 'Transaction description', 255);

    LedgerTransaction.validateEntriesCollection(props.entries);

    let userId: number | null = null;
    if (props.userId !== undefined && props.userId !== null) {
      userId = parsePositiveSafeIntegerId(props.userId, 'userId');
    }

    if (!isSupportedFinancialTransactionType(props.transactionType)) {
      if (props.transactionType === 'conversion') {
        throw new InvalidLedgerTransactionError(
          'Financial transaction type "conversion" is not supported in the current operational release.'
        );
      }
      throw new InvalidLedgerTransactionError(
        `Invalid or unsupported financial transaction type: "${String(props.transactionType)}".`
      );
    }

    if (!isFinancialTransactionCategory(props.category)) {
      throw new InvalidLedgerTransactionError(
        `Invalid financial transaction category: "${String(props.category)}".`
      );
    }

    const { reversalId, refundId } = LedgerTransaction.validateRelationships(
      props.transactionType,
      props.reversalOfTransactionId,
      props.refundOfTransactionId
    );

    const publicId = crypto.randomUUID().toLowerCase();
    const createdAtEpochMs = Date.now();

    LedgerTransaction.validateDoubleEntry(props.entries);

    return new LedgerTransaction({
      publicId,
      idempotencyKey,
      description,
      entries: props.entries,
      userId,
      transactionType: props.transactionType,
      category: props.category,
      status: 'pending',
      createdAtEpochMs,
      reversalOfTransactionId: reversalId,
      refundOfTransactionId: refundId,
    });
  }

  /**
   * Factory de Reidratação a partir da Persistência (DB -> Domínio).
   * Revalida integralmente a estrutura, IDs físicos, unicidade de lançamentos e partidas dobradas por ativo.
   */
  public static rehydrate(snapshot: LedgerTransactionSnapshot): LedgerTransaction {
    if (!snapshot || typeof snapshot !== 'object') {
      throw new InvalidLedgerTransactionError('LedgerTransaction rehydration snapshot must be a valid non-null object.');
    }

    const publicId = normalizeUuidV4(snapshot.publicId, 'snapshot.publicId');
    const databaseId = parsePositiveSafeIntegerId(snapshot.databaseId, 'databaseId');

    const idempotencyKey = normalizeRequiredText(snapshot.idempotencyKey, 'Idempotency key', 255);
    const description = normalizeRequiredText(snapshot.description, 'Transaction description', 255);

    LedgerTransaction.validateEntriesCollection(snapshot.entries);

    let userId: number | null = null;
    if (snapshot.userId !== undefined && snapshot.userId !== null) {
      userId = parsePositiveSafeIntegerId(snapshot.userId, 'userId');
    }

    if (!isFinancialTransactionType(snapshot.transactionType)) {
      throw new InvalidLedgerTransactionError(
        `Invalid transactionType on rehydration: "${String(snapshot.transactionType)}".`
      );
    }

    if (!isFinancialTransactionCategory(snapshot.category)) {
      throw new InvalidLedgerTransactionError(
        `Invalid category on rehydration: "${String(snapshot.category)}".`
      );
    }

    if (!isFinancialTransactionStatus(snapshot.status)) {
      throw new InvalidLedgerTransactionError(
        `Invalid status on rehydration: "${String(snapshot.status)}".`
      );
    }

    const { reversalId, refundId } = LedgerTransaction.validateRelationships(
      snapshot.transactionType,
      snapshot.reversalOfTransactionId,
      snapshot.refundOfTransactionId
    );

    if (
      typeof snapshot.createdAtEpochMs !== 'number' ||
      !Number.isFinite(snapshot.createdAtEpochMs) ||
      snapshot.createdAtEpochMs <= 0
    ) {
      throw new InvalidLedgerTransactionError('Invalid createdAtEpochMs on rehydration.');
    }

    LedgerTransaction.validateDoubleEntry(snapshot.entries);

    return new LedgerTransaction({
      publicId,
      databaseId,
      idempotencyKey,
      description,
      entries: snapshot.entries,
      userId,
      transactionType: snapshot.transactionType,
      category: snapshot.category,
      status: snapshot.status,
      createdAtEpochMs: snapshot.createdAtEpochMs,
      reversalOfTransactionId: reversalId,
      refundOfTransactionId: refundId,
    });
  }

  private static validateEntriesCollection(entries: readonly LedgerEntry[]): void {
    if (!entries || !Array.isArray(entries) || entries.length < 2) {
      throw new InvalidLedgerTransactionError('Transaction must contain at least two entries.');
    }

    if (entries.length > 100) {
      throw new InvalidLedgerTransactionError('Transaction exceeds maximum limit of 100 entries.');
    }

    const hasDebit = entries.some((e) => e.type === 'debit');
    const hasCredit = entries.some((e) => e.type === 'credit');
    if (!hasDebit || !hasCredit) {
      throw new InvalidLedgerTransactionError(
        'Transaction must contain at least one debit and one credit entry.'
      );
    }

    const seenEntryIds = new Set<string>();
    for (const entry of entries) {
      if (!(entry instanceof LedgerEntry)) {
        throw new InvalidLedgerTransactionError('All entries must be valid instances of LedgerEntry.');
      }

      if (seenEntryIds.has(entry.id)) {
        throw new InvalidLedgerTransactionError(
          'Transaction cannot contain duplicate ledger entry IDs.'
        );
      }
      seenEntryIds.add(entry.id);
    }
  }

  private static validateRelationships(
    type: FinancialTransactionType,
    reversalId?: number,
    refundId?: number
  ): { reversalId?: number; refundId?: number } {
    if (type === 'reversal') {
      if (reversalId === undefined || reversalId === null) {
        throw new InvalidLedgerTransactionError('Reversal transaction requires reversalOfTransactionId.');
      }
      const validatedReversalId = parsePositiveSafeIntegerId(reversalId, 'reversalOfTransactionId');
      if (refundId !== undefined && refundId !== null) {
        throw new InvalidLedgerTransactionError('Reversal transaction cannot have refundOfTransactionId.');
      }
      return { reversalId: validatedReversalId };
    }

    if (type === 'refund') {
      if (refundId === undefined || refundId === null) {
        throw new InvalidLedgerTransactionError('Refund transaction requires refundOfTransactionId.');
      }
      const validatedRefundId = parsePositiveSafeIntegerId(refundId, 'refundOfTransactionId');
      if (reversalId !== undefined && reversalId !== null) {
        throw new InvalidLedgerTransactionError('Refund transaction cannot have reversalOfTransactionId.');
      }
      return { refundId: validatedRefundId };
    }

    if (reversalId !== undefined && reversalId !== null) {
      throw new InvalidLedgerTransactionError(
        `reversalOfTransactionId is only valid for reversal transactions, got "${type}".`
      );
    }

    if (refundId !== undefined && refundId !== null) {
      throw new InvalidLedgerTransactionError(
        `refundOfTransactionId is only valid for refund transactions, got "${type}".`
      );
    }

    return {};
  }

  /**
   * INVARIANTE FIN-001: Double-Entry Balance Verification per Asset
   * Para cada ativo: SUM(debits) === SUM(credits).
   */
  private static validateDoubleEntry(entries: readonly LedgerEntry[]): void {
    const balances = new Map<number, bigint>();

    for (const entry of entries) {
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
          `Double-entry validation failed for asset #${assetId}: Debits and Credits do not balance (Diff: ${balance.toString()}).`
        );
      }
    }
  }
}
