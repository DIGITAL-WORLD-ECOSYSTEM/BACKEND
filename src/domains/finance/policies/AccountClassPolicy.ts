import { InvalidAccountClassError } from '../errors/FinancialError';

export class AccountClassPolicy {
  private static readonly PERMITTED_CLASSES: Record<string, string[]> = {
    user_available: ['liability'],
    treasury: ['asset'],
    operating: ['asset'],
    fees: ['revenue'],
    reserve: ['asset', 'liability'],
    escrow: ['liability'],
    reward_expense: ['expense'],
    yield_expense: ['expense'],
    clearing: ['asset', 'liability'],
    opening_balance_equity: ['equity', 'liability'],
    payment_revenue: ['revenue'],
    refund_expense: ['expense'],
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
