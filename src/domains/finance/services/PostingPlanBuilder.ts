import {
  PostingPlan,
  PostingLedgerEntryPlan,
  BalanceMutationPlan,
  PostingTransactionRecordPlan,
  PostingOutboxEventPlan,
} from '../contracts/PostingPlan';
import { AuthorizationDecision } from '../contracts/AuthorizationContext';
import { DeterministicIdGenerator } from '../contracts/DeterministicIdGenerator';
import { FinancialAccountClass } from '../policies/AccountClassPolicy';
import { AccountStatus } from '../policies/AccountStatusPolicy';
import { AccountingEntryPolicy } from '../policies/AccountingEntryPolicy';
import {
  InsufficientBalanceError,
  Money256OverflowError,
  InvalidLedgerTransactionError,
  AccountInactiveError,
} from '../errors/FinancialError';
import { LedgerImbalanceError } from '../errors/LedgerImbalanceError';
import { MAX_UINT256 } from '../constants/FinancialLimits';

export interface PostingLegEntryInput {
  readonly accountId: number;
  readonly assetId: number;
  readonly accountClass: FinancialAccountClass;
  readonly accountStatus: AccountStatus;
  readonly direction: 'debit' | 'credit';
  readonly amount: bigint;
  readonly description: string;
  readonly currentAvailableBaseUnits: bigint;
  readonly currentVersion: number;
}

export interface BuildPostingPlanParams {
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

export class PostingPlanBuilder {
  /**
   * Constrói e valida rigorosamente um PostingPlan imutável em memória.
   *
   * Garantias Soberanas:
   * 1. Invariante FIN-001 de partidas dobradas (débitos == créditos por ativo).
   * 2. Ordinais físicos determinísticos e estritamente únicos para cada perna do ledger (entryOrdinal).
   * 3. Consolidação e ordenação canônica de mutações de saldo por (accountId, assetId).
   * 4. Validação de suficiência de fundos e limites uint256.
   * 5. Identidade determinística da transação gerada antes do batch (DeterministicIdGenerator).
   */
  public static build(params: BuildPostingPlanParams): PostingPlan {
    // 0. Validação de Autorização Soberana (DENIED -> Bloqueio imediato do PostingPlan)
    if (!params.authorizationDecision || !params.authorizationDecision.allowed) {
      const reason = !params.authorizationDecision
        ? 'Decisão de autorização ausente'
        : (!params.authorizationDecision.allowed ? params.authorizationDecision.reason : 'Não autorizada');
      throw new InvalidLedgerTransactionError(
        `Decisão de autorização inválida ou negada para a construção do PostingPlan: ${reason}`
      );
    }

    if (!params.entries || params.entries.length < 2) {
      throw new InvalidLedgerTransactionError(
        'Invariante do Ledger violado: Uma transação contábil exige no mínimo 2 lançamentos.'
      );
    }

    const hasDebit = params.entries.some((e) => e.direction === 'debit');
    const hasCredit = params.entries.some((e) => e.direction === 'credit');

    if (!hasDebit || !hasCredit) {
      throw new InvalidLedgerTransactionError(
        'Invariante do Ledger violado: Uma transação financeira exige no mínimo 1 lançamento de débito e 1 de crédito.'
      );
    }

    // 1. Validação de valores estritamente positivos e contas ativas
    for (const entry of params.entries) {
      if (entry.amount <= 0n) {
        throw new InvalidLedgerTransactionError(
          `Invariante do Ledger violado: Quantia contábil inválida (${entry.amount}). O valor deve ser estritamente positivo (> 0).`
        );
      }
      if (entry.accountStatus !== 'active') {
        throw new AccountInactiveError(
          `Conta financeira #${entry.accountId} está inativa ou suspensa (${entry.accountStatus}).`
        );
      }
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
        existing.netSignedDelta += signedDelta;
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

    // Ordenação canônica determinística para prevenir deadlocks
    const sortedAggregations = Array.from(balanceMap.values()).sort((a, b) => {
      if (a.accountId !== b.accountId) return a.accountId - b.accountId;
      return a.assetId - b.assetId;
    });

    const balanceMutations: BalanceMutationPlan[] = [];

    for (const agg of sortedAggregations) {
      if (agg.netSignedDelta === 0n) {
        continue; // Débitos e créditos cancelam-se perfeitamente
      }

      const targetAvailable = agg.currentAvailable + agg.netSignedDelta;

      if (targetAvailable < 0n) {
        throw new InsufficientBalanceError(
          `saldo insuficiente para a conta #${agg.accountId} e ativo #${agg.assetId}. Disponível: ${agg.currentAvailable}, Variação: ${agg.netSignedDelta}`
        );
      }

      if (targetAvailable > MAX_UINT256) {
        throw new Money256OverflowError(
          `Novo saldo disponível (${targetAvailable}) excederia o limite uint256.`
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

    // 4. Geração determinística de identidade (após todas as validações prévias passarem)
    const transactionId = DeterministicIdGenerator.nextTransactionId();
    const planId = `plan_${transactionId}_${Date.now()}`;
    const correlationId = params.correlationId || `corr_${transactionId}`;

    // 5. Compilação das pernas contábeis com entryOrdinal sequencial (P1-14)
    const ledgerEntries: PostingLedgerEntryPlan[] = params.entries.map((entry, index) => {
      return Object.freeze({
        transactionId,
        entryOrdinal: index,
        accountId: entry.accountId,
        assetId: entry.assetId,
        direction: entry.direction,
        amountBaseUnits: entry.amount.toString(10),
        description: entry.description,
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
      eventId: `evt_${transactionId}_${Date.now()}`,
      eventName: 'LedgerTransactionPosted.v1',
      aggregateId: String(transactionId),
      aggregateVersion: 1,
      payload: JSON.stringify({
        transactionId,
        idempotencyKey: params.idempotencyKey,
        requestHash: params.requestHash,
        occurredAt: new Date().toISOString(),
      }),
    });

    const leaseOwner = params.leaseOwner || `worker_auto_${transactionId}`;
    const leaseGeneration =
      typeof params.leaseGeneration === 'number' && params.leaseGeneration >= 0
        ? params.leaseGeneration
        : 1;
    const responseStatus =
      typeof params.responseStatus === 'number' ? params.responseStatus : 200;
    const responsePayload =
      params.responsePayload ||
      JSON.stringify({
        success: true,
        transactionId,
        idempotencyKey: params.idempotencyKey,
      });

    return Object.freeze({
      planId,
      scope: params.scope,
      idempotencyKey: params.idempotencyKey,
      requestHash: params.requestHash,
      transactionId,
      authorizationDecision: params.authorizationDecision,
      transactionRecord,
      ledgerEntries: Object.freeze(ledgerEntries),
      balanceMutations: Object.freeze(balanceMutations),
      outboxEvent,
      leaseOwner,
      leaseGeneration,
      responseStatus,
      responsePayload,
    });
  }
}
