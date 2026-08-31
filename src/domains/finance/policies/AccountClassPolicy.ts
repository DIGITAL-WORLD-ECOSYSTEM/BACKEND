import { FinancialError } from '../errors/FinancialError';

export class InvalidAccountClassError extends FinancialError {
  constructor(accountType: string, accountClass: string) {
    super(
      `Classe de conta "${accountClass}" é incompatível com o tipo de conta "${accountType}".`,
      'INVALID_ACCOUNT_CLASS',
      false,
      400
    );
  }
}

export class AccountClassPolicy {
  private static readonly PERMITTED_CLASSES: Record<string, string[]> = {
    user_available: ['liability'],
    treasury: ['asset'],
    operating: ['asset'],
    fees: ['revenue'],
    reserve: ['asset', 'liability'],
    escrow: ['liability'],
  };

  public static validate(accountType: string, accountClass: string): void {
    const allowed = AccountClassPolicy.PERMITTED_CLASSES[accountType];
    if (!allowed || !allowed.includes(accountClass)) {
      throw new InvalidAccountClassError(accountType, accountClass);
    }
  }

  public static getDefaultClass(accountType: string): string {
    const allowed = AccountClassPolicy.PERMITTED_CLASSES[accountType];
    if (!allowed || allowed.length === 0) {
      throw new InvalidAccountClassError(accountType, 'unknown');
    }
    return allowed[0];
  }
}
