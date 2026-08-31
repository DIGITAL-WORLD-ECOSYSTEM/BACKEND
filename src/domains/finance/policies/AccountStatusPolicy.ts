import { Result } from '../../../shared/kernel/Result';

export class AccountStatusPolicy {
  /**
   * Bloqueia movimentações se a conta financeira não estiver ativa (DOD-10).
   */
  static validateActive(accountId: string | number, status: string): Result<void> {
    if (status !== 'active') {
      return Result.fail(`Operação bloqueada por política de domínio: Conta ${accountId} está com status '${status}' (esperado: 'active').`);
    }
    return Result.ok(undefined);
  }
}
