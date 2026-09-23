/**
 * Escopo Composto e Taxonomia de Idempotência Financeira.
 *
 * Formato canônico:
 * operation_namespace:principal_scope:business_context
 *
 * Exemplos:
 * - finance.transfer:user:123
 * - finance.deposit:user:456
 * - finance.inbox:provider:1
 * - finance.bootstrap:treasury:genesis
 */

export class IdempotencyScope {
  public static create(
    operationNamespace: string,
    principalScope: string,
    businessContext: string = 'default'
  ): string {
    const cleanNamespace = operationNamespace.trim().toLowerCase();
    const cleanScope = principalScope.trim().toLowerCase();
    const cleanContext = businessContext.trim().toLowerCase();
    if (!cleanNamespace || !cleanScope) {
      throw new Error('IdempotencyScope exige namespace e principalScope válidos.');
    }
    return `${cleanNamespace}:${cleanScope}:${cleanContext}`;
  }

  public static forUser(operation: string, userId: number): string {
    return IdempotencyScope.create(`finance.${operation}`, `user:${userId}`);
  }

  public static forProvider(operation: string, providerId: number): string {
    return IdempotencyScope.create(`finance.${operation}`, `provider:${providerId}`);
  }

  public static forSystem(operation: string, context: string = 'genesis'): string {
    return IdempotencyScope.create(`finance.${operation}`, 'system', context);
  }
}

/**
 * Taxonomia Tripla de Idempotência:
 * - CLAIMED: Chave reservada com sucesso para este worker.
 * - COMPLETED: Operação já concluída; replay determinístico.
 * - RETRYABLE_BUSINESS: Falha de negócio estado-dependente (ex: saldo insuficiente); não queima chave.
 * - NON_RETRYABLE: Falha permanente/terminal (ex: requisição malformada); replay da falha.
 * - CONFLICT: Mesma chave reenviada com payload/hash divergente.
 * - IN_PROGRESS: Chave em processamento por outro worker com lease ativo.
 */
export type IdempotencyClaimResult =
  | {
      readonly status: 'CLAIMED';
      readonly leaseGeneration: number;
    }
  | {
      readonly status: 'COMPLETED';
      readonly transactionId: number;
    }
  | {
      readonly status: 'RETRYABLE_BUSINESS';
      readonly failureCode: string;
      readonly reason: string;
    }
  | {
      readonly status: 'NON_RETRYABLE';
      readonly failureCode: string;
      readonly transactionId?: number | null;
      readonly reason: string;
    }
  | {
      readonly status: 'CONFLICT';
      readonly reason: string;
    }
  | {
      readonly status: 'IN_PROGRESS';
      readonly leaseOwner?: string | null;
    };
