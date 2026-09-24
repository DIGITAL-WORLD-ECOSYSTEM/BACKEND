import { AuthorizationDecision } from './AuthorizationContext';

/**
 * Mutação atômica de saldo projetado.
 *
 * `signedDeltaBaseUnits`: Fonte Única de Verdade.
 * - Positivo (> 0n): Aumenta o saldo disponível (crédito em contas de saldo credor normal, ou débito em devedor normal).
 * - Negativo (< 0n): Reduz o saldo disponível.
 */
export interface BalanceMutationPlan {
  readonly accountId: number;
  readonly assetId: number;
  readonly signedDeltaBaseUnits: bigint;
  readonly expectedVersion: number;
  readonly newAvailableBaseUnits: string;
}

export interface PostingLedgerEntryPlan {
  readonly transactionId: number;
  readonly entryOrdinal: number; // 0, 1, 2... Garante unicidade estrutural da perna
  readonly accountId: number;
  readonly assetId: number;
  readonly direction: 'debit' | 'credit';
  readonly amountBaseUnits: string;
  readonly description: string;
}

export interface PostingTransactionRecordPlan {
  readonly id: number; // Identidade determinística conhecida antes do batch
  readonly publicId: string;
  readonly type: string;
  readonly category: string;
  readonly description: string;
  readonly actorUserId: number | null;
  readonly authorizedByUserId: number | null;
  readonly sourceType: string | null;
  readonly sourceId: string | null;
  readonly reversalOfTransactionId?: number | null;
  readonly refundOfTransactionId?: number | null;
  readonly correlationId: string;
}

export interface PostingOutboxEventPlan {
  readonly eventId: string;
  readonly eventName: string;
  readonly aggregateId: string;
  readonly aggregateVersion: number;
  readonly payload: string;
}

/**
 * Plano Imutável de Postagem Financeira (PostingPlan).
 *
 * Contém 100% das informações necessárias para a compilação do batch SQL físico.
 * Regra Soberana: "No Side Effect After Plan". Após a criação deste objeto,
 * o executor apenas traduz os dados em statements estáticos e os despacha.
 */
export interface PostingPlan {
  readonly planId: string;
  readonly scope: string;
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly transactionId: number;
  readonly authorizationDecision: AuthorizationDecision;
  readonly transactionRecord: PostingTransactionRecordPlan;
  readonly ledgerEntries: ReadonlyArray<PostingLedgerEntryPlan>;
  readonly balanceMutations: ReadonlyArray<BalanceMutationPlan>;
  readonly outboxEvent: PostingOutboxEventPlan;
  readonly leaseOwner: string;
  readonly leaseGeneration: number;
  readonly responseStatus: number;
  readonly responsePayload: string;
}

