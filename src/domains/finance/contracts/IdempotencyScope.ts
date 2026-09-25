import { parsePositiveSafeIntegerId } from '../value-objects/FinancialIdentifier';

/**
 * Padrão canônico para segmentos de escopo de idempotência.
 * Permite apenas caracteres alfanuméricos minúsculos, pontos, sublinhados e hífens.
 * Proíbe explicitamente dois-pontos (:) para garantir codificação estritamente injetiva e anti-colisão.
 */
const CANONICAL_SCOPE_SEGMENT_PATTERN = /^[a-z0-9._-]+$/;

/**
 * Escopo Composto e Taxonomia Soberana de Idempotência Financeira.
 *
 * Formato canônico:
 * operation_namespace:principal_scope:business_context
 *
 * Invariantes P0 Hardened:
 * 1. Codificação Injetiva: Cada componente é validado contra proibição estrita de delimitadores (:).
 * 2. Validação de Identificadores: IDs numéricos de usuários e provedores passam por Safe Integer (> 0).
 * 3. Sanitização Defensiva: .trim().toLowerCase() e rejeição de strings vazias ou nulas.
 * 4. Imutabilidade: todas as estruturas e retornos de claim congelados em runtime.
 */
export class IdempotencyScope {
  /**
   * Constrói e valida uma chave de escopo canônica.
   */
  public static create(
    operationNamespace: string,
    principalScope: string,
    businessContext: string = 'default'
  ): string {
    if (typeof operationNamespace !== 'string' || typeof principalScope !== 'string') {
      throw new Error('IdempotencyScope exige namespace e principalScope em formato string.');
    }

    const cleanNamespace = operationNamespace.trim().toLowerCase();
    const cleanScope = principalScope.trim().toLowerCase();
    const cleanContext = (businessContext || 'default').trim().toLowerCase();

    if (!cleanNamespace || !cleanScope || !cleanContext) {
      throw new Error('IdempotencyScope exige namespace, principalScope e context não-vazios.');
    }

    if (
      !CANONICAL_SCOPE_SEGMENT_PATTERN.test(cleanNamespace) ||
      !CANONICAL_SCOPE_SEGMENT_PATTERN.test(cleanScope) ||
      !CANONICAL_SCOPE_SEGMENT_PATTERN.test(cleanContext)
    ) {
      throw new Error(
        `Segmento de IdempotencyScope inválido. Caracteres permitidos: [a-z0-9._-]. Delimitadores (:) são proibidos.`
      );
    }

    return `${cleanNamespace}:${cleanScope}:${cleanContext}`;
  }

  public static forUser(operation: string, userId: number): string {
    const validUserId = parsePositiveSafeIntegerId(userId, 'userId');
    const cleanOp = (operation || '').trim().toLowerCase();
    return IdempotencyScope.create(`finance.${cleanOp}`, 'user', String(validUserId));
  }

  public static forProvider(operation: string, providerId: number): string {
    const validProviderId = parsePositiveSafeIntegerId(providerId, 'providerId');
    const cleanOp = (operation || '').trim().toLowerCase();
    return IdempotencyScope.create(`finance.${cleanOp}`, 'provider', String(validProviderId));
  }

  public static forSystem(operation: string, context: string = 'genesis'): string {
    const cleanOp = (operation || '').trim().toLowerCase();
    return IdempotencyScope.create(`finance.${cleanOp}`, 'system', context);
  }
}

/**
 * Taxonomia Sextupla de Idempotência:
 * - CLAIMED: Chave reservada com sucesso para este worker transacional.
 * - COMPLETED: Operação já concluída; replay determinístico autorizado.
 * - RETRYABLE_BUSINESS: Falha de negócio estado-dependente (ex: saldo insuficiente); não queima chave.
 * - NON_RETRYABLE: Falha permanente/terminal (ex: requisição malformada); replay da falha.
 * - CONFLICT: Mesma chave reenviada com payload/hash divergente.
 * - IN_PROGRESS: Chave em processamento concorrente por outro worker com lease ativo.
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
