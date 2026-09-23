import { InvalidAccountClassError } from '../errors/FinancialError';
import { FinancialTextPolicy } from './FinancialTextPolicy';

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

export const PERMITTED_CLASSES: Readonly<
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
  public static readonly PERMITTED_CLASSES = PERMITTED_CLASSES;

  public static getAllowedClasses(accountType: string): readonly FinancialAccountClass[] {
    if (typeof accountType !== 'string') {
      return [];
    }
    const normalized = accountType.trim();
    if (AccountClassPolicy.isFinancialAccountType(normalized)) {
      return PERMITTED_CLASSES[normalized];
    }
    return [];
  }

  /**
   * Sanitiza strings contra log injection removendo caracteres de controle e perigosos.
   */
  private static sanitizeForError(value: unknown): string {
    const stripped = FinancialTextPolicy.stripDangerousCharacters(value).trim();
    return stripped.length > 50 ? stripped.slice(0, 47) + '...' : stripped;
  }

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
    const safeType = AccountClassPolicy.sanitizeForError(accountType);
    const safeClass = AccountClassPolicy.sanitizeForError(accountClass);

    if (
      typeof accountType !== 'string' ||
      accountType.trim().length === 0
    ) {
      throw new InvalidAccountClassError(safeType, safeClass);
    }

    if (
      typeof accountClass !== 'string' ||
      accountClass.trim().length === 0
    ) {
      throw new InvalidAccountClassError(safeType, safeClass);
    }

    const normalizedAccountType = accountType.trim();
    const normalizedAccountClass = accountClass.trim();

    if (!AccountClassPolicy.isFinancialAccountType(normalizedAccountType)) {
      throw new InvalidAccountClassError(safeType, safeClass);
    }

    if (
      !AccountClassPolicy.isFinancialAccountClass(
        normalizedAccountClass
      )
    ) {
      throw new InvalidAccountClassError(safeType, safeClass);
    }

    const allowed = PERMITTED_CLASSES[normalizedAccountType];

    if (
      !(allowed as readonly string[]).includes(
        normalizedAccountClass
      )
    ) {
      throw new InvalidAccountClassError(safeType, safeClass);
    }
  }

  /**
   * Retorna a classe default somente quando houver exatamente uma
   * classe possível.
   *
   * Nunca escolhe arbitrariamente a primeira opção de uma matriz
   * que possua múltiplas classes permitidas.
   */
  public static getDefaultClass(
    accountType: string
  ): FinancialAccountClass {
    const safeType = AccountClassPolicy.sanitizeForError(accountType);

    if (
      typeof accountType !== 'string' ||
      accountType.trim().length === 0
    ) {
      throw new InvalidAccountClassError(
        safeType,
        'default_not_deterministic'
      );
    }

    const normalizedAccountType = accountType.trim();

    if (
      !AccountClassPolicy.isFinancialAccountType(
        normalizedAccountType
      )
    ) {
      throw new InvalidAccountClassError(
        safeType,
        'unknown'
      );
    }

    const allowed = PERMITTED_CLASSES[normalizedAccountType];

    if (allowed.length !== 1) {
      throw new InvalidAccountClassError(
        safeType,
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
   * Retorna a lista imutável de classes permitidas para o tipo informado.
   *
   * A estrutura retornada não pode ser modificada porque tanto a matriz
   * externa quanto suas listas internas são Object.freeze().
   */
  public static getPermittedClasses(
    accountType: string
  ): readonly FinancialAccountClass[] {
    if (typeof accountType !== 'string') {
      throw new InvalidAccountClassError(
        '[invalid accountType]',
        'unknown'
      );
    }

    const normalized = accountType.trim();

    if (!AccountClassPolicy.isFinancialAccountType(normalized)) {
      throw new InvalidAccountClassError(
        normalized,
        'unknown'
      );
    }

    return PERMITTED_CLASSES[normalized];
  }
}
