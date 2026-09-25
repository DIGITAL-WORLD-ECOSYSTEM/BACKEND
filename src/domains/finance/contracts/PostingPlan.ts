import type { AuthorizationDecision } from './AuthorizationContext';

/**
 * Selo único canônico de integridade do PostingPlan.
 * Mantido como unique symbol para compatibilidade com executores físicos e barreiras de despacho.
 */
export const POSTING_PLAN_SEAL: unique symbol = Symbol('POSTING_PLAN_SEAL');

/**
 * Registro privado em memória (WeakSet) de instâncias legítimas de PostingPlan emitidas
 * exclusivamente pelo compilador do domínio (PostingPlanBuilder).
 * Impede que chamadores externos forjem planos através de duck-typing ou duplicação de símbolos.
 */
const AUTHENTIC_POSTING_PLANS = new WeakSet<object>();

/**
 * Mutação atômica de saldo projetado.
 *
 * `signedDeltaBaseUnits`: Fonte Única de Verdade.
 * - Positivo (> 0n): Aumenta o saldo disponível.
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
  readonly entryOrdinal: number; // 1..N com unicidade estrutural comprovada
  readonly accountId: number;
  readonly assetId: number;
  readonly direction: 'debit' | 'credit';
  readonly amountBaseUnits: string;
  readonly description: string;
}

export interface PostingTransactionRecordPlan {
  readonly id: number; // Identidade determinística de 53 bits conhecida antes do batch
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
 * Contém 100% das informações necessárias para a compilação do batch transacional físico.
 * Regra Soberana: "No Side Effect After Plan". Após a criação deste objeto,
 * o executor apenas traduz os dados em statements estáticos e os despacha.
 */
export interface PostingPlan {
  readonly [POSTING_PLAN_SEAL]: typeof POSTING_PLAN_SEAL;
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

/**
 * Sela e registra o PostingPlan no registro inviolável de planos autênticos,
 * congelando profundamente todas as coleções internas e a decisão de autorização.
 */
export function sealPostingPlan<T extends PostingPlan>(plan: T): T {
  validatePostingPlanCrossFieldInvariants(plan);

  // Congelamento profundo de sub-objetos e coleções
  const frozenEntries = Object.freeze(
    plan.ledgerEntries.map((e) => Object.freeze({ ...e }))
  );

  const frozenMutations = Object.freeze(
    plan.balanceMutations.map((m) => Object.freeze({ ...m }))
  );

  const frozenTxRecord = Object.freeze({ ...plan.transactionRecord });
  const frozenOutbox = Object.freeze({ ...plan.outboxEvent });
  const frozenAuthDecision = Object.freeze({ ...plan.authorizationDecision });

  const sealed = Object.freeze({
    ...plan,
    authorizationDecision: frozenAuthDecision,
    ledgerEntries: frozenEntries,
    balanceMutations: frozenMutations,
    transactionRecord: frozenTxRecord,
    outboxEvent: frozenOutbox,
  });

  AUTHENTIC_POSTING_PLANS.add(sealed);
  return sealed;
}

/**
 * Type guard que atesta se um objeto é um PostingPlan legítimo, selado e registrado.
 * Exige presença no registro soberano de memória E validação do selo único.
 */
export function isAuthenticPostingPlan(plan: unknown): plan is PostingPlan {
  if (!plan || typeof plan !== 'object') {
    return false;
  }
  return (
    AUTHENTIC_POSTING_PLANS.has(plan) &&
    (plan as any)[POSTING_PLAN_SEAL] === POSTING_PLAN_SEAL
  );
}

/**
 * Validação estrita de invariantes cruzadas (cross-field) do plano contábil:
 * 1. Correspondência de IDs transacionais entre raiz e registro contábil.
 * 2. Mínimo de 2 pernas de partidas dobradas com ordinais contíguos 1..N.
 * 3. Validação FIN-001: Balanceamento exato de débitos e créditos (SUM(debit) === SUM(credit)) por ativo.
 * 4. Validação de segurança de inteiros para contas e ativos em mutações de saldo.
 */
export function validatePostingPlanCrossFieldInvariants(plan: PostingPlan): void {
  if (!plan || typeof plan !== 'object') {
    throw new Error('PostingPlan inválido: referência nula ou não-objeto.');
  }

  // 1. Identidade transacional cruzada
  if (plan.transactionId !== plan.transactionRecord.id) {
    throw new Error(
      `Inconsistência no PostingPlan: transactionRecord.id (${plan.transactionRecord.id}) diverge do transactionId (${plan.transactionId}).`
    );
  }

  // 2. Mínimo de partidas dobradas
  if (!Array.isArray(plan.ledgerEntries) || plan.ledgerEntries.length < 2) {
    throw new Error('PostingPlan corrompido: exige no mínimo 2 pernas contábeis de partidas dobradas.');
  }

  // 3. Unicidade de transactionId e ordinais 1..N contíguos
  const assetBalance = new Map<number, bigint>();

  for (let i = 0; i < plan.ledgerEntries.length; i++) {
    const entry = plan.ledgerEntries[i];
    if (entry.transactionId !== plan.transactionId) {
      throw new Error(
        `Perna contábil #${i} vinculada a transação ${entry.transactionId} em vez do plano ${plan.transactionId}.`
      );
    }
    if (entry.entryOrdinal !== i + 1) {
      throw new Error(
        `Ordinal de perna contábil #${i} descontínuo: esperado ${i + 1}, recebido ${entry.entryOrdinal}.`
      );
    }
    if (entry.direction !== 'debit' && entry.direction !== 'credit') {
      throw new Error(
        `Direção contábil inválida na perna #${i}: '${entry.direction}'. Esperado 'debit' ou 'credit'.`
      );
    }

    const amount = BigInt(entry.amountBaseUnits);
    if (amount <= 0n) {
      throw new Error(
        `Perna contábil #${i} possui montante não positivo em base units: '${entry.amountBaseUnits}'.`
      );
    }

    const currentNet = assetBalance.get(entry.assetId) ?? 0n;
    const delta = entry.direction === 'debit' ? amount : -amount;
    assetBalance.set(entry.assetId, currentNet + delta);
  }

  // 4. Validação FIN-001: SUM(debits) === SUM(credits) para todo ativo movimentado
  for (const [assetId, netBalance] of assetBalance.entries()) {
    if (netBalance !== 0n) {
      throw new Error(
        `Desbalanceamento contábil no plano para o ativo #${assetId}: soma dos débitos difere da soma dos créditos (diferença: ${netBalance.toString()}).`
      );
    }
  }

  // 5. Invariantes de mutação de saldo
  if (!Array.isArray(plan.balanceMutations)) {
    throw new Error('PostingPlan corrompido: balanceMutations deve ser uma lista (Array).');
  }

  for (const mutation of plan.balanceMutations) {
    if (!Number.isSafeInteger(mutation.accountId) || mutation.accountId <= 0) {
      throw new Error(`accountId inválido em balanceMutations do plano: ${mutation.accountId}`);
    }
    if (!Number.isSafeInteger(mutation.assetId) || mutation.assetId <= 0) {
      throw new Error(`assetId inválido em balanceMutations do plano: ${mutation.assetId}`);
    }
    if (typeof mutation.signedDeltaBaseUnits !== 'bigint') {
      throw new Error(`signedDeltaBaseUnits em balanceMutations deve ser bigint.`);
    }
  }
}
