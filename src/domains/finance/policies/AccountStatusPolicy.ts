import { AccountInactiveError, AssetInactiveError } from '../errors/FinancialError';

export class AccountStatusPolicy {
  public static validateActive(account: { id: number; status: string; name?: string }): void {
    if (account.status !== 'active') {
      throw new AccountInactiveError(
        `Conta financeira #${account.id} (${account.name || 'desconhecida'}) está com status "${account.status}". Movimentações somente são permitidas em contas ativas.`
      );
    }
  }
}

export class AssetStatusPolicy {
  public static validateActive(asset: { id: number; status: string; code?: string }): void {
    if (asset.status !== 'active') {
      throw new AssetInactiveError(
        `Ativo financeiro #${asset.id} (${asset.code || 'desconhecido'}) está com status "${asset.status}". Operações financeiras exigem ativo ativo.`
      );
    }
  }
}
