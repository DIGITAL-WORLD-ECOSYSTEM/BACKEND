import { AssetInactiveError } from '../errors/FinancialError';
import { Result } from '../../../shared/kernel/Result';

export class AssetStatusPolicy {
  /**
   * Bloqueia movimentações se o ativo financeiro não estiver ativo (DOD-10).
   * Suporta chamada com objeto { id, status, code } ou com parâmetros posicionais (assetId, status).
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

    if (assetStatus !== 'active') {
      throw new AssetInactiveError(
        `Ativo financeiro #${assetId} (${code || 'desconhecido'}) está com status "${assetStatus}". Operações financeiras exigem que o ativo esteja ativo.`
      );
    }
  }

  /**
   * Validação estilo Result kernel sem lançar exceção.
   */
  public static validateActiveResult(assetId: string | number, status: string): Result<void> {
    if (status !== 'active') {
      return Result.fail(`Operação bloqueada por política de domínio: Ativo ${assetId} está com status '${status}' (esperado: 'active').`);
    }
    return Result.ok(undefined);
  }
}

