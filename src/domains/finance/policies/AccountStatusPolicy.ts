import { AccountInactiveError } from '../errors/FinancialError';

export class AccountStatusPolicy {
  public static validateActive(account: { id: number; status: string; name?: string }): void {
    if (account.status !== 'active') {
      throw new AccountInactiveError(
        `Conta financeira #${account.id} (${account.name || 'desconhecida'}) está com status "${account.status}". Movimentações somente são permitidas em contas ativas.`
      );
    }
  }
}

