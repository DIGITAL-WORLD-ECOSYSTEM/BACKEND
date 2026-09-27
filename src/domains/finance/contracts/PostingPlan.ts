import type { AuthorizationDecision } from './AuthorizationContext';
import { parsePositiveSafeIntegerId } from '../value-objects/FinancialIdentifier';
import {
  MAX_NUMERIC_RAW_TEXT_CEILING,
  MAX_UINT256_DECIMAL_DIGITS,
  MAX_UINT256,
} from '../constants/FinancialLimits';

/**
 * Selo único canônico de integridade do PostingPlan.
 * Mantido como unique symbol para verificação nominal com executores físicos e barreiras de despacho.
 */
export const POSTING_PLAN_SEAL: unique symbol = Symbol('POSTING_PLAN_SEAL');

/**
 * Registro privado em memória (WeakSet) de instâncias legítimas de PostingPlan emitidas
 * exclusivamente pelo compilador do domínio (PostingPlanBuilder / sealPostingPlan).
 * Impede que chamadores externos forjem planos através de duck-typing ou duplicação de símbolos.
 */
const AUTHENTIC_POSTING_PLANS = new WeakSet<object>();

/**
 * Padrão canônico decimal para base units positivas em pernas contábeis.
 */
const CANONICAL_POSITIVE_BASE_UNITS_PATTERN = /^[1-9]\d*$/;

/**
 * Padrão canônico decimal para novos saldos disponíveis (inteiros não-negativos).
 */
const CANONICAL_NON_NEGATIVE_BASE_UNITS_PATTERN = /^(0|[1-9]\d*)$/;

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
export function sealPostingPlan<T extends PostingPlan>(plan: T): PostingPlan {
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

  const sealed: PostingPlan = Object.freeze({
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
 * 1. Autoridade Válida: authorizationDecision.allowed deve ser estritamente true.
 * 2. Correspondência de IDs transacionais entre raiz e registro contábil.
 * 3. Mínimo de 2 pernas de partidas dobradas com ordinais contíguos 1..N.
 * 4. Validação FIN-001: Balanceamento exato de débitos e créditos (SUM(debit) === SUM(credit)) por ativo.
 * 5. Confrontação Matemática Estrita: Para toda conta mutada, o delta projetado (signedDeltaBaseUnits)
 *    deve coincidir exatamente em magnitude com o fluxo líquido das pernas contábeis correspondentes.
 * 6. Cobertura Bidirecional: Toda mutação de saldo deve ter perna contábil ativa e vice-versa.
 * 7. Limites Canônicos: Defesa anti-DoS e tetos uint256 em montantes e saldos projetados.
 */
export function validatePostingPlanCrossFieldInvariants(plan: PostingPlan): void {
  if (!plan || typeof plan !== 'object') {
    throw new Error('PostingPlan inválido: referência nula ou não-objeto.');
  }

  // 1. Autorização Soberana Não-Negada
  if (!plan.authorizationDecision || plan.authorizationDecision.allowed !== true) {
    throw new Error('PostingPlan inválido: plano não pode ser selado com autorização recusada ou ausente.');
  }

  // 2. Identidade transacional cruzada e fencing soberano
  const validTxId = parsePositiveSafeIntegerId(plan.transactionId, 'plan.transactionId');
  if (!plan.transactionRecord || plan.transactionRecord.id !== validTxId) {
    throw new Error(
      `Inconsistência no PostingPlan: transactionRecord.id (${plan.transactionRecord?.id}) diverge do transactionId (${validTxId}).`
    );
  }

  if (
    !plan.outboxEvent ||
    (plan.outboxEvent.aggregateId !== String(validTxId) &&
      plan.outboxEvent.aggregateId !== `tx_${validTxId}`)
  ) {
    throw new Error(
      `Inconsistência no PostingPlan: outboxEvent.aggregateId (${plan.outboxEvent?.aggregateId}) diverge do transactionId (${validTxId}).`
    );
  }

  if (!plan.leaseOwner || typeof plan.leaseOwner !== 'string' || plan.leaseOwner.trim().length === 0) {
    throw new Error('PostingPlan viola invariante P0: leaseOwner obrigatório para fencing de concorrência.');
  }

  if (typeof plan.leaseGeneration !== 'number' || plan.leaseGeneration < 0) {
    throw new Error('PostingPlan viola invariante P0: leaseGeneration obrigatório para fencing de concorrência.');
  }

  if (!plan.requestHash || typeof plan.requestHash !== 'string' || plan.requestHash.trim().length === 0) {
    throw new Error('PostingPlan viola invariante P0: requestHash criptográfico soberano obrigatório.');
  }

  // 3. Mínimo de partidas dobradas
  if (!Array.isArray(plan.ledgerEntries) || plan.ledgerEntries.length < 2) {
    throw new Error('PostingPlan corrompido: exige no mínimo 2 pernas contábeis de partidas dobradas.');
  }

  // 4. Unicidade de transactionId, ordinais 1..N contíguos e consolidação de fluxo
  const assetBalance = new Map<number, bigint>();
  const activeLegAccounts = new Set<string>();
  const accountDebits = new Map<string, bigint>();
  const accountCredits = new Map<string, bigint>();

  for (let i = 0; i < plan.ledgerEntries.length; i++) {
    const entry = plan.ledgerEntries[i];
    if (entry.transactionId !== validTxId) {
      throw new Error(
        `Perna contábil #${i} vinculada a transação ${entry.transactionId} em vez do plano ${validTxId}.`
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

    const validEntryAccId = parsePositiveSafeIntegerId(entry.accountId, `ledgerEntries[${i}].accountId`);
    const validEntryAssetId = parsePositiveSafeIntegerId(entry.assetId, `ledgerEntries[${i}].assetId`);
    const legKey = `${validEntryAccId}:${validEntryAssetId}`;
    activeLegAccounts.add(legKey);

    if (
      typeof entry.amountBaseUnits !== 'string' ||
      entry.amountBaseUnits.length > MAX_NUMERIC_RAW_TEXT_CEILING
    ) {
      throw new Error(`Perna contábil #${i} possui montante em base units malformado ou excessivo.`);
    }

    const trimmedAmount = entry.amountBaseUnits.trim();
    if (!CANONICAL_POSITIVE_BASE_UNITS_PATTERN.test(trimmedAmount)) {
      throw new Error(`Perna contábil #${i} possui montante em formato não-canônico: '${trimmedAmount}'.`);
    }

    if (trimmedAmount.length > MAX_UINT256_DECIMAL_DIGITS) {
      throw new Error(`Perna contábil #${i} excede o teto decimal de 256 bits.`);
    }

    const amount = BigInt(trimmedAmount);
    if (amount <= 0n || amount > MAX_UINT256) {
      throw new Error(
        `Perna contábil #${i} possui montante fora dos limites válidos [1..MAX_UINT256]: '${entry.amountBaseUnits}'.`
      );
    }

    // Acumulação para verificação de partidas dobradas (por ativo)
    const currentNet = assetBalance.get(validEntryAssetId) ?? 0n;
    const delta = entry.direction === 'debit' ? amount : -amount;
    assetBalance.set(validEntryAssetId, currentNet + delta);

    // Acumulação para confrontação com balanceMutations (por conta e ativo)
    if (entry.direction === 'debit') {
      accountDebits.set(legKey, (accountDebits.get(legKey) ?? 0n) + amount);
    } else {
      accountCredits.set(legKey, (accountCredits.get(legKey) ?? 0n) + amount);
    }
  }

  // 5. Validação FIN-001: SUM(debits) === SUM(credits) para todo ativo movimentado
  for (const [assetId, netBalance] of assetBalance.entries()) {
    if (netBalance !== 0n) {
      throw new Error(
        `Desbalanceamento contábil no plano para o ativo #${assetId}: soma dos débitos difere da soma dos créditos (diferença: ${netBalance.toString()}).`
      );
    }
  }

  // 6. Invariantes de mutação de saldo e confronto estrito com as pernas contábeis
  if (!Array.isArray(plan.balanceMutations)) {
    throw new Error('PostingPlan corrompido: balanceMutations deve ser uma lista (Array).');
  }

  const mutationAccountSet = new Set<string>();

  for (let i = 0; i < plan.balanceMutations.length; i++) {
    const mutation = plan.balanceMutations[i];
    const mutationAccId = parsePositiveSafeIntegerId(mutation.accountId, `balanceMutations[${i}].accountId`);
    const mutationAssetId = parsePositiveSafeIntegerId(mutation.assetId, `balanceMutations[${i}].assetId`);
    const mutationKey = `${mutationAccId}:${mutationAssetId}`;

    // Proteção contra duplicação de mutação para a mesma conta/ativo no mesmo plano
    if (mutationAccountSet.has(mutationKey)) {
      throw new Error(
        `Mutação duplicada detectada no PostingPlan para a conta #${mutationAccId} e ativo #${mutationAssetId}.`
      );
    }
    mutationAccountSet.add(mutationKey);

    // Confronto contábil: a conta mutada DEVE estar presente nas pernas contábeis
    if (!activeLegAccounts.has(mutationKey)) {
      throw new Error(
        `Inconsistência de projeção: mutação de saldo na conta #${mutationAccId} (ativo #${mutationAssetId}) não possui perna contábil correspondente.`
      );
    }

    if (typeof mutation.signedDeltaBaseUnits !== 'bigint') {
      throw new Error(`signedDeltaBaseUnits em balanceMutations[${i}] deve ser bigint.`);
    }

    // Confrontação Matemática do Delta: O valor absoluto da mutação deve coincidir com o fluxo das pernas
    const debits = accountDebits.get(mutationKey) ?? 0n;
    const credits = accountCredits.get(mutationKey) ?? 0n;
    const legDiff = debits > credits ? debits - credits : credits - debits;
    const absMutationDelta =
      mutation.signedDeltaBaseUnits < 0n
        ? -mutation.signedDeltaBaseUnits
        : mutation.signedDeltaBaseUnits;

    if (absMutationDelta !== legDiff) {
      throw new Error(
        `Inconsistência matemática: mutação de saldo (${mutation.signedDeltaBaseUnits}) na conta #${mutationAccId} (ativo #${mutationAssetId}) diverge do montante líquido das pernas contábeis (${legDiff}).`
      );
    }

    if (absMutationDelta > MAX_UINT256) {
      throw new Error(`signedDeltaBaseUnits na mutação #${i} excede a amplitude permitida de 256 bits.`);
    }

    if (!Number.isSafeInteger(mutation.expectedVersion) || mutation.expectedVersion < 0) {
      throw new Error(
        `expectedVersion inválida em balanceMutations[${i}]: ${mutation.expectedVersion}. Deve ser inteiro seguro >= 0.`
      );
    }

    if (typeof mutation.newAvailableBaseUnits !== 'string') {
      throw new Error(`newAvailableBaseUnits em balanceMutations[${i}] deve ser string.`);
    }

    if (mutation.newAvailableBaseUnits.length > MAX_NUMERIC_RAW_TEXT_CEILING) {
      throw new Error(`newAvailableBaseUnits em balanceMutations[${i}] excede o teto anti-DoS.`);
    }

    const trimmedNewAvailable = mutation.newAvailableBaseUnits.trim();
    if (!CANONICAL_NON_NEGATIVE_BASE_UNITS_PATTERN.test(trimmedNewAvailable)) {
      throw new Error(
        `newAvailableBaseUnits em balanceMutations[${i}] deve ser um inteiro decimal canônico não-negativo.`
      );
    }

    if (trimmedNewAvailable.length > MAX_UINT256_DECIMAL_DIGITS) {
      throw new Error(`newAvailableBaseUnits em balanceMutations[${i}] excede o teto decimal de 256 bits.`);
    }

    const bigintNewAvailable = BigInt(trimmedNewAvailable);
    if (bigintNewAvailable < 0n || bigintNewAvailable > MAX_UINT256) {
      throw new Error(`newAvailableBaseUnits em balanceMutations[${i}] fora dos limites uint256.`);
    }
  }

  // 7. Cobertura bidirecional: toda conta movimentada nas pernas deve possuir mutação de saldo correspondente
  for (const legKey of activeLegAccounts) {
    if (!mutationAccountSet.has(legKey)) {
      throw new Error(
        `Inconsistência de cobertura: perna contábil para '${legKey}' não possui mutação de saldo projetada em balanceMutations.`
      );
    }
  }
}
