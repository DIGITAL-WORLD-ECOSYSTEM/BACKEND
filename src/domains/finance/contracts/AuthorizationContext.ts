/**
 * Contratos e Políticas Formais de Autorização e Custódia do Finance Core.
 *
 * Garante que nenhuma operação financeira possa ser despachada sem
 * a comprovação explícita da autoridade do ator sobre a conta debitada.
 */

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
      readonly errorCode: 'UNAUTHORIZED_CUSTODY' | 'FORBIDDEN_OPERATION' | 'INACTIVE_ACCOUNT';
    };

export class CustodyAuthorizationPolicy {
  /**
   * Avalia compulsoriamente se o principal possui autoridade soberana
   * para debitar a conta de origem especificada.
   */
  public static canDebitSourceAccount(
    context: AuthorizationContext,
    spec: CustodyOperationSpec
  ): AuthorizationDecision {
    // 1. Operações Sistêmicas puras (ex: contas de clearing, fees, treasury)
    if (spec.sourceAccountOwnerId === null) {
      if (context.principalType === 'system' || context.principalType === 'service_account') {
        return {
          allowed: true,
          type: 'SYSTEM',
          actorUserId: null,
          authorizedByUserId: context.principalId > 0 ? context.principalId : null,
        };
      }
      if (context.capabilities.includes('finance.system.operate')) {
        return {
          allowed: true,
          type: 'DELEGATED',
          actorUserId: context.principalId,
          authorizedByUserId: context.principalId,
        };
      }
      return {
        allowed: false,
        reason: 'Acesso não autorizado para movimentar conta sistêmica.',
        errorCode: 'UNAUTHORIZED_CUSTODY',
      };
    }

    // 2. Operação Própria (SELF): O principal autenticado é o dono da conta
    if (
      context.principalType === 'user' &&
      context.principalId === spec.sourceAccountOwnerId
    ) {
      return {
        allowed: true,
        type: 'SELF',
        actorUserId: context.principalId,
        authorizedByUserId: null,
      };
    }

    // 3. Operação Sistêmica / Estorno / Reversão / Ajuste Administrativo / Taxa
    if (
      (context.principalType === 'system' ||
        context.capabilities.includes('finance.system.operate') ||
        context.capabilities.includes('finance.system.reversal')) &&
      (spec.operationType === 'reversal' ||
        spec.operationType === 'refund' ||
        spec.operationType === 'adjustment' ||
        spec.operationType === 'fee' ||
        spec.operationType === 'reward' ||
        spec.operationType === 'yield')
    ) {
      return {
        allowed: true,
        type: 'SYSTEM',
        actorUserId: null,
        authorizedByUserId: context.principalId > 0 ? context.principalId : null,
      };
    }

    // 4. Operação Delegada: Operador / Suporte com capacidade explícita
    if (
      context.capabilities.includes('finance.transfer.delegate') &&
      context.delegatedForUserId === spec.sourceAccountOwnerId
    ) {
      return {
        allowed: true,
        type: 'DELEGATED',
        actorUserId: context.principalId,
        authorizedByUserId: context.principalId,
      };
    }

    // 4. Violação de custódia
    return {
      allowed: false,
      reason: `Violação de custódia: O principal #${context.principalId} não possui autoridade para debitar a conta #${spec.sourceAccountId} pertencente ao usuário #${spec.sourceAccountOwnerId}.`,
      errorCode: 'UNAUTHORIZED_CUSTODY',
    };
  }
}
