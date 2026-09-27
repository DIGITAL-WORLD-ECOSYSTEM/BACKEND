/**
 * Contratos e Políticas Formais de Autorização e Custódia do Finance Core.
 *
 * Garante que nenhuma operação contábil ou financeira possa ser despachada sem
 * a comprovação explícita e soberana da autoridade do ator sobre a conta debitada.
 *
 * Invariantes P0 Hardened (OCaps / Fail-Closed):
 * 1. Imutabilidade absoluta: todos os contratos, contextos e decisões são congelados em runtime (Object.freeze).
 * 2. Princípio do Menor Privilégio: eliminação de bypasses incondicionais para principalType === 'system'.
 *    Operações de estorno contábil (reversal) e custódia sistêmica (refund, adjustment, fee, reward, yield)
 *    exigem autoridade sistêmica genesis (principalId === 0) ou capabilities dedicadas explícitas.
 * 3. Segregação Estrita de Escopo: operações de usuário (transfer, withdrawal, payment, deposit) sob titularidade
 *    própria (SELF) limitam-se a transações onde o principal é o proprietário da conta debitada.
 * 4. Não-Forjabilidade de Provenance: contextos registrados e verificados em runtime contra forjamento estrutural.
 * 5. Validação Soberana Fail-Closed: rejeição absoluta de strings vazias, tipos espúrios ou coerções permissivas.
 * 6. Pureza Arquitetural de Domínio: livre de dependências de infraestrutura física, drivers ou frameworks HTTP.
 */

import { parsePositiveSafeIntegerId } from '../value-objects/FinancialIdentifier';

export type PrincipalType = 'user' | 'system' | 'service_account';

/**
 * Type guard soberano para validação de runtime do tipo de principal.
 */
export function isPrincipalType(value: unknown): value is PrincipalType {
  return value === 'user' || value === 'system' || value === 'service_account';
}

/**
 * Catálogo Canônico de Capabilities Financeiras do Domínio.
 */
export const FinanceCapabilities = Object.freeze({
  SystemOperate: 'finance.system.operate',
  SystemReversal: 'finance.system.reversal',
  TransferDelegate: 'finance.transfer.delegate',
  DelegateOperate: 'finance.delegate.operate',
} as const);

/**
 * Códigos Canônicos de Erro de Autorização.
 */
export const AuthorizationErrorCodes = Object.freeze({
  UNAUTHORIZED_CUSTODY: 'UNAUTHORIZED_CUSTODY',
  INVALID_ARGUMENT: 'INVALID_ARGUMENT',
  FORBIDDEN_OPERATION: 'FORBIDDEN_OPERATION',
} as const);

/**
 * Brand nominal opaco para Capabilities de Domínio em conformidade com OCaps.
 */
declare const CapabilityBrand: unique symbol;
export type DomainCapability = string & { readonly [CapabilityBrand]: never };

export interface AuthorizationContext {
  readonly principalId: number;
  readonly principalType: PrincipalType;
  readonly capabilities: ReadonlyArray<DomainCapability | string>;
  readonly delegatedForUserId?: number | null;
  readonly correlationId: string;
}

export type CustodyOperationType =
  | 'transfer'
  | 'withdrawal'
  | 'payment'
  | 'deposit'
  | 'refund'
  | 'adjustment'
  | 'reversal'
  | 'fee'
  | 'reward'
  | 'yield';

/**
 * Type guard para validação de runtime do tipo de operação de custódia.
 */
export function isCustodyOperationType(value: unknown): value is CustodyOperationType {
  return (
    value === 'transfer' ||
    value === 'withdrawal' ||
    value === 'payment' ||
    value === 'deposit' ||
    value === 'refund' ||
    value === 'adjustment' ||
    value === 'reversal' ||
    value === 'fee' ||
    value === 'reward' ||
    value === 'yield'
  );
}

export interface CustodyOperationSpec {
  readonly operationType: CustodyOperationType;
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
 * Registro soberano em memória (WeakSet) de instâncias autênticas e congeladas de AuthorizationContext.
 * Garante provenance e impede que contextos fabricados contornem o processo soberano de emissão.
 */
const AUTHENTIC_CONTEXTS = new WeakSet<object>();

/**
 * Normalizador e validador defensivo de AuthorizationContext.
 * Garante congelamento profundo, verificação rigorosa de integridade e fail-closed absoluto.
 */
export function freezeAuthorizationContext(context: AuthorizationContext): AuthorizationContext {
  if (!context || typeof context !== 'object') {
    throw new Error('AuthorizationContext deve ser um objeto válido.');
  }

  const rawContext = context as unknown as Record<string, unknown>;
  if (!isPrincipalType(rawContext.principalType)) {
    throw new Error(
      `Tipo de principal inválido em AuthorizationContext: '${String(rawContext.principalType)}'. Esperado: 'user' | 'system' | 'service_account'.`
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

  const frozenContext: AuthorizationContext = Object.freeze({
    principalId,
    principalType: context.principalType,
    capabilities,
    delegatedForUserId,
    correlationId: cleanCorrelationId,
  });

  AUTHENTIC_CONTEXTS.add(frozenContext);
  return frozenContext;
}

/**
 * Type guard que atesta se o contexto de autorização foi legitimamente normalizado e emitido.
 */
export function isAuthenticAuthorizationContext(context: unknown): context is AuthorizationContext {
  return typeof context === 'object' && context !== null && AUTHENTIC_CONTEXTS.has(context);
}

export class CustodyAuthorizationPolicy {
  private constructor() {}
  /**
   * Avalia compulsoriamente se o principal possui autoridade soberana
   * para debitar a conta de origem especificada.
   *
   * Regras de Avaliação Soberana:
   * 1. Segregação de Operações: Operações contábeis e de custódia sistêmica (reversal, refund, adjustment, fee, reward, yield)
   *    NUNCA podem ser aprovadas por titularidade simples (SELF).
   * 2. Menor Privilégio Estrito: Principal 'system' não possui bypass cego.
   *    Exige autoridade genesis (principalId === 0) ou capabilities dedicadas ('finance.system.operate' / 'finance.system.reversal').
   * 3. Imutabilidade e Fail-Closed: Todo retorno é compulsoriamente congelado (Object.freeze).
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

    if (!isAuthenticAuthorizationContext(context)) {
      return Object.freeze({
        allowed: false,
        reason: 'Contexto de autorização não-autenticado ou forjado (não emitido via freezeAuthorizationContext).',
        errorCode: 'UNAUTHORIZED_CUSTODY',
      });
    }

    const effectiveContext = context;

    if (!spec || typeof spec !== 'object') {
      return Object.freeze({
        allowed: false,
        reason: 'Especificação da operação de custódia ausente ou malformada.',
        errorCode: 'INVALID_ARGUMENT',
      });
    }

    if (!isPrincipalType(effectiveContext.principalType)) {
      return Object.freeze({
        allowed: false,
        reason: `Tipo de principal inválido: '${String(effectiveContext.principalType)}'.`,
        errorCode: 'INVALID_ARGUMENT',
      });
    }

    if (!isCustodyOperationType(spec.operationType)) {
      return Object.freeze({
        allowed: false,
        reason: `Tipo de operação de custódia inválido: '${String(spec.operationType)}'.`,
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

    const capabilities = Array.isArray(effectiveContext.capabilities) ? effectiveContext.capabilities : [];

    // 1. Operações em Contas Sistêmicas (sourceAccountOwnerId === null: clearing, tesouro, taxas)
    if (spec.sourceAccountOwnerId === null) {
      // 1.1 Processo operacional do sistema (genesis ou com capability explícita)
      if (
        effectiveContext.principalType === 'system' &&
        (effectiveContext.principalId === 0 || capabilities.includes(FinanceCapabilities.SystemOperate))
      ) {
        return Object.freeze({
          allowed: true,
          type: 'SYSTEM',
          actorUserId: null,
          authorizedByUserId: effectiveContext.principalId > 0 ? effectiveContext.principalId : null,
        });
      }

      // 1.2 Service Account ou Usuário Operador com capability explícita
      if (
        (effectiveContext.principalType === 'service_account' || effectiveContext.principalType === 'user') &&
        capabilities.includes(FinanceCapabilities.SystemOperate)
      ) {
        return Object.freeze({
          allowed: true,
          type: 'DELEGATED',
          actorUserId: effectiveContext.principalId,
          authorizedByUserId: effectiveContext.principalId,
        });
      }

      return Object.freeze({
        allowed: false,
        reason: 'Acesso não autorizado para movimentar conta sistêmica: capability finance.system.operate requerida.',
        errorCode: 'UNAUTHORIZED_CUSTODY',
      });
    }

    // 2. Operações de Estorno / Reversão Contábil Específica
    // Nota P0: Reversões NUNCA caem em SELF. Exigem autoridade genesis ou capability explícita de reversão.
    if (spec.operationType === 'reversal') {
      const isGenesis = effectiveContext.principalType === 'system' && effectiveContext.principalId === 0;
      const hasReversalCapability =
        capabilities.includes(FinanceCapabilities.SystemOperate) ||
        capabilities.includes(FinanceCapabilities.SystemReversal);

      if (isGenesis || hasReversalCapability) {
        return Object.freeze({
          allowed: true,
          type: 'SYSTEM',
          actorUserId: null,
          authorizedByUserId: effectiveContext.principalId > 0 ? effectiveContext.principalId : null,
        });
      }

      return Object.freeze({
        allowed: false,
        reason: 'Operação de estorno (reversal) exige privilégio sistêmico genesis ou capability finance.system.reversal.',
        errorCode: 'FORBIDDEN_OPERATION',
      });
    }

    // 3. Operações Administrativas / Contábeis Especiais (refund, adjustment, fee, reward, yield)
    // Nota P0: Usuários regulares NÃO podem autorizar ajustes, taxas ou recompensas por simples titularidade.
    // Menor privilégio estrito: Principal 'system' exige genesis (principalId === 0) ou capability dedicada.
    if (
      spec.operationType === 'refund' ||
      spec.operationType === 'adjustment' ||
      spec.operationType === 'fee' ||
      spec.operationType === 'reward' ||
      spec.operationType === 'yield'
    ) {
      const isGenesis = effectiveContext.principalType === 'system' && effectiveContext.principalId === 0;
      const hasSystemOperate = capabilities.includes(FinanceCapabilities.SystemOperate);

      if (isGenesis || hasSystemOperate) {
        return Object.freeze({
          allowed: true,
          type: 'SYSTEM',
          actorUserId: null,
          authorizedByUserId: effectiveContext.principalId > 0 ? effectiveContext.principalId : null,
        });
      }

      return Object.freeze({
        allowed: false,
        reason: `Operação de ${spec.operationType} exige privilégio de custódia sistêmica genesis ou capability finance.system.operate.`,
        errorCode: 'FORBIDDEN_OPERATION',
      });
    }

    // 4. Operações de Usuário Comum (transfer, withdrawal, payment, deposit) sob Titularidade Própria (SELF)
    if (
      effectiveContext.principalType === 'user' &&
      typeof effectiveContext.principalId === 'number' &&
      effectiveContext.principalId > 0 &&
      typeof spec.sourceAccountOwnerId === 'number' &&
      spec.sourceAccountOwnerId > 0 &&
      effectiveContext.principalId === spec.sourceAccountOwnerId &&
      (spec.operationType === 'transfer' ||
        spec.operationType === 'withdrawal' ||
        spec.operationType === 'payment' ||
        spec.operationType === 'deposit')
    ) {
      return Object.freeze({
        allowed: true,
        type: 'SELF',
        actorUserId: effectiveContext.principalId,
        authorizedByUserId: null,
      });
    }

    // 5. Operação Delegada autorizada para o titular da conta
    if (
      typeof effectiveContext.delegatedForUserId === 'number' &&
      effectiveContext.delegatedForUserId > 0 &&
      typeof spec.sourceAccountOwnerId === 'number' &&
      spec.sourceAccountOwnerId > 0 &&
      effectiveContext.delegatedForUserId === spec.sourceAccountOwnerId &&
      (capabilities.includes(FinanceCapabilities.DelegateOperate) ||
        capabilities.includes(FinanceCapabilities.SystemOperate) ||
        ((spec.operationType === 'transfer' || spec.operationType === 'deposit') &&
          capabilities.includes(FinanceCapabilities.TransferDelegate)))
    ) {
      return Object.freeze({
        allowed: true,
        type: 'DELEGATED',
        actorUserId: effectiveContext.principalId,
        authorizedByUserId: spec.sourceAccountOwnerId,
      });
    }

    // 6. Violação de custódia (Fail-Closed Default)
    return Object.freeze({
      allowed: false,
      reason: `Violação de custódia: O principal #${effectiveContext.principalId} não possui autoridade para debitar a conta #${spec.sourceAccountId} pertencente ao usuário #${spec.sourceAccountOwnerId} na operação '${spec.operationType}'.`,
      errorCode: 'UNAUTHORIZED_CUSTODY',
    });
  }
}
