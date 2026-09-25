/**
 * Contratos e Políticas Formais de Autorização e Custódia do Finance Core.
 *
 * Garante que nenhuma operação contábil ou financeira possa ser despachada sem
 * a comprovação explícita e soberana da autoridade do ator sobre a conta debitada.
 *
 * Invariantes P0 Hardened:
 * 1. Imutabilidade absoluta: todos os contratos e decisões são congelados em runtime.
 * 2. Princípio do Menor Privilégio: service_accounts e operadores exigem capabilities estritas.
 * 3. Segregação de Escopo: reversões só autorizam estornos contábeis; delegações só autorizam transferências.
 * 4. Pureza de Domínio: livre de dependências de infraestrutura física, drivers ou frameworks HTTP.
 */

import { parsePositiveSafeIntegerId } from '../value-objects/FinancialIdentifier';

export type PrincipalType = 'user' | 'system' | 'service_account';

export interface AuthorizationContext {
  readonly principalId: number;
  readonly principalType: PrincipalType;
  readonly capabilities: ReadonlyArray<string>;
  readonly delegatedForUserId?: number | null;
  readonly correlationId: string;
}

export interface CustodyOperationSpec {
  readonly operationType:
    | 'transfer'
    | 'withdrawal'
    | 'payment'
    | 'refund'
    | 'adjustment'
    | 'reversal'
    | 'fee'
    | 'reward'
    | 'yield';
  readonly sourceAccountId: number;
  readonly sourceAccountOwnerId: number | null;
  readonly destinationAccountId?: number | null;
  readonly destinationAccountOwnerId?: number | null;
  readonly assetId: number;
  readonly amountBaseUnits: bigint;
}

export type AuthorizationDecision =
  | {
      readonly allowed: true;
      readonly type: 'SELF';
      readonly actorUserId: number;
      readonly authorizedByUserId: null;
    }
  | {
      readonly allowed: true;
      readonly type: 'DELEGATED';
      readonly actorUserId: number;
      readonly authorizedByUserId: number;
    }
  | {
      readonly allowed: true;
      readonly type: 'SYSTEM';
      readonly actorUserId: null;
      readonly authorizedByUserId: number | null;
    }
  | {
      readonly allowed: false;
      readonly reason: string;
      readonly errorCode:
        | 'UNAUTHORIZED_CUSTODY'
        | 'FORBIDDEN_OPERATION'
        | 'INACTIVE_ACCOUNT'
        | 'INVALID_ARGUMENT';
    };

/**
 * Normalizador e validador defensivo de AuthorizationContext.
 * Garante congelamento profundo e tipos estritos em runtime.
 */
export function freezeAuthorizationContext(context: AuthorizationContext): AuthorizationContext {
  if (!context || typeof context !== 'object') {
    throw new Error('AuthorizationContext deve ser um objeto válido.');
  }

  const principalId =
    context.principalId === 0 && context.principalType === 'system'
      ? 0
      : parsePositiveSafeIntegerId(context.principalId, 'context.principalId');

  const cleanCorrelationId =
    typeof context.correlationId === 'string' && context.correlationId.trim().length > 0
      ? context.correlationId.trim()
      : 'tx_anonymous';

  const capabilities = Object.freeze(
    Array.isArray(context.capabilities)
      ? context.capabilities.map((c) => String(c).trim())
      : []
  );

  const delegatedForUserId =
    context.delegatedForUserId !== undefined && context.delegatedForUserId !== null
      ? parsePositiveSafeIntegerId(context.delegatedForUserId, 'context.delegatedForUserId')
      : null;

  return Object.freeze({
    principalId,
    principalType: context.principalType,
    capabilities,
    delegatedForUserId,
    correlationId: cleanCorrelationId,
  });
}

export class CustodyAuthorizationPolicy {
  /**
   * Avalia compulsoriamente se o principal possui autoridade soberana
   * para debitar a conta de origem especificada.
   *
   * Retorna compulsoriamente um AuthorizationDecision imutável (Object.freeze).
   */
  public static canDebitSourceAccount(
    context: AuthorizationContext,
    spec: CustodyOperationSpec
  ): AuthorizationDecision {
    // 0. Validações preliminares defensivas
    if (!context || typeof context !== 'object') {
      return Object.freeze({
        allowed: false,
        reason: 'Contexto de autorização ausente ou malformado.',
        errorCode: 'INVALID_ARGUMENT',
      });
    }

    if (!spec || typeof spec !== 'object') {
      return Object.freeze({
        allowed: false,
        reason: 'Especificação da operação de custódia ausente ou malformada.',
        errorCode: 'INVALID_ARGUMENT',
      });
    }

    if (typeof spec.amountBaseUnits !== 'bigint' || spec.amountBaseUnits <= 0n) {
      return Object.freeze({
        allowed: false,
        reason: 'Quantia da operação de débito deve ser estritamente positiva em bigint.',
        errorCode: 'FORBIDDEN_OPERATION',
      });
    }

    const capabilities = Array.isArray(context.capabilities) ? context.capabilities : [];

    // 1. Operações Sistêmicas puras (sourceAccountOwnerId === null: clearing, tesouro, taxas)
    if (spec.sourceAccountOwnerId === null) {
      // 1.1 Processo sistêmico do núcleo operacional
      if (context.principalType === 'system') {
        return Object.freeze({
          allowed: true,
          type: 'SYSTEM',
          actorUserId: null,
          authorizedByUserId: context.principalId > 0 ? context.principalId : null,
        });
      }

      // 1.2 Service Account ou Usuário Operador com capability explícita
      if (
        (context.principalType === 'service_account' || context.principalType === 'user') &&
        capabilities.includes('finance.system.operate')
      ) {
        return Object.freeze({
          allowed: true,
          type: 'DELEGATED',
          actorUserId: context.principalId,
          authorizedByUserId: context.principalId,
        });
      }

      return Object.freeze({
        allowed: false,
        reason: 'Acesso não autorizado para movimentar conta sistêmica: capability finance.system.operate requerida.',
        errorCode: 'UNAUTHORIZED_CUSTODY',
      });
    }

    // 2. Operação Própria (SELF): O principal autenticado é o dono físico da conta
    if (
      context.principalType === 'user' &&
      context.principalId === spec.sourceAccountOwnerId
    ) {
      return Object.freeze({
        allowed: true,
        type: 'SELF',
        actorUserId: context.principalId,
        authorizedByUserId: null,
      });
    }

    // 3. Operação de Estorno / Reversão Contábil Específica
    if (
      spec.operationType === 'reversal' &&
      (context.principalType === 'system' ||
        capabilities.includes('finance.system.operate') ||
        capabilities.includes('finance.system.reversal'))
    ) {
      return Object.freeze({
        allowed: true,
        type: 'SYSTEM',
        actorUserId: null,
        authorizedByUserId: context.principalId > 0 ? context.principalId : null,
      });
    }

    // 4. Operações Sistêmicas Administrativas (refund, adjustment, fee, reward, yield)
    if (
      (spec.operationType === 'refund' ||
        spec.operationType === 'adjustment' ||
        spec.operationType === 'fee' ||
        spec.operationType === 'reward' ||
        spec.operationType === 'yield') &&
      (context.principalType === 'system' || capabilities.includes('finance.system.operate'))
    ) {
      return Object.freeze({
        allowed: true,
        type: 'SYSTEM',
        actorUserId: null,
        authorizedByUserId: context.principalId > 0 ? context.principalId : null,
      });
    }

    // 5. Operação Delegada ou Administrativa autorizada para o titular da conta
    if (
      context.delegatedForUserId === spec.sourceAccountOwnerId &&
      (context.capabilities.includes('finance.delegate.operate') ||
        context.capabilities.includes('finance.system.operate') ||
        (spec.operationType === 'transfer' && context.capabilities.includes('finance.transfer.delegate')))
    ) {
      return Object.freeze({
        allowed: true,
        type: 'DELEGATED',
        actorUserId: context.principalId,
        authorizedByUserId: context.principalId,
      });
    }

    // 6. Violação de custódia
    return Object.freeze({
      allowed: false,
      reason: `Violação de custódia: O principal #${context.principalId} não possui autoridade para debitar a conta #${spec.sourceAccountId} pertencente ao usuário #${spec.sourceAccountOwnerId}.`,
      errorCode: 'UNAUTHORIZED_CUSTODY',
    });
  }
}
