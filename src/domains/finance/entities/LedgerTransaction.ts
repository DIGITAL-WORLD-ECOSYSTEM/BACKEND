import {
  Money256,
  parsePositiveSafeIntegerId,
} from '../value-objects/Money256';

import {
  MAX_UINT256,
  MAX_LEDGER_ENTRIES,
  MAX_LEDGER_DESCRIPTION_LENGTH,
  MAX_IDEMPOTENCY_KEY_LENGTH,
  MAX_RAW_TEXT_CEILING,
} from '../constants/FinancialLimits';

import {
  type LedgerEntryDirection,
  isLedgerEntryDirection,
} from '../value-objects/BaseUnits';

import {
  FinancialTransactionStatus,
  FINANCIAL_TRANSACTION_STATUSES,
  isFinancialTransactionStatus,
} from '../value-objects/FinancialTransactionStatus';

import {
  FinancialTextPolicy,
  DANGEROUS_TEXT_CHARACTERS_REGEX,
} from '../policies/FinancialTextPolicy';

import { LedgerImbalanceError } from '../errors/LedgerImbalanceError';

import {
  InvalidLedgerTransactionError,
  InvalidMoneyFormatError,
  InvalidIdentifierError,
} from '../errors/FinancialError';

export {
  FINANCIAL_TRANSACTION_STATUSES,
  isFinancialTransactionStatus,
  type FinancialTransactionStatus,
};

/**
 * Limite máximo suportado pelo objeto Date do JavaScript.
 *
 * O timestamp é armazenado internamente como integer epoch milliseconds.
 */
const MAX_VALID_DATE_EPOCH_MS = 8_640_000_000_000_000;

/**
 * ============================================================
 * TIPOS FINANCEIROS CONHECIDOS
 * ============================================================
 *
 * KNOWN:
 * tudo que a arquitetura reconhece historicamente/conceitualmente.
 *
 * SUPPORTED:
 * aquilo que pode ser criado pela release operacional atual.
 *
 * IMPORTANTE:
 * "conversion" é conhecido, mas não suportado para criação.
 */
export const KNOWN_FINANCIAL_TRANSACTION_TYPES = Object.freeze([
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
] as const);

export type FinancialTransactionType =
  (typeof KNOWN_FINANCIAL_TRANSACTION_TYPES)[number];

/**
 * Alias de compatibilidade com consumidores existentes.
 *
 * Mantido congelado para evitar mutação acidental em runtime.
 */
export const FINANCIAL_TRANSACTION_TYPES =
  KNOWN_FINANCIAL_TRANSACTION_TYPES;

/**
 * Subconjunto efetivamente permitido para criação de
 * novas transações na release operacional atual.
 */
export const SUPPORTED_FINANCIAL_TRANSACTION_TYPES = Object.freeze([
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
] as const);

export type SupportedFinancialTransactionType =
  (typeof SUPPORTED_FINANCIAL_TRANSACTION_TYPES)[number];

export function isFinancialTransactionType(
  value: unknown
): value is FinancialTransactionType {
  return (
    typeof value === 'string' &&
    KNOWN_FINANCIAL_TRANSACTION_TYPES.includes(
      value as FinancialTransactionType
    )
  );
}

export function isSupportedFinancialTransactionType(
  value: unknown
): value is SupportedFinancialTransactionType {
  return (
    typeof value === 'string' &&
    SUPPORTED_FINANCIAL_TRANSACTION_TYPES.includes(
      value as SupportedFinancialTransactionType
    )
  );
}

/**
 * ============================================================
 * CATEGORIAS
 * ============================================================
 */

export const FINANCIAL_TRANSACTION_CATEGORIES = Object.freeze([
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
] as const);

export type FinancialTransactionCategory =
  (typeof FINANCIAL_TRANSACTION_CATEGORIES)[number];

export function isFinancialTransactionCategory(
  value: unknown
): value is FinancialTransactionCategory {
  return (
    typeof value === 'string' &&
    FINANCIAL_TRANSACTION_CATEGORIES.includes(
      value as FinancialTransactionCategory
    )
  );
}

/**
 * ============================================================
 * UUID V4
 * ============================================================
 */

const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Verifica somente o formato UUID v4.
 *
 * A função aceita whitespace externo para facilitar o tratamento
 * de input de borda; a forma canônica deve ser obtida via
 * normalizeUuidV4().
 */
export function isUuidV4(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    UUID_V4_REGEX.test(value.trim())
  );
}

/**
 * Normaliza UUID para forma canônica:
 * - string obrigatória
 * - UUID v4
 * - trim
 * - lowercase
 */
export function normalizeUuidV4(
  value: unknown,
  fieldName: string
): string {
  if (typeof value !== 'string') {
    throw new InvalidIdentifierError(
      `${fieldName} must be a valid UUID v4.`
    );
  }

  const normalized = value.trim().toLowerCase();

  if (!UUID_V4_REGEX.test(normalized)) {
    throw new InvalidIdentifierError(
      `${fieldName} must be a valid UUID v4.`
    );
  }

  return normalized;
}

/**
 * ============================================================
 * NORMALIZAÇÃO DE TEXTO
 * ============================================================
 *
 * A função:
 * - rejeita tipos não-string
 * - remove whitespace externo
 * - normaliza Unicode NFC
 * - rejeita string vazia
 * - limita tamanho
 * - bloqueia caracteres de controle
 */
function normalizeRequiredText(
  value: unknown,
  fieldName: string,
  maxLength: number = MAX_LEDGER_DESCRIPTION_LENGTH
): string {
  if (typeof value !== 'string') {
    throw new InvalidLedgerTransactionError(
      `${fieldName} must be a string.`
    );
  }

  if (value.length > MAX_RAW_TEXT_CEILING) {
    throw new InvalidLedgerTransactionError(
      `${fieldName} length exceeds raw ceiling of ${MAX_RAW_TEXT_CEILING}.`
    );
  }

  const normalized = value.trim().normalize('NFC');

  if (normalized.length === 0) {
    throw new InvalidLedgerTransactionError(
      `${fieldName} is required.`
    );
  }

  if (normalized.length > maxLength) {
    throw new InvalidLedgerTransactionError(
      `${fieldName} exceeds maximum length of ${maxLength} characters.`
    );
  }

  if (DANGEROUS_TEXT_CHARACTERS_REGEX.test(normalized)) {
    throw new InvalidLedgerTransactionError(
      `${fieldName} contains forbidden control characters.`
    );
  }

  return normalized;
}

function validateStrictIdempotencyKey(value: unknown): string {
  if (typeof value !== 'string') {
    throw new InvalidLedgerTransactionError('Idempotency key must be a string.');
  }

  if (value.length > MAX_RAW_TEXT_CEILING) {
    throw new InvalidLedgerTransactionError(
      `Idempotency key length exceeds raw ceiling of ${MAX_RAW_TEXT_CEILING}.`
    );
  }

  if (value.trim().length === 0) {
    throw new InvalidLedgerTransactionError('Idempotency key is required.');
  }

  if (value.length > 255) {
    throw new InvalidLedgerTransactionError('Idempotency key exceeds maximum length of 255 characters.');
  }

  if (DANGEROUS_TEXT_CHARACTERS_REGEX.test(value)) {
    throw new InvalidLedgerTransactionError('Idempotency key contains forbidden control characters.');
  }

  if (value !== value.trim()) {
    throw new InvalidLedgerTransactionError('Idempotency key must not contain leading or trailing whitespace.');
  }

  return value;
}

/**
 * Identificador opaco utilizado por LedgerEntry.
 *
 * Não é tratado como UUID obrigatório porque o ID de entry pode ser
 * um identificador de persistência/integração.
 */
function normalizeOptionalOpaqueIdentifier(
  value: unknown
): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== 'string') {
    throw new InvalidIdentifierError(
      'LedgerEntry id must be a string.'
    );
  }

  if (
    value.length === 0 ||
    value.length > 255 ||
    DANGEROUS_TEXT_CHARACTERS_REGEX.test(value)
  ) {
    throw new InvalidIdentifierError(
      'Invalid LedgerEntry id.'
    );
  }

  if (value !== value.trim()) {
    throw new InvalidIdentifierError(
      'Invalid LedgerEntry id.'
    );
  }

  return value;
}

/**
 * ============================================================
 * LEDGER ENTRY
 * ============================================================
 */

export type LedgerEntryType = LedgerEntryDirection;

export interface LedgerEntryProps {
  id?: string;
  accountId: string | number;
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
      throw new InvalidLedgerTransactionError(
        'LedgerEntry props must be a valid non-null object.'
      );
    }

    /**
     * --------------------------------------------------------
     * Entry ID
     * --------------------------------------------------------
     */
    const normalizedProvidedId =
      normalizeOptionalOpaqueIdentifier(props.id);

    this.id =
      normalizedProvidedId ??
      crypto.randomUUID().toLowerCase();

    /**
     * --------------------------------------------------------
     * Account ID
     * --------------------------------------------------------
     *
     * Validação canônica estrita (/^[1-9]\d*$/ ou safe positive int).
     * Armazenado como string canônica na entidade.
     */
    const numericAccountId = parsePositiveSafeIntegerId(
      props.accountId,
      'accountId'
    );
    this.accountId = numericAccountId.toString(10);

    /**
     * --------------------------------------------------------
     * Money256
     * --------------------------------------------------------
     */
    if (!props.amount) {
      throw new InvalidMoneyFormatError(
        'LedgerEntry amount is required.'
      );
    }

    if (!(props.amount instanceof Money256)) {
      throw new InvalidMoneyFormatError(
        'LedgerEntry amount must be an instance of Money256.'
      );
    }

    if (!props.amount.isPositive()) {
      throw new InvalidMoneyFormatError(
        'LedgerEntry amount must be strictly positive (> 0).'
      );
    }

    /**
     * --------------------------------------------------------
     * Direction
     * --------------------------------------------------------
     */
    if (!isLedgerEntryDirection(props.type)) {
      throw new InvalidLedgerTransactionError(
        'Invalid LedgerEntry direction. Must be "debit" or "credit".'
      );
    }

    /**
     * --------------------------------------------------------
     * Description opcional
     * --------------------------------------------------------
     */
    let normalizedDescription: string | undefined;

    if (
      props.description !== undefined &&
      props.description !== null
    ) {
      if (typeof props.description !== 'string') {
        throw new InvalidLedgerTransactionError(
          'LedgerEntry description must be a string.'
        );
      }

      const candidate = props.description
        .trim()
        .normalize('NFC');

      if (candidate.length > 255) {
        throw new InvalidLedgerTransactionError(
          'LedgerEntry description exceeds maximum length of 255 characters.'
        );
      }

      if (DANGEROUS_TEXT_CHARACTERS_REGEX.test(candidate)) {
        throw new InvalidLedgerTransactionError(
          'LedgerEntry description contains forbidden control characters.'
        );
      }

      normalizedDescription =
        candidate.length > 0 ? candidate : undefined;
    }

    this.amount = props.amount;
    this.type = props.type;
    this.description = normalizedDescription;

    /**
     * Garante imutabilidade estrutural em runtime.
     *
     * A imutabilidade do Money256 é responsabilidade do próprio VO.
     */
    Object.freeze(this);
  }
}

/**
 * ============================================================
 * CREATE CONTRACT
 * ============================================================
 *
 * Importante:
 * publicId NÃO é aceito pelo caller.
 * A identidade pública é sempre gerada pela própria entidade.
 *
 * createdAt também não é aceito pelo caller.
 * O timestamp é sempre gerado pelo servidor.
 */
export interface CreateLedgerTransactionProps {
  idempotencyKey: string;
  description: string;
  entries: readonly LedgerEntry[];
  userId?: number | null;
  transactionType: SupportedFinancialTransactionType;
  category: FinancialTransactionCategory;
  reversalOfTransactionId?: number | string;
  refundOfTransactionId?: number | string;
  businessReason?: string;
  auditRef?: string;
  source?: string;
  destination?: string;
  providerId?: string;
  externalEventId?: string;
  feeType?: string;
  actorUserId?: number | null;
  authorizedByUserId?: number | null;
  sourceType?: string | null;
  sourceId?: string | null;
  correlationId?: string | null;
  scope?: string | null;
}

/**
 * ============================================================
 * PERSISTENCE SNAPSHOT
 * ============================================================
 *
 * O snapshot contém metadados específicos de persistência.
 */
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
  businessReason?: string;
  auditRef?: string;
  source?: string;
  destination?: string;
  providerId?: string;
  externalEventId?: string;
  feeType?: string;
  actorUserId?: number | null;
  authorizedByUserId?: number | null;
  sourceType?: string | null;
  sourceId?: string | null;
  correlationId?: string | null;
  scope?: string | null;
}

/**
 * ============================================================
 * LEDGER TRANSACTION
 * ============================================================
 */

export class LedgerTransaction {
  /**
   * Mantido como alias de compatibilidade com consumidores existentes.
   *
   * Preferir publicId em novo código.
   *
   * @deprecated Use publicId.
   */
  public readonly id: string;

  public readonly publicId: string;

  /**
   * Mantido temporariamente por compatibilidade com a infraestrutura
   * atual. Idealmente deve ficar apenas no Snapshot/Repository.
   *
   * @deprecated Persistence identity não deve fazer parte da API
   * de domínio em uma futura separação de bounded context.
   */
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
  public readonly businessReason?: string;
  public readonly auditRef?: string;
  public readonly source?: string;
  public readonly destination?: string;
  public readonly providerId?: string;
  public readonly externalEventId?: string;
  public readonly feeType?: string;
  public readonly actorUserId?: number | null;
  public readonly authorizedByUserId?: number | null;
  public readonly sourceType?: string | null;
  public readonly sourceId?: string | null;
  public readonly correlationId?: string | null;
  public readonly scope?: string | null;

  private readonly createdAtEpochMs: number;

  /**
   * Getter defensivo.
   *
   * Cada chamada devolve uma nova Date e não expõe o estado interno.
   */
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
    businessReason?: string;
    auditRef?: string;
    source?: string;
    destination?: string;
    providerId?: string;
    externalEventId?: string;
    feeType?: string;
    actorUserId?: number | null;
    authorizedByUserId?: number | null;
    sourceType?: string | null;
    sourceId?: string | null;
    correlationId?: string | null;
    scope?: string | null;
  }) {
    this.publicId = params.publicId;
    this.id = params.publicId;
    this.databaseId = params.databaseId;
    this.idempotencyKey = params.idempotencyKey;
    this.description = params.description;

    /**
     * Cópia defensiva + congelamento do array.
     *
     * Os LedgerEntry já são imutáveis individualmente.
     */
    this.entries = Object.freeze([...params.entries]);

    this.userId = params.userId;
    this.transactionType = params.transactionType;
    this.category = params.category;
    this.status = params.status;
    this.createdAtEpochMs = params.createdAtEpochMs;
    this.reversalOfTransactionId = params.reversalOfTransactionId;
    this.refundOfTransactionId = params.refundOfTransactionId;
    this.businessReason = params.businessReason;
    this.auditRef = params.auditRef;
    this.source = params.source;
    this.destination = params.destination;
    this.providerId = params.providerId;
    this.externalEventId = params.externalEventId;
    this.feeType = params.feeType;
    this.actorUserId = params.actorUserId ?? null;
    this.authorizedByUserId = params.authorizedByUserId ?? null;
    this.sourceType = params.sourceType ?? null;
    this.sourceId = params.sourceId ?? null;
    this.correlationId = params.correlationId ?? null;
    this.scope = params.scope ?? null;

    /**
     * Congelamento do Aggregate Root.
     */
    Object.freeze(this);
  }

  /**
   * ==========================================================
   * FACTORY: CREATE
   * ==========================================================
   *
   * Cria uma nova transação.
   *
   * Invariantes desta factory:
   * - identidade gerada internamente
   * - timestamp gerado internamente
   * - status inicial = pending
   * - tipo deve ser suportado
   * - entries devem ser válidos
   * - double-entry balanceado
   */
  public static create(
    props: CreateLedgerTransactionProps
  ): LedgerTransaction {
    if (!props || typeof props !== 'object') {
      throw new InvalidLedgerTransactionError(
        'LedgerTransaction creation props must be a valid non-null object.'
      );
    }

    const idempotencyKey = validateStrictIdempotencyKey(
      props.idempotencyKey
    );

    const description = normalizeRequiredText(
      props.description,
      'Transaction description',
      MAX_LEDGER_DESCRIPTION_LENGTH
    );

    LedgerTransaction.validateEntriesCollection(
      props.entries
    );

    let userId: number | null = null;

    if (
      props.userId !== undefined &&
      props.userId !== null
    ) {
      userId = parsePositiveSafeIntegerId(
        props.userId,
        'userId'
      );
    }

    /**
     * A interface já utiliza SupportedFinancialTransactionType.
     *
     * A validação runtime continua obrigatória porque a entrada pode
     * ter atravessado JSON/DTO/any antes de chegar aqui.
     */
    const rawTransactionType: unknown =
      props.transactionType;

    if (
      !isSupportedFinancialTransactionType(
        rawTransactionType
      )
    ) {
      throw new InvalidLedgerTransactionError(
        'Invalid or unsupported financial transaction type.'
      );
    }

    const transactionType = rawTransactionType;

    const category = props.category === undefined ? 'operational' : props.category;
    if (!isFinancialTransactionCategory(category)) {
      throw new InvalidLedgerTransactionError(
        'Invalid financial transaction category.'
      );
    }

    /**
     * Verifica somente invariantes relacionais locais.
     *
     * Existência, ownership, estado original, limite cumulativo
     * de refund e unicidade de reversal são responsabilidade
     * de RefundPolicy/ReversalPolicy + persistência autoritativa.
     */
    const {
      reversalId,
      refundId,
    } = LedgerTransaction.validateRelationships(
      transactionType,
      props.reversalOfTransactionId,
      props.refundOfTransactionId
    );

    // Invariante relacional: Bloqueia auto-referência explícita se o ID for conhecido
    const explicitId = (props as any).id ?? (props as any).databaseId;
    if (explicitId !== undefined && explicitId !== null) {
      const explicitStr =
        typeof explicitId === 'number'
          ? explicitId.toString(10)
          : typeof explicitId === 'string'
            ? explicitId
            : null;
      if (explicitStr !== null) {
        if (reversalId !== undefined && reversalId.toString(10) === explicitStr) {
          throw new InvalidLedgerTransactionError('A transaction cannot reverse itself.');
        }
        if (refundId !== undefined && refundId.toString(10) === explicitStr) {
          throw new InvalidLedgerTransactionError('A transaction cannot refund itself.');
        }
      }
    }

    /**
     * Identidade pública criada internamente.
     */
    const publicId = crypto
      .randomUUID()
      .toLowerCase();

    /**
     * Tempo criado exclusivamente pelo servidor.
     */
    const createdAtEpochMs = Date.now();

    LedgerTransaction.validateCreatedAtEpochMs(
      createdAtEpochMs,
      'createdAtEpochMs'
    );

    /**
     * Validação contábil final e cardinalidade de ativos.
     */
    LedgerTransaction.validateDoubleEntry(
      props.entries
    );

    LedgerTransaction.validateAssetCardinality(
      transactionType,
      props.entries
    );

    // Invariante relacional: businessReason (undefined -> ausência, '' -> inválido)
    let businessReason: string | undefined = undefined;
    if (props.businessReason !== undefined) {
      if (typeof props.businessReason !== 'string' || props.businessReason.trim().length === 0) {
        throw new InvalidLedgerTransactionError(
          'businessReason when provided must be a non-empty string.'
        );
      }
      businessReason = props.businessReason.trim();
    }

    if (transactionType === 'adjustment' && businessReason === undefined) {
      throw new InvalidLedgerTransactionError(
        'Adjustment transaction requires a businessReason.'
      );
    }

    // Invariante de paridade entre providerId e externalEventId
    let providerId: string | undefined = undefined;
    if (props.providerId !== undefined) {
      if (typeof props.providerId !== 'string' || props.providerId.trim().length === 0) {
        throw new InvalidLedgerTransactionError(
          'providerId when provided must be a non-empty string.'
        );
      }
      providerId = props.providerId.trim();
    }

    let externalEventId: string | undefined = undefined;
    if (props.externalEventId !== undefined) {
      if (typeof props.externalEventId !== 'string' || props.externalEventId.trim().length === 0) {
        throw new InvalidLedgerTransactionError(
          'externalEventId when provided must be a non-empty string.'
        );
      }
      externalEventId = props.externalEventId.trim();
    }

    const hasProviderId = providerId !== undefined;
    const hasExternalEventId = externalEventId !== undefined;

    if ((hasProviderId && !hasExternalEventId) || (!hasProviderId && hasExternalEventId)) {
      throw new InvalidLedgerTransactionError(
        'providerId and externalEventId must either both be provided or both be omitted.'
      );
    }

    return new LedgerTransaction({
      publicId,
      idempotencyKey,
      description,
      entries: props.entries,
      userId,
      transactionType,
      category,
      status: 'pending',
      createdAtEpochMs,
      reversalOfTransactionId: reversalId,
      refundOfTransactionId: refundId,
      businessReason,
      auditRef: props.auditRef,
      source: props.source,
      destination: props.destination,
      providerId,
      externalEventId,
      feeType: props.feeType,
      actorUserId: props.actorUserId,
      authorizedByUserId: props.authorizedByUserId,
      sourceType: props.sourceType,
      sourceId: props.sourceId,
      correlationId: props.correlationId,
      scope: props.scope,
    });
  }

  /**
   * ==========================================================
   * FACTORY: REHYDRATE
   * ==========================================================
   *
   * DB -> Domain.
   *
   * Revalida:
   * - identidade
   * - IDs físicos
   * - strings
   * - entries
   * - unicidade
   * - enums
   * - relações
   * - timestamp
   * - double-entry
   */
  public static rehydrate(
    snapshot: LedgerTransactionSnapshot
  ): LedgerTransaction {
    if (!snapshot || typeof snapshot !== 'object') {
      throw new InvalidLedgerTransactionError(
        'LedgerTransaction rehydration snapshot must be a valid non-null object.'
      );
    }

    const publicId = normalizeUuidV4(
      snapshot.publicId,
      'snapshot.publicId'
    );

    const databaseId = parsePositiveSafeIntegerId(
      snapshot.databaseId,
      'databaseId'
    );

    const idempotencyKey = normalizeRequiredText(
      snapshot.idempotencyKey,
      'Idempotency key',
      255
    );

    const description = normalizeRequiredText(
      snapshot.description,
      'Transaction description',
      255
    );

    LedgerTransaction.validateEntriesCollection(
      snapshot.entries
    );

    let userId: number | null = null;

    if (
      snapshot.userId !== undefined &&
      snapshot.userId !== null
    ) {
      userId = parsePositiveSafeIntegerId(
        snapshot.userId,
        'userId'
      );
    }

    if (
      !isFinancialTransactionType(
        snapshot.transactionType
      )
    ) {
      throw new InvalidLedgerTransactionError(
        'Invalid transactionType on rehydration.'
      );
    }

    const transactionType =
      snapshot.transactionType;

    if (
      !isFinancialTransactionCategory(
        snapshot.category
      )
    ) {
      throw new InvalidLedgerTransactionError(
        'Invalid category on rehydration.'
      );
    }

    if (
      !isFinancialTransactionStatus(
        snapshot.status
      )
    ) {
      throw new InvalidLedgerTransactionError(
        'Invalid status on rehydration.'
      );
    }

    const {
      reversalId,
      refundId,
    } = LedgerTransaction.validateRelationships(
      transactionType,
      snapshot.reversalOfTransactionId,
      snapshot.refundOfTransactionId
    );

    /**
     * Auto-referência é uma invariante local.
     *
     * ReversalPolicy/RefundPolicy tratarão regras mais profundas,
     * como existência e estado da transação original.
     */
    if (
      reversalId !== undefined &&
      (reversalId === databaseId || snapshot.publicId === reversalId.toString(10) || (snapshot as any).id === reversalId)
    ) {
      throw new InvalidLedgerTransactionError(
        'A transaction cannot reverse itself.'
      );
    }

    if (
      refundId !== undefined &&
      (refundId === databaseId || snapshot.publicId === refundId.toString(10) || (snapshot as any).id === refundId)
    ) {
      throw new InvalidLedgerTransactionError(
        'A transaction cannot refund itself.'
      );
    }

    LedgerTransaction.validateCreatedAtEpochMs(
      snapshot.createdAtEpochMs,
      'createdAtEpochMs on rehydration'
    );

    LedgerTransaction.validateDoubleEntry(
      snapshot.entries
    );

    LedgerTransaction.validateAssetCardinality(
      transactionType,
      snapshot.entries
    );

    return new LedgerTransaction({
      publicId,
      databaseId,
      idempotencyKey,
      description,
      entries: snapshot.entries,
      userId,
      transactionType,
      category: snapshot.category,
      status: snapshot.status,
      createdAtEpochMs: snapshot.createdAtEpochMs,
      reversalOfTransactionId: reversalId,
      refundOfTransactionId: refundId,
      businessReason: snapshot.businessReason,
      auditRef: snapshot.auditRef,
      source: snapshot.source,
      destination: snapshot.destination,
      providerId: snapshot.providerId,
      externalEventId: snapshot.externalEventId,
      feeType: snapshot.feeType,
      actorUserId: snapshot.actorUserId,
      authorizedByUserId: snapshot.authorizedByUserId,
      sourceType: snapshot.sourceType,
      sourceId: snapshot.sourceId,
      correlationId: snapshot.correlationId,
      scope: snapshot.scope,
    });
  }

  /**
   * ==========================================================
   * VALIDATE ENTRIES COLLECTION
   * ==========================================================
   *
   * A ordem das validações é intencional:
   *
   * 1. verifica se é array
   * 2. verifica limites
   * 3. verifica instâncias
   * 4. verifica IDs
   * 5. verifica debit/credit
   *
   * Isso evita TypeError antes do erro de domínio.
   */
  private static validateEntriesCollection(
    entries: readonly LedgerEntry[]
  ): void {
    if (!Array.isArray(entries)) {
      throw new InvalidLedgerTransactionError(
        'Transaction entries must be an array.'
      );
    }

    if (entries.length < 2) {
      throw new InvalidLedgerTransactionError(
        'Transaction must contain at least two entries.'
      );
    }

    if (entries.length > 100) {
      throw new InvalidLedgerTransactionError(
        'Transaction exceeds maximum limit of 100 entries.'
      );
    }

    const seenEntryIds = new Set<string>();

    let hasDebit = false;
    let hasCredit = false;

    for (const entry of entries) {
      /**
       * IMPORTANTE:
       * validar instanceof ANTES de acessar entry.type/id.
       */
      if (!(entry instanceof LedgerEntry)) {
        throw new InvalidLedgerTransactionError(
          'All entries must be valid instances of LedgerEntry.'
        );
      }

      if (seenEntryIds.has(entry.id)) {
        throw new InvalidLedgerTransactionError(
          'Transaction cannot contain duplicate ledger entry IDs.'
        );
      }

      seenEntryIds.add(entry.id);

      if (entry.type === 'debit') {
        hasDebit = true;
      } else if (entry.type === 'credit') {
        hasCredit = true;
      }
    }

    if (!hasDebit || !hasCredit) {
      throw new InvalidLedgerTransactionError(
        'Transaction must contain at least one debit and one credit entry.'
      );
    }
  }

  /**
   * ==========================================================
   * RELATIONSHIP SHAPE VALIDATION
   * ==========================================================
   *
   * Esta função NÃO consulta banco.
   *
   * Ela valida apenas a estrutura local:
   *
   * reversal:
   *   requires reversalOfTransactionId
   *
   * refund:
   *   requires refundOfTransactionId
   *
   * demais tipos:
   *   não podem carregar nenhum relationship ID
   *
   * Regras externas ficam em:
   *   ReversalPolicy
   *   RefundPolicy
   */
  private static validateRelationships(
    type: FinancialTransactionType,
    reversalId?: number | string,
    refundId?: number | string
  ): {
    reversalId?: number;
    refundId?: number;
  } {
    if (type === 'reversal') {
      if (
        reversalId === undefined ||
        reversalId === null
      ) {
        throw new InvalidLedgerTransactionError(
          'Reversal transaction requires reversalOfTransactionId.'
        );
      }

      const validatedReversalId =
        parsePositiveSafeIntegerId(
          reversalId,
          'reversalOfTransactionId'
        );

      if (
        refundId !== undefined &&
        refundId !== null
      ) {
        throw new InvalidLedgerTransactionError(
          'Reversal transaction cannot have refundOfTransactionId.'
        );
      }

      return {
        reversalId: validatedReversalId,
      };
    }

    if (type === 'refund') {
      if (
        refundId === undefined ||
        refundId === null
      ) {
        throw new InvalidLedgerTransactionError(
          'Refund transaction requires refundOfTransactionId.'
        );
      }

      const validatedRefundId =
        parsePositiveSafeIntegerId(
          refundId,
          'refundOfTransactionId'
        );

      if (
        reversalId !== undefined &&
        reversalId !== null
      ) {
        throw new InvalidLedgerTransactionError(
          'Refund transaction cannot have reversalOfTransactionId.'
        );
      }

      return {
        refundId: validatedRefundId,
      };
    }

    if (
      reversalId !== undefined &&
      reversalId !== null
    ) {
      throw new InvalidLedgerTransactionError(
        `reversalOfTransactionId is only valid for reversal transactions.`
      );
    }

    if (
      refundId !== undefined &&
      refundId !== null
    ) {
      throw new InvalidLedgerTransactionError(
        `refundOfTransactionId is only valid for refund transactions.`
      );
    }

    return {};
  }

  /**
   * ==========================================================
   * CREATED AT
   * ==========================================================
   */
  private static validateCreatedAtEpochMs(
    value: unknown,
    fieldName: string
  ): void {
    if (
      !Number.isSafeInteger(value) ||
      (value as number) <= 0 ||
      (value as number) > MAX_VALID_DATE_EPOCH_MS
    ) {
      throw new InvalidLedgerTransactionError(
        `${fieldName} must be a valid positive safe integer timestamp.`
      );
    }
  }

  /**
   * ==========================================================
   * ASSET CARDINALITY
   * ==========================================================
   *
   * Valida a cardinalidade de ativos por tipo de transação contábil:
   * - standard (deposit, withdrawal, transfer, payment, refund, fee, reward, yield, adjustment): exatamente 1 ativo.
   * - conversion: exatamente 2 ativos distintos.
   * - reversal: 1 ou 2 ativos (preservando a cardinalidade da operação original).
   */
  private static validateAssetCardinality(
    transactionType: FinancialTransactionType,
    entries: readonly LedgerEntry[]
  ): void {
    const uniqueAssets = new Set<number>();
    for (const entry of entries) {
      uniqueAssets.add(entry.amount.assetId);
    }

    if (transactionType === 'conversion') {
      if (uniqueAssets.size !== 2) {
        throw new InvalidLedgerTransactionError(
          'Transações do tipo conversion exigem exatamente 2 ativos distintos.'
        );
      }
      return;
    }

    if (transactionType === 'reversal') {
      if (uniqueAssets.size !== 1 && uniqueAssets.size !== 2) {
        throw new InvalidLedgerTransactionError(
          'Transações de estorno (reversal) admitem apenas 1 ou 2 ativos.'
        );
      }
      return;
    }

    if (uniqueAssets.size !== 1) {
      throw new InvalidLedgerTransactionError(
        `Transações do tipo ${transactionType} devem ser estritamente monoativo (exatamente 1 ativo).`
      );
    }
  }

  /**
   * ==========================================================
   * DOUBLE ENTRY
   * ==========================================================
   *
   * FIN-001
   *
   * Para cada ativo:
   *
   *   SUM(debit) == SUM(credit)
   *
   * A matemática usa exclusivamente bigint.
   */
  private static validateDoubleEntry(
    entries: readonly LedgerEntry[]
  ): void {
    const balances = new Map<number, bigint>();

    for (const entry of entries) {
      /**
       * validateDoubleEntry é chamada somente após
       * validateEntriesCollection().
       *
       * Portanto entry já é LedgerEntry.
       */
      const assetId = entry.amount.assetId;

      const currentBalance =
        balances.get(assetId) ?? 0n;

      const amount = entry.amount.amount;

      /**
       * Proteção contra acumulador acima do limite físico.
       */
      if (
        amount < 0n ||
        amount > MAX_UINT256
      ) {
        throw new InvalidMoneyFormatError(
          'LedgerEntry amount exceeds the supported uint256 domain.'
        );
      }

      if (entry.type === 'debit') {
        const nextBalance =
          currentBalance + amount;

        /**
         * O acumulador absoluto não deve ultrapassar
         * o domínio uint256.
         */
        if (nextBalance > MAX_UINT256) {
          throw new InvalidMoneyFormatError(
            'Ledger transaction aggregate amount exceeds uint256 limits.'
          );
        }

        balances.set(
          assetId,
          nextBalance
        );
      } else {
        const nextBalance =
          currentBalance - amount;

        /**
         * Podemos aceitar um acumulador negativo durante
         * a demonstração matemática para depois detectar
         * imbalance.
         *
         * Não fazemos clamp e não usamos number.
         */
        balances.set(
          assetId,
          nextBalance
        );
      }
    }

    for (const [
      assetId,
      balance,
    ] of balances.entries()) {
      if (balance !== 0n) {
        throw new LedgerImbalanceError(
          `Double-entry validation failed for asset #${assetId}: Debits and Credits do not balance (Diff: ${balance.toString()}).`
        );
      }
    }
  }
}
