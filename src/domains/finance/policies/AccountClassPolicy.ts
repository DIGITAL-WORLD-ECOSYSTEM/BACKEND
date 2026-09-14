import { InvalidAccountClassError } from '../errors/FinancialError';

export type FinancialAccountType =
  | 'user_available'
  | 'treasury'
  | 'operating'
  | 'fees'
  | 'reserve'
  | 'escrow'
  | 'reward_expense'
  | 'yield_expense'
  | 'clearing'
  | 'opening_balance_equity'
  | 'payment_revenue'
  | 'refund_expense';

export type FinancialAccountClass =
  | 'asset'
  | 'liability'
  | 'revenue'
  | 'expense'
  | 'equity';

const PERMITTED_CLASSES: Readonly<
  Record<FinancialAccountType, readonly FinancialAccountClass[]>
> = Object.freeze({
  user_available: Object.freeze(['liability'] as const),
  treasury: Object.freeze(['asset'] as const),
  operating: Object.freeze(['asset'] as const),
  fees: Object.freeze(['revenue'] as const),
  reserve: Object.freeze(['asset', 'liability'] as const),
  escrow: Object.freeze(['liability'] as const),
  reward_expense: Object.freeze(['expense'] as const),
  yield_expense: Object.freeze(['expense'] as const),
  clearing: Object.freeze(['asset', 'liability'] as const),
  opening_balance_equity: Object.freeze(['equity', 'liability'] as const),
  payment_revenue: Object.freeze(['revenue'] as const),
  refund_expense: Object.freeze(['expense'] as const),
});

export class AccountClassPolicy {
  /**
   * Valida se o tipo de conta pode utilizar a classe contábil informada.
   *
   * A assinatura continua aceitando string para preservar compatibilidade
   * com callers existentes. A validação real ocorre em runtime.
   */
  public static validate(
    accountType: string,
    accountClass: string
  ): void {
    if (
      typeof accountType !== 'string' ||
      accountType.trim().length === 0
    ) {
      throw new InvalidAccountClassError(
        String(accountType),
        String(accountClass)
      );
    }

    if (
      typeof accountClass !== 'string' ||
      accountClass.trim().length === 0
    ) {
      throw new InvalidAccountClassError(
        accountType,
        String(accountClass)
      );
    }

    const normalizedAccountType = accountType.trim();
    const normalizedAccountClass = accountClass.trim();

    if (!AccountClassPolicy.isFinancialAccountType(normalizedAccountType)) {
      throw new InvalidAccountClassError(
        normalizedAccountType,
        normalizedAccountClass
      );
    }

    if (
      !AccountClassPolicy.isFinancialAccountClass(normalizedAccountClass)
    ) {
      throw new InvalidAccountClassError(
        normalizedAccountType,
        normalizedAccountClass
      );
    }

    const allowed = PERMITTED_CLASSES[normalizedAccountType];

    if (!allowed.includes(normalizedAccountClass)) {
      throw new InvalidAccountClassError(
        normalizedAccountType,
        normalizedAccountClass
      );
    }
  }

  /**
   * Retorna a classe default somente quando houver exatamente uma
   * classe possível. Nunca escolhe arbitrariamente a primeira opção
   * de uma matriz com múltiplas possibilidades.
   */
  public static getDefaultClass(
    accountType: string
  ): FinancialAccountClass {
    if (
      typeof accountType !== 'string' ||
      accountType.trim().length === 0
    ) {
      throw new InvalidAccountClassError(
        String(accountType),
        'default_not_deterministic'
      );
    }

    const normalizedAccountType = accountType.trim();

    if (!AccountClassPolicy.isFinancialAccountType(normalizedAccountType)) {
      throw new InvalidAccountClassError(
        normalizedAccountType,
        'unknown'
      );
    }

    const allowed = PERMITTED_CLASSES[normalizedAccountType];

    if (allowed.length !== 1) {
      throw new InvalidAccountClassError(
        normalizedAccountType,
        'default_not_deterministic'
      );
    }

    return allowed[0];
  }

  /**
   * Runtime type guard para tipos de conta conhecidos.
   */
  public static isFinancialAccountType(
    value: unknown
  ): value is FinancialAccountType {
    return (
      typeof value === 'string' &&
      Object.prototype.hasOwnProperty.call(
        PERMITTED_CLASSES,
        value
      )
    );
  }

  /**
   * Runtime type guard para classes contábeis conhecidas.
   */
  public static isFinancialAccountClass(
    value: unknown
  ): value is FinancialAccountClass {
    return (
      value === 'asset' ||
      value === 'liability' ||
      value === 'revenue' ||
      value === 'expense' ||
      value === 'equity'
    );
  }

  /**
   * Retorna uma cópia imutável da matriz de classes permitidas.
   *
   * A cópia evita exposição direta da estrutura interna da policy.
   */
  public static getPermittedClasses(
    accountType: string
  ): readonly FinancialAccountClass[] {
    if (typeof accountType !== 'string') {
      throw new InvalidAccountClassError(String(accountType), 'unknown');
    }

    const normalized = accountType.trim();
    if (!AccountClassPolicy.isFinancialAccountType(normalized)) {
      throw new InvalidAccountClassError(normalized, 'unknown');
    }

    return PERMITTED_CLASSES[normalized];
  }
}
