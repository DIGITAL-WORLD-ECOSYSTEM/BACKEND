import {
  PostingPlan,
  PostingLedgerEntryPlan,
  BalanceMutationPlan,
  PostingTransactionRecordPlan,
  PostingOutboxEventPlan,
  POSTING_PLAN_SEAL,
  sealPostingPlan,
} from '../contracts/PostingPlan';
import { AuthorizationDecision } from '../contracts/AuthorizationContext';
import { DeterministicIdGenerator } from '../contracts/DeterministicIdGenerator';
import {
  AccountClassPolicy,
  type FinancialAccountClass,
} from '../policies/AccountClassPolicy';
import {
  AccountStatusPolicy,
  type AccountStatus,
  isAccountStatus,
} from '../policies/AccountStatusPolicy';
import { AccountingEntryPolicy } from '../policies/AccountingEntryPolicy';
import {
  FinancialTextPolicy,
  DANGEROUS_TEXT_CHARACTERS_REGEX,
} from '../policies/FinancialTextPolicy';
import {
  isLedgerEntryDirection,
  type LedgerEntryDirection,
} from '../value-objects/BaseUnits';
import {
  InsufficientBalanceError,
  Money256OverflowError,
  InvalidLedgerTransactionError,
  AccountInactiveError,
} from '../errors/FinancialError';
import { LedgerImbalanceError } from '../errors/LedgerImbalanceError';
import {
  MAX_UINT256,
  MAX_LEDGER_ENTRIES,
  MAX_LEDGER_DESCRIPTION_LENGTH,
  MAX_RAW_TEXT_CEILING,
} from '../constants/FinancialLimits';

export interface PostingLegEntryInput {
  readonly accountId: number;
  readonly assetId: number;
  readonly accountClass: FinancialAccountClass;
  readonly accountStatus: AccountStatus;
  readonly direction: LedgerEntryDirection;
  readonly amount: bigint;
  readonly description: string;
  readonly currentAvailableBaseUnits: bigint;
  readonly currentVersion: number;
}

export interface BuildPostingPlanParams {
  readonly transactionId?: number;
  readonly planId?: string;
  readonly eventId?: string;
  readonly occurredAtEpochMs?: number;

  readonly scope: string;
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly transactionType: string;
  readonly category: string;
  readonly description: string;
  readonly actorUserId: number | null;
  readonly authorizedByUserId: number | null;
  readonly sourceType?: string | null;
  readonly sourceId?: string | null;
  readonly reversalOfTransactionId?: number | null;
  readonly refundOfTransactionId?: number | null;
  readonly correlationId?: string;
  readonly authorizationDecision: AuthorizationDecision;
  readonly entries: ReadonlyArray<PostingLegEntryInput>;
  readonly leaseOwner?: string | null;
  readonly leaseGeneration?: number | null;
  readonly responseStatus?: number | null;
  readonly responsePayload?: string | null;
}

function assertPositiveSafeInteger(
  value: unknown,
  fieldName: string
): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) <= 0
  ) {
    throw new InvalidLedgerTransactionError(
      `${fieldName} must be a positive safe integer.`
    );
  }

  return value as number;
}

function assertNonNegativeSafeInteger(
  value: unknown,
  fieldName: string
): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 0
  ) {
    throw new InvalidLedgerTransactionError(
      `${fieldName} must be a non-negative safe integer.`
    );
  }

  return value as number;
}

export class PostingPlanBuilder {
  /**
   * Constrói e valida rigorosamente um PostingPlan imutável, determinístico e selado em memória.
   *
   * Garantias Soberanas:
   * 1. Invariante FIN-001 de partidas dobradas (débitos == créditos por ativo).
   * 2. Ordinais físicos determinísticos e estritamente únicos para cada perna do ledger (entryOrdinal 1..N).
   * 3. Consolidação e ordenação canônica de mutações de saldo por (accountId, assetId) ASC (prevenção de deadlock).
   * 4. Validação de suficiência de fundos, SafeInteger de IDs e limites uint256.
   * 5. Identidade determinística da transação sem Date.now() em planId/eventId.
   * 6. Selamento criptográfico em runtime via sealPostingPlan / POSTING_PLAN_SEAL com registro em WeakSet autêntico (P0-07).
   */
  public static build(params: BuildPostingPlanParams): PostingPlan {
    if (
      params === null ||
      typeof params !== 'object' ||
      Array.isArray(params)
    ) {
      throw new InvalidLedgerTransactionError(
        'PostingPlan build parameters must be a valid object.'
      );
    }

    // 0. Validação de Autorização Soberana (DENIED -> Bloqueio imediato do PostingPlan)
    if (!params.authorizationDecision || (params.authorizationDecision.allowed as unknown) !== true) {
      const reason = !params.authorizationDecision
        ? 'Decisão de autorização ausente'
        : ('reason' in params.authorizationDecision && typeof params.authorizationDecision.reason === 'string'
            ? params.authorizationDecision.reason
            : 'Não autorizada');
      throw new InvalidLedgerTransactionError(
        `Decisão de autorização inválida ou negada para a construção do PostingPlan: ${reason}`
      );
    }

    if (!params.entries || !Array.isArray(params.entries) || params.entries.length < 2) {
      throw new InvalidLedgerTransactionError(
        'Invariante do Ledger violado: Uma transação contábil exige no mínimo 2 lançamentos.'
      );
    }

    if (params.entries.length > MAX_LEDGER_ENTRIES) {
      throw new InvalidLedgerTransactionError(
        `Invariante do Ledger violado: Uma transação contábil não pode possuir mais de ${MAX_LEDGER_ENTRIES} lançamentos.`
      );
    }

    let hasDebit = false;
    let hasCredit = false;

    // 1. Validação de valores estritamente positivos, limites uint256, IDs seguros e contas ativas
    for (const entry of params.entries) {
      if (entry === null || typeof entry !== 'object') {
        throw new InvalidLedgerTransactionError(
          'Posting leg must be a valid object.'
        );
      }

      const accountId = assertPositiveSafeInteger(
        entry.accountId,
        'entry.accountId'
      );

      const assetId = assertPositiveSafeInteger(
        entry.assetId,
        'entry.assetId'
      );

      if (!AccountClassPolicy.isFinancialAccountClass(entry.accountClass)) {
        throw new InvalidLedgerTransactionError(
          `Invalid accountClass for account #${accountId}.`
        );
      }

      if (!isAccountStatus(entry.accountStatus)) {
        throw new AccountInactiveError(
          `Conta financeira #${accountId} possui status inválido.`
        );
      }

      AccountStatusPolicy.validateActive({
        id: accountId,
        status: entry.accountStatus,
      });

      if (!isLedgerEntryDirection(entry.direction)) {
        throw new InvalidLedgerTransactionError(
          `Invalid ledger direction for account #${accountId}.`
        );
      }

      if (typeof entry.amount !== 'bigint' || entry.amount <= 0n) {
        throw new InvalidLedgerTransactionError(
          `Invariante do Ledger violado: Quantia contábil inválida (${entry.amount}). O valor deve ser estritamente positivo (> 0).`
        );
      }

      if (entry.amount > MAX_UINT256) {
        throw new Money256OverflowError(
          `Quantia contábil informada (${entry.amount}) excede o limite uint256.`
        );
      }

      if (
        typeof entry.currentAvailableBaseUnits !== 'bigint' ||
        entry.currentAvailableBaseUnits < 0n ||
        entry.currentAvailableBaseUnits > MAX_UINT256
      ) {
        throw new InvalidLedgerTransactionError(
          `currentAvailableBaseUnits for account #${accountId} is outside uint256.`
        );
      }

      assertNonNegativeSafeInteger(
        entry.currentVersion,
        'entry.currentVersion'
      );

      if (entry.direction === 'debit') {
        hasDebit = true;
      } else if (entry.direction === 'credit') {
        hasCredit = true;
      }
    }

    if (!hasDebit || !hasCredit) {
      throw new InvalidLedgerTransactionError(
        'Invariante do Ledger violado: Uma transação financeira exige no mínimo 1 lançamento de débito e 1 de crédito.'
      );
    }

    // 2. Validação FIN-001: SUM(debits) === SUM(credits) por ativo
    const assetBalances = new Map<number, bigint>();
    for (const entry of params.entries) {
      const current = assetBalances.get(entry.assetId) ?? 0n;
      const delta = entry.direction === 'debit' ? entry.amount : -entry.amount;
      assetBalances.set(entry.assetId, current + delta);
    }

    for (const [assetId, netBalance] of assetBalances.entries()) {
      if (netBalance !== 0n) {
        throw new LedgerImbalanceError(
          `Desbalanceamento contábil no ativo #${assetId}: soma dos débitos difere dos créditos (diferença: ${netBalance.toString()}).`
        );
      }
    }

    // 3. Consolidação e agregação de deltas de saldo por (accountId, assetId) & Validação de Saldo
    interface BalanceAggregation {
      accountId: number;
      assetId: number;
      netSignedDelta: bigint;
      currentAvailable: bigint;
      expectedVersion: number;
    }

    const balanceMap = new Map<string, BalanceAggregation>();

    for (const entry of params.entries) {
      const key = `${entry.accountId}:${entry.assetId}`;
      const signedDelta = AccountingEntryPolicy.calculateNormalDelta(
        entry.accountClass,
        entry.direction,
        entry.amount
      );

      const existing = balanceMap.get(key);
      if (existing) {
        if (
          existing.currentAvailable !== entry.currentAvailableBaseUnits ||
          existing.expectedVersion !== entry.currentVersion
        ) {
          throw new InvalidLedgerTransactionError(
            `Conflicting balance snapshot for account #${entry.accountId} and asset #${entry.assetId}.`
          );
        }

        const nextSignedDelta = existing.netSignedDelta + signedDelta;
        if (
          nextSignedDelta > MAX_UINT256 ||
          nextSignedDelta < -MAX_UINT256
        ) {
          throw new Money256OverflowError(
            `Aggregated signed delta for account #${entry.accountId} and asset #${entry.assetId} exceeds supported bounds.`
          );
        }

        existing.netSignedDelta = nextSignedDelta;
      } else {
        balanceMap.set(key, {
          accountId: entry.accountId,
          assetId: entry.assetId,
          netSignedDelta: signedDelta,
          currentAvailable: entry.currentAvailableBaseUnits,
          expectedVersion: entry.currentVersion,
        });
      }
    }

    // Ordenação canônica determinística para prevenir deadlocks (accountId ASC, assetId ASC)
    const sortedAggregations = Array.from(balanceMap.values()).sort((a, b) => {
      if (a.accountId !== b.accountId) return a.accountId - b.accountId;
      return a.assetId - b.assetId;
    });

    const balanceMutations: BalanceMutationPlan[] = [];

    for (const agg of sortedAggregations) {
      if (agg.netSignedDelta === 0n) {
        continue;
      }

      const targetAvailable = agg.currentAvailable + agg.netSignedDelta;

      if (targetAvailable < 0n) {
        throw new InsufficientBalanceError(
          `saldo insuficiente para a conta #${agg.accountId} e ativo #${agg.assetId}. Disponível: ${agg.currentAvailable}, Variação: ${agg.netSignedDelta}`
        );
      }

      if (targetAvailable > MAX_UINT256) {
        throw new Money256OverflowError(
          `Novo saldo disponível para a conta #${agg.accountId} excederia o limite uint256.`
        );
      }

      balanceMutations.push(
        Object.freeze({
          accountId: agg.accountId,
          assetId: agg.assetId,
          signedDeltaBaseUnits: agg.netSignedDelta,
          expectedVersion: agg.expectedVersion,
          newAvailableBaseUnits: targetAvailable.toString(10),
        })
      );
    }

    // 4. Geração determinística de identidade
    const transactionId =
      params.transactionId !== undefined
        ? assertPositiveSafeInteger(params.transactionId, 'transactionId')
        : DeterministicIdGenerator.nextTransactionId();

    const planId =
      params.planId !== undefined
        ? FinancialTextPolicy.sanitizeSingleLine(
            params.planId,
            MAX_LEDGER_DESCRIPTION_LENGTH,
            'planId'
          )
        : `plan_${transactionId}`;

    const eventId =
      params.eventId !== undefined
        ? FinancialTextPolicy.sanitizeSingleLine(
            params.eventId,
            MAX_LEDGER_DESCRIPTION_LENGTH,
            'eventId'
          )
        : `evt_${transactionId}`;

    const MAX_VALID_DATE_EPOCH_MS = 8640000000000000;
    let occurredAtEpochMs: number;
    if (params.occurredAtEpochMs !== undefined) {
      occurredAtEpochMs = assertPositiveSafeInteger(params.occurredAtEpochMs, 'occurredAtEpochMs');
      if (occurredAtEpochMs > MAX_VALID_DATE_EPOCH_MS) {
        throw new InvalidLedgerTransactionError(
          `occurredAtEpochMs exceeds maximum valid Date ceiling (${occurredAtEpochMs} > ${MAX_VALID_DATE_EPOCH_MS}).`
        );
      }
    } else {
      occurredAtEpochMs = Date.now();
    }

    const occurredAt = new Date(occurredAtEpochMs).toISOString();

    const correlationId =
      params.correlationId && params.correlationId.trim().length > 0
        ? FinancialTextPolicy.sanitizeSingleLine(
            params.correlationId,
            512,
            'correlationId'
          )
        : `corr_${transactionId}`;

    // 5. Compilação das pernas contábeis com ordenação canônica determinística (accountId ASC, assetId ASC, direction ASC) e entryOrdinal sequencial 1..N
    const sortedEntries = [...params.entries].sort((a, b) => {
      if (a.accountId !== b.accountId) return a.accountId - b.accountId;
      if (a.assetId !== b.assetId) return a.assetId - b.assetId;
      if (a.direction !== b.direction) return a.direction.localeCompare(b.direction);
      return 0;
    });

    const ledgerEntries: PostingLedgerEntryPlan[] = sortedEntries.map((entry, index) => {
      return Object.freeze({
        transactionId,
        entryOrdinal: index + 1,
        accountId: entry.accountId,
        assetId: entry.assetId,
        direction: entry.direction,
        amountBaseUnits: entry.amount.toString(10),
        description: FinancialTextPolicy.normalizeSafeDescription(
          entry.description,
          MAX_LEDGER_DESCRIPTION_LENGTH,
          `entry.description[${index}]`
        ),
      });
    });

    // 6. Registro da transação
    const transactionRecord: PostingTransactionRecordPlan = Object.freeze({
      id: transactionId,
      publicId: `ftx_${transactionId}`,
      type: params.transactionType,
      category: params.category,
      description: params.description,
      actorUserId: params.actorUserId,
      authorizedByUserId: params.authorizedByUserId,
      sourceType: params.sourceType ?? null,
      sourceId: params.sourceId ?? null,
      reversalOfTransactionId: params.reversalOfTransactionId ?? null,
      refundOfTransactionId: params.refundOfTransactionId ?? null,
      correlationId,
    });

    // 7. Evento Outbox
    const outboxEvent: PostingOutboxEventPlan = Object.freeze({
      eventId,
      eventName: 'LedgerTransactionPosted.v1',
      aggregateId: String(transactionId),
      aggregateVersion: 1,
      payload: JSON.stringify({
        transactionId,
        idempotencyKey: params.idempotencyKey,
        requestHash: params.requestHash,
        occurredAt,
      }),
    });

    const leaseOwner =
      params.leaseOwner && params.leaseOwner.trim().length > 0
        ? FinancialTextPolicy.sanitizeSingleLine(
            params.leaseOwner,
            MAX_LEDGER_DESCRIPTION_LENGTH,
            'leaseOwner'
          )
        : `worker_auto_${transactionId}`;

    let leaseGeneration = 1;
    if (params.leaseGeneration !== undefined && params.leaseGeneration !== null) {
      if (!Number.isSafeInteger(params.leaseGeneration) || params.leaseGeneration < 0) {
        throw new InvalidLedgerTransactionError(`Invalid leaseGeneration (${params.leaseGeneration}).`);
      }
      leaseGeneration = params.leaseGeneration;
    }

    let responseStatus = 200;
    if (params.responseStatus !== undefined && params.responseStatus !== null) {
      if (
        !Number.isSafeInteger(params.responseStatus) ||
        params.responseStatus < 100 ||
        params.responseStatus > 599
      ) {
        throw new InvalidLedgerTransactionError(
          `Invalid responseStatus (${params.responseStatus}). Must be between 100 and 599.`
        );
      }
      responseStatus = params.responseStatus;
    }

    const responsePayload =
      params.responsePayload ||
      JSON.stringify({
        success: true,
        transactionId,
        idempotencyKey: params.idempotencyKey,
      });

    // 8. Selamento Soberano e Imutabilidade Profunda via sealPostingPlan (P0-07, P0-20)
    const unsealedPlan: PostingPlan = {
      [POSTING_PLAN_SEAL]: POSTING_PLAN_SEAL,
      planId,
      scope: params.scope,
      idempotencyKey: params.idempotencyKey,
      requestHash: params.requestHash,
      transactionId,
      authorizationDecision: Object.freeze({ ...params.authorizationDecision }),
      transactionRecord,
      ledgerEntries: Object.freeze(ledgerEntries),
      balanceMutations: Object.freeze(balanceMutations),
      outboxEvent,
      leaseOwner,
      leaseGeneration,
      responseStatus,
      responsePayload,
    };

    return sealPostingPlan(unsealedPlan);
  }
}
