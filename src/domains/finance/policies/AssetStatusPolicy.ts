import { AssetInactiveError } from '../errors/FinancialError';
import { Result } from '../../../shared/kernel/Result';
import { parsePositiveSafeIntegerId } from '../value-objects/Money256';

export type AssetStatus =
  | 'active'
  | 'inactive'
  | 'suspended'
  | 'blocked'
  | 'retired'
  | 'pending';

export interface AssetStatusContext {
  id: number | string;
  status: AssetStatus;
  code?: string;
}

const KNOWN_ASSET_STATUSES = Object.freeze([
  'active',
  'inactive',
  'suspended',
  'blocked',
  'retired',
  'pending',
] as const);

export class AssetStatusPolicy {
  /**
   * Mantemos os overloads originais para preservar compatibilidade.
   *
   * Forma canônica:
   *   validateActive({ id, status, code })
   *
   * Forma compatível:
   *   validateActive(assetId, status)
   */
  public static validateActive(
    asset: AssetStatusContext
  ): void;

  public static validateActive(
    assetId: number | string,
    status: string
  ): void;

  public static validateActive(
    assetInput: AssetStatusContext | number | string,
    status?: string
  ): void {
    const context = AssetStatusPolicy.normalizeContext(
      assetInput,
      status
    );

    const assetId = parsePositiveSafeIntegerId(
      context.id,
      'asset.id'
    );

    if (!AssetStatusPolicy.isAssetStatus(context.status)) {
      throw new AssetInactiveError(
        `Ativo financeiro #${assetId} possui status inválido: "${String(
          context.status
        )}".`
      );
    }

    if (context.status !== 'active') {
      const code =
        typeof context.code === 'string' &&
        context.code.trim().length > 0
          ? AssetStatusPolicy.normalizeDisplayCode(context.code)
          : 'desconhecido';

      throw new AssetInactiveError(
        `Ativo financeiro #${assetId} (${code}) está com status "${context.status}". ` +
          'Operações financeiras exigem que o ativo esteja ativo.'
      );
    }
  }

  /**
   * Validação equivalente usando Result.
   *
   * Mantida para compatibilidade com callers que adotam o padrão Result.
   */
  public static validateActiveResult(
    assetId: string | number,
    status: string
  ): Result<void> {
    try {
      const normalizedAssetId =
        parsePositiveSafeIntegerId(
          assetId,
          'asset.id'
        );

      if (!AssetStatusPolicy.isAssetStatus(status)) {
        return Result.fail(
          `Operação bloqueada por política de domínio: Ativo ${normalizedAssetId} possui status inválido '${String(
            status
          )}'.`
        );
      }

      if (status !== 'active') {
        return Result.fail(
          `Operação bloqueada por política de domínio: Ativo ${normalizedAssetId} está com status '${status}' (esperado: 'active').`
        );
      }

      return Result.ok(undefined);
    } catch (error) {
      return Result.fail(
        error instanceof Error
          ? error.message
          : 'Falha ao validar o status do ativo financeiro.'
      );
    }
  }

  /**
   * Runtime type guard para status conhecidos.
   */
  public static isAssetStatus(
    value: unknown
  ): value is AssetStatus {
    return (
      typeof value === 'string' &&
      (KNOWN_ASSET_STATUSES as readonly string[]).includes(value)
    );
  }

  /**
   * Normaliza as duas formas públicas de entrada em um único
   * contrato interno.
   */
  private static normalizeContext(
    assetInput: AssetStatusContext | number | string,
    status?: string
  ): AssetStatusContext {
    if (
      assetInput !== null &&
      typeof assetInput === 'object' &&
      !Array.isArray(assetInput)
    ) {
      const context = assetInput as AssetStatusContext;

      if (
        !('id' in context) ||
        !('status' in context)
      ) {
        throw new AssetInactiveError(
          'Contexto de ativo financeiro incompleto.'
        );
      }

      return {
        id: context.id,
        status: context.status,
        code:
          typeof context.code === 'string'
            ? context.code.trim()
            : undefined,
      };
    }

    if (
      typeof assetInput === 'number' ||
      typeof assetInput === 'string'
    ) {
      if (typeof status !== 'string') {
        throw new AssetInactiveError(
          'Status do ativo financeiro é obrigatório.'
        );
      }

      return {
        id: assetInput,
        status: status as AssetStatus,
      };
    }

    throw new AssetInactiveError(
      'Contexto de ativo financeiro inválido.'
    );
  }

  /**
   * Evita que dados de apresentação com caracteres de controle
   * poluam mensagens de erro/log.
   */
  private static normalizeDisplayCode(
    value: string
  ): string {
    const normalized = value.normalize('NFC').trim();

    if (/[\u0000-\u001F\u007F]/u.test(normalized)) {
      return 'desconhecido';
    }

    return normalized;
  }
}
