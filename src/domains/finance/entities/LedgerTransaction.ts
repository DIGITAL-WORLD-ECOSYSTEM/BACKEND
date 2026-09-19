import {
  Money256,
  parsePositiveSafeIntegerId,
} from '../value-objects/Money256';

import type { LedgerEntryDirection } from '../value-objects/BaseUnits';

import {
  isLedgerEntryDirection,
} from '../value-objects/BaseUnits';

import { LedgerImbalanceError } from '../errors/LedgerImbalanceError';

import {
  InvalidLedgerTransactionError,
  InvalidMoneyFormatError,
  InvalidIdentifierError,
} from '../errors/FinancialError';

/**
 * ============================================================
 * LIMITES FÍSICOS DO DOMÍNIO
 * ============================================================
 *
 * O domínio financeiro trabalha com inteiros exatos.
 * Nenhum cálculo monetário deve utilizar number para montantes.
 */
const MAX_UINT256 = (1n << 256n) - 1n;

/**
 * Limite máximo suportado pelo objeto Date do JavaScript.
 *
 * O timestamp é armazenado internamente como integer epoch milliseconds.
 */
const MAX_VALID_DATE_EPOCH_MS = 8_640_000_000_000_000;

/**
 * ============================================================
 * STATUS DA TRANSAÇÃO
 * ============================================================
 */

export const FINANCIAL_TRANSACTION_STATUSES = Object.freeze([
  'pending',
  'processing',
  'completed',
  'failed',
  'cancelled',
  'reversed',
  'refunded',
] as const);

export type FinancialTransactionStatus =
  (typeof FINANCIAL_TRANSACTION_STATUSES)[number];

export function isFinancialTransactionStatus(
  value: unknown
): value is FinancialTransactionStatus {
  return (
    typeof value === 'string' &&
    FINANCIAL_TRANSACTION_STATUSES.includes(
      value as FinancialTransactionStatus
    )
  );
}

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
  maxLength: number
): string {
  if (typeof value !== 'string') {
    throw new InvalidLedgerTransactionError(
      `${fieldName} must be a string.`
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

  if (/[\u0000-\u001F\u007F]/u.test(normalized)) {
    throw new InvalidLedgerTransactionError(
      `${fieldName} contains forbidden control characters.`
    );
  }

  return normalized;
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

  const normalized = value.trim().normalize('NFC');

  if (
    normalized.length === 0 ||
    normalized.length > 255 ||
    /[\u0000-\u001F\u007F]/u.test(normalized)
  ) {
    throw new InvalidIdentifierError(
      'Invalid LedgerEntry id.'
    );
  }

  return normalized;
}

/**
 * ============================================================
 * LEDGER ENTRY
 * ============================================================
 */

export type LedgerEntryType = LedgerEntryDirection;

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
     * Mantido como string na entidade para preservar a representação
     * canônica e evitar conversões repetidas.
     */
    if (typeof props.accountId !== 'string') {
      throw new InvalidIdentifierError(
        'LedgerEntry accountId is required and must be a string.'
      );
    }

    const trimmedAccountId = props.accountId.trim();

    if (!/^[1-9]\d*$/.test(trimmedAccountId)) {
      throw new InvalidIdentifierError(
        'Invalid LedgerEntry accountId. Must be a positive integer string without signs, spaces or decimals.'
      );
    }

    const numericAccountId = Number(trimmedAccountId);

    if (
      !Number.isSafeInteger(numericAccountId) ||
      numericAccountId <= 0
    ) {
      throw new InvalidIdentifierError(
        'Invalid LedgerEntry accountId. Out of safe integer range.'
      );
    }

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

      if (/[\u0000-\u001F\u007F]/u.test(candidate)) {
        throw new InvalidLedgerTransactionError(
          'LedgerEntry description contains forbidden control characters.'
        );
      }

      normalizedDescription =
        candidate.length > 0 ? candidate : undefined;
    }

    this.accountId = trimmedAccountId;
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
  reversalOfTransactionId?: number;
  refundOfTransactionId?: number;
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
    this.reversalOfTransactionId =
      params.reversalOfTransactionId;
    this.refundOfTransactionId =
      params.refundOfTransactionId;

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

    const idempotencyKey = normalizeRequiredText(
      props.idempotencyKey,
      'Idempotency key',
      255
    );

    const description = normalizeRequiredText(
      props.description,
      'Transaction description',
      255
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

    if (
      !isFinancialTransactionCategory(props.category)
    ) {
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
     * Validação contábil final.
     */
    LedgerTransaction.validateDoubleEntry(
      props.entries
    );

    return new LedgerTransaction({
      publicId,
      idempotencyKey,
      description,
      entries: props.entries,
      userId,
      transactionType,
      category: props.category,
      status: 'pending',
      createdAtEpochMs,
      reversalOfTransactionId: reversalId,
      refundOfTransactionId: refundId,
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
      reversalId === databaseId
    ) {
      throw new InvalidLedgerTransactionError(
        'A transaction cannot reverse itself.'
      );
    }

    if (
      refundId !== undefined &&
      refundId === databaseId
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
      createdAtEpochMs:
        snapshot.createdAtEpochMs,
      reversalOfTransactionId: reversalId,
      refundOfTransactionId: refundId,
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
    reversalId?: number,
    refundId?: number
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
