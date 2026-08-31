import { Result } from '../../../shared/kernel/Result';

export class AssetStatusPolicy {
  /**
   * Bloqueia movimentações se o ativo financeiro não estiver ativo (DOD-10).
   */
  static validateActive(assetId: string | number, status: string): Result<void> {
    if (status !== 'active') {
      return Result.fail(`Operação bloqueada por política de domínio: Ativo ${assetId} está com status '${status}' (esperado: 'active').`);
    }
    return Result.ok(undefined);
  }
}
