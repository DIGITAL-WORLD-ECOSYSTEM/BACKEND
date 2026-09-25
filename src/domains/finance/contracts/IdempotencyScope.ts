import { parsePositiveSafeIntegerId } from '../value-objects/FinancialIdentifier';

/**
 * Padrão canônico para segmentos de escopo de idempotência.
 * Permite apenas caracteres alfanuméricos minúsculos, pontos, sublinhados e hífens.
 * Proíbe explicitamente dois-pontos (:) para garantir codificação estritamente injetiva e anti-colisão.
 */
const CANONICAL_SCOPE_SEGMENT_PATTERN = /^[a-z0-9._-]+$/;

/**
 * Limites máximos de proteção contra DoS em memória para chaves e segmentos de escopo.
 */
export const MAX_SCOPE_SEGMENT_LENGTH = 128;
export const MAX_SCOPE_KEY_LENGTH = 512;

/**
 * Validador canônico defensivo e simétrico para segmentos individuais de escopo.
 */
function validateScopeSegment(segment: string, segmentName: string): string {
  if (typeof segment !== 'string') {
    throw new Error(`Segmento de IdempotencyScope '${segmentName}' deve ser uma string.`);
  }

  const clean = segment.trim().toLowerCase();

  if (clean.length === 0) {
    throw new Error(`Segmento de IdempotencyScope '${segmentName}' não pode ser vazio.`);
  }

  if (clean.length > MAX_SCOPE_SEGMENT_LENGTH) {
    throw new Error(
      `Segmento de IdempotencyScope '${segmentName}' excede o limite máximo de ${MAX_SCOPE_SEGMENT_LENGTH} caracteres (tamanho: ${clean.length}).`
    );
  }

  if (clean.includes(':')) {
    throw new Error(
      `Segmento de IdempotencyScope '${segmentName}' não pode conter o delimitador dois-pontos (:).`
    );
  }

  if (clean.startsWith('.') || clean.endsWith('.') || clean.includes('..')) {
    throw new Error(
      `Segmento de IdempotencyScope '${segmentName}' contém formato de pontos espúrio ou inválido: '${clean}'.`
    );
  }

  if (!CANONICAL_SCOPE_SEGMENT_PATTERN.test(clean)) {
    throw new Error(
      `Segmento de IdempotencyScope '${segmentName}' contém caracteres inválidos: '${clean}'. Permitido apenas [a-z0-9._-].`
    );
  }

  return clean;
}

/**
 * Escopo Composto e Taxonomia Soberana de Idempotência Financeira.
 *
 * Formato canônico:
 * operation_namespace:principal_scope:business_context
 *
 * Invariantes P0 Hardened (Anti-Colisão / Fail-Closed):
 * 1. Codificação Injetiva Simétrica: Todos os componentes passam pela mesma validação estrita anti-colisão.
 * 2. Tetos Anti-DoS: Segmentos limitados a 128 chars e chave total limitada a 512 chars.
 * 3. Validação de Identificadores: IDs numéricos de usuários e provedores passam por Safe Integer (> 0).
 * 4. Sanitização Defensiva: .trim().toLowerCase() e rejeição de strings vazias, operações nulas ou namespaces malformados.
 * 5. Imutabilidade: todas as estruturas e retornos de claim congelados em runtime.
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
    const cleanNamespace = validateScopeSegment(operationNamespace, 'operationNamespace');
    const cleanScope = validateScopeSegment(principalScope, 'principalScope');
    const cleanContext = validateScopeSegment(businessContext || 'default', 'businessContext');

    const composedKey = `${cleanNamespace}:${cleanScope}:${cleanContext}`;

    if (composedKey.length > MAX_SCOPE_KEY_LENGTH) {
      throw new Error(
        `Chave de IdempotencyScope excede o limite máximo de ${MAX_SCOPE_KEY_LENGTH} caracteres (tamanho: ${composedKey.length}).`
      );
    }

    return composedKey;
  }

  public static forUser(operation: string, userId: number): string {
    const validUserId = parsePositiveSafeIntegerId(userId, 'userId');
    if (typeof operation !== 'string' || operation.trim().length === 0) {
      throw new Error('IdempotencyScope.forUser exige um nome de operação não-vazio.');
    }
    const cleanOp = validateScopeSegment(operation, 'operation');
    return IdempotencyScope.create(`finance.${cleanOp}`, 'user', String(validUserId));
  }

  public static forProvider(operation: string, providerId: number): string {
    const validProviderId = parsePositiveSafeIntegerId(providerId, 'providerId');
    if (typeof operation !== 'string' || operation.trim().length === 0) {
      throw new Error('IdempotencyScope.forProvider exige um nome de operação não-vazio.');
    }
    const cleanOp = validateScopeSegment(operation, 'operation');
    return IdempotencyScope.create(`finance.${cleanOp}`, 'provider', String(validProviderId));
  }

  public static forSystem(operation: string, context: string = 'genesis'): string {
    if (typeof operation !== 'string' || operation.trim().length === 0) {
      throw new Error('IdempotencyScope.forSystem exige um nome de operação não-vazio.');
    }
    const cleanOp = validateScopeSegment(operation, 'operation');
    const cleanCtx = validateScopeSegment(context || 'genesis', 'context');
    return IdempotencyScope.create(`finance.${cleanOp}`, 'system', cleanCtx);
  }
}

/**
 * Taxonomia Sextupla de Idempotência:
 * - CLAIMED: Chave reservada com sucesso para este worker transacional com lease generation ativo.
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
      readonly leaseOwner?: string | null;
      readonly leaseExpiresAtEpochMs?: number | null;
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
      readonly leaseGeneration?: number | null;
      readonly leaseExpiresAtEpochMs?: number | null;
    };
