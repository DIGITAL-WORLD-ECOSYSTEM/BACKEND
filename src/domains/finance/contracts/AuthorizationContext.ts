/**
 * Contratos e Políticas Formais de Autorização e Custódia do Finance Core.
 *
 * Garante que nenhuma operação contábil ou financeira possa ser despachada sem
 * a comprovação explícita e soberana da autoridade do ator sobre a conta debitada.
 *
 * Invariantes P0 Hardened (OCaps / Fail-Closed):
 * 1. Imutabilidade absoluta: todos os contratos, contextos e decisões são congelados em runtime (Object.freeze).
 * 2. Princípio do Menor Privilégio: service_accounts e operadores exigem capabilities estritas e não-forjáveis.
 * 3. Segregação de Escopo: reversões só autorizam estornos contábeis; delegações só autorizam transferências ou escopos específicos.
 * 4. Validação Soberana Fail-Closed: ausência de coerção permissiva ou defaults de confiança (sem 'tx_anonymous' cego).
 * 5. Pureza de Domínio: livre de dependências de infraestrutura física, drivers ou frameworks HTTP.
 */

import { parsePositiveSafeIntegerId } from '../value-objects/FinancialIdentifier';

export type PrincipalType = 'user' | 'system' | 'service_account';

/**
 * Type guard soberano para validação de runtime do tipo de principal.
 */
export function isPrincipalType(value: unknown): value is PrincipalType {
  return value === 'user' || value === 'system' || value === 'service_account';
}

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
 * Garante congelamento profundo, verificação rigorosa de integridade e fail-closed absoluto.
 */
export function freezeAuthorizationContext(context: AuthorizationContext): AuthorizationContext {
  if (!context || typeof context !== 'object') {
    throw new Error('AuthorizationContext deve ser um objeto válido.');
  }

  if (!isPrincipalType(context.principalType)) {
    throw new Error(
      `Tipo de principal inválido em AuthorizationContext: '${String((context as any).principalType)}'. Esperado: 'user' | 'system' | 'service_account'.`
    );
  }

  // Validação estrita de principalId (53-bit safe integer; 0 é restrito a principalType === 'system')
  let principalId: number;
  if (context.principalType === 'system' && context.principalId === 0) {
    principalId = 0;
  } else {
    principalId = parsePositiveSafeIntegerId(context.principalId, 'context.principalId');
  }

  // Validação estrita de correlationId: não permite strings vazias ou coerção permissiva silenciosa
  if (typeof context.correlationId !== 'string' || context.correlationId.trim().length === 0) {
    throw new Error('context.correlationId deve ser uma string não-vazia.');
  }
  const cleanCorrelationId = context.correlationId.trim();

  // Validação estrita de capabilities
  if (!Array.isArray(context.capabilities)) {
    throw new Error('context.capabilities deve ser uma lista (Array).');
  }

  const sanitizedCapabilities: string[] = [];
  for (let i = 0; i < context.capabilities.length; i++) {
    const cap = context.capabilities[i];
    if (typeof cap !== 'string' || cap.trim().length === 0) {
      throw new Error(`Capability no índice #${i} deve ser uma string não-vazia.`);
    }
    sanitizedCapabilities.push(cap.trim());
  }
  const capabilities = Object.freeze(sanitizedCapabilities);

  // Validação de delegação
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

    if (!isPrincipalType(context.principalType)) {
      return Object.freeze({
        allowed: false,
        reason: `Tipo de principal inválido: '${String(context.principalType)}'.`,
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

    if (!Number.isSafeInteger(spec.sourceAccountId) || spec.sourceAccountId <= 0) {
      return Object.freeze({
        allowed: false,
        reason: `sourceAccountId inválido na especificação: ${spec.sourceAccountId}`,
        errorCode: 'INVALID_ARGUMENT',
      });
    }

    if (!Number.isSafeInteger(spec.assetId) || spec.assetId <= 0) {
      return Object.freeze({
        allowed: false,
        reason: `assetId inválido na especificação: ${spec.assetId}`,
        errorCode: 'INVALID_ARGUMENT',
      });
    }

    const capabilities = Array.isArray(context.capabilities) ? context.capabilities : [];

    // 1. Operações Sistêmicas puras (sourceAccountOwnerId === null: clearing, tesouro, taxas)
    if (spec.sourceAccountOwnerId === null) {
      // 1.1 Processo sistêmico do núcleo operacional (genesis ou com capability explícita)
      if (
        context.principalType === 'system' &&
        (context.principalId === 0 || capabilities.includes('finance.system.operate'))
      ) {
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

    // 2. Operação Própria (SELF): O principal autenticado é o titular físico da conta
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
