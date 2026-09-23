import { AssetInactiveError, InvalidIdentifierError } from '../errors/FinancialError';
import { parsePositiveSafeIntegerId } from '../value-objects/Money256';
import { Result } from '../../../shared/kernel/Result';
import { DANGEROUS_TEXT_CHARACTERS_REGEX } from './FinancialTextPolicy';

/**
 * Catálogo canônico de status de ativos financeiros.
 * Preserva integralmente os 6 estados conhecidos na arquitetura.
 */
export const ASSET_STATUSES = [
  'active',
  'inactive',
  'suspended',
  'blocked',
  'retired',
  'pending',
] as const;

export type AssetStatus = (typeof ASSET_STATUSES)[number];

export function isAssetStatus(value: unknown): value is AssetStatus {
  return typeof value === 'string' && ASSET_STATUSES.includes(value as AssetStatus);
}

function normalizeDisplayCode(code?: string): string {
  if (!code || typeof code !== 'string') {
    return 'desconhecido';
  }
  const normalized = code.normalize('NFC').trim();
  if (!normalized || DANGEROUS_TEXT_CHARACTERS_REGEX.test(normalized)) {
    return 'desconhecido';
  }
  return normalized;
}

export class AssetStatusPolicy {
  /**
   * Avalia se um ativo é negociável/transacionável operacionalmente.
   * Somente ativos 'active' podem ser movimentados em transações contábeis.
   */
  public static isTradeable(status: string | AssetStatus): boolean {
    return status === 'active';
  }

  /**
   * Bloqueia movimentações se o ativo financeiro não estiver ativo (DOD-10).
   * Suporta chamada com objeto { id, status, code } ou com parâmetros posicionais (assetId, status).
   * Preservado para compatibilidade integral de API com a Fase 2 e testes.
   */
  public static validateActive(asset: { id: number | string; status: string; code?: string }): void;
  public static validateActive(assetId: number | string, status: string): void;
  public static validateActive(
    assetInput: { id: number | string; status: string; code?: string } | number | string,
    status?: string
  ): void {
    let assetId: number | string;
    let assetStatus: string;
    let code: string | undefined;

    if (typeof assetInput === 'object' && assetInput !== null) {
      assetId = assetInput.id;
      assetStatus = assetInput.status;
      code = assetInput.code;
    } else {
      assetId = assetInput;
      assetStatus = status || '';
    }

    const numericId = parsePositiveSafeIntegerId(assetId, 'assetId');

    if (assetStatus !== 'active') {
      const displayCode = normalizeDisplayCode(code);
      throw new AssetInactiveError(
        `Ativo financeiro #${numericId} (${displayCode}) está com status "${assetStatus}". Operações financeiras exigem que o ativo esteja ativo.`
      );
    }
  }

  /**
   * Validação canônica estilo Result kernel sem lançar exceção.
   */
  public static validateActiveResult(assetId: string | number, status: string): Result<void> {
    let numericId: number;
    try {
      numericId = parsePositiveSafeIntegerId(assetId, 'assetId');
    } catch {
      return Result.fail('Identificador de ativo inválido.');
    }

    if (!isAssetStatus(status)) {
      return Result.fail(
        `Operação bloqueada por política de domínio: Ativo ${numericId} possui status inválido: '${status}'.`
      );
    }

    if (status !== 'active') {
      return Result.fail(
        `Operação bloqueada por política de domínio: Ativo ${numericId} está com status '${status}' (esperado: 'active').`
      );
    }

    return Result.ok(undefined);
  }

  /**
   * Afirmação de transacionabilidade para operações de negócio.
   */
  public static assertCanTransact(status: string | AssetStatus, assetId: number | string): void {
    const numericId = parsePositiveSafeIntegerId(assetId, 'assetId');
    if (!this.isTradeable(status)) {
      throw new AssetInactiveError(
        `Asset #${numericId} is not active (status: ${status}) and cannot be transacted.`
      );
    }
  }
}
