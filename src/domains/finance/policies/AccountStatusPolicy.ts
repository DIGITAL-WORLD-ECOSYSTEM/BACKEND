import { AccountInactiveError } from '../errors/FinancialError';

export type AccountStatus =
  | 'active'
  | 'inactive'
  | 'suspended'
  | 'blocked'
  | 'closed'
  | 'pending';

export interface AccountStatusContext {
  id: number;
  status: AccountStatus;
  name?: string;
}

const KNOWN_ACCOUNT_STATUSES = Object.freeze([
  'active',
  'inactive',
  'suspended',
  'blocked',
  'closed',
  'pending',
] as const);

export class AccountStatusPolicy {
  /**
   * Runtime type guard para status financeiros de conta conhecidos.
   */
  public static isAccountStatus(
    value: unknown
  ): value is AccountStatus {
    return (
      typeof value === 'string' &&
      (KNOWN_ACCOUNT_STATUSES as readonly string[]).includes(value)
    );
  }

  /**
   * Garante que uma conta possa participar de movimentações financeiras.
   *
   * A implementação permanece propositalmente simples:
   * esta policy decide apenas o estado da conta.
   *
   * Não é responsabilidade desta classe:
   * - autorização;
   * - ownership;
   * - RBAC;
   * - saldo;
   * - existência persistida;
   * - regras contábeis.
   */
  public static validateActive(
    account: AccountStatusContext
  ): void {
    if (
      account === null ||
      typeof account !== 'object' ||
      Array.isArray(account)
    ) {
      throw new AccountInactiveError(
        'Conta financeira inválida: contexto de conta ausente ou malformado.'
      );
    }

    if (
      !Number.isSafeInteger(account.id) ||
      account.id <= 0
    ) {
      throw new AccountInactiveError(
        'Conta financeira possui identificador inválido.'
      );
    }

    if (!AccountStatusPolicy.isAccountStatus(account.status)) {
      throw new AccountInactiveError(
        `Conta financeira #${account.id} possui status inválido: "${String(
          account.status
        )}".`
      );
    }

    if (account.status !== 'active') {
      const name =
        typeof account.name === 'string' &&
        account.name.trim().length > 0
          ? account.name.trim()
          : 'desconhecida';

      throw new AccountInactiveError(
        `Conta financeira #${account.id} (${name}) está com status "${account.status}". ` +
          'Movimentações somente são permitidas em contas ativas.'
      );
    }
  }
}
