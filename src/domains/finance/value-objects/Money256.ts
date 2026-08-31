import { InvalidMoneyFormatError, Money256OverflowError } from '../errors/FinancialError';

export const MAX_UINT256 = (1n << 256n) - 1n; // 2^256 - 1

export function parsePositiveSafeIntegerId(id: number | string, name = 'id'): number {
  const numericId = typeof id === 'number' ? id : Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0 || numericId > Number.MAX_SAFE_INTEGER) {
    throw new InvalidMoneyFormatError(`Invalid physical ${name}: ${id}`);
  }
  return numericId;
}

export class Money256 {
  public readonly amount: bigint;
  public readonly assetId: number;

  constructor(amount: bigint | string, assetId: number | string) {
    this.assetId = parsePositiveSafeIntegerId(assetId, 'assetId');

    if (typeof amount === 'string') {
      this.amount = Money256.parseCanonicalString(amount);
    } else if (typeof amount === 'bigint') {
      Money256.assertValidRange(amount);
      this.amount = amount;
    } else {
      throw new InvalidMoneyFormatError('Money amount must be a bigint or canonical decimal string.');
    }
  }

  public static fromString(amountStr: string, assetId: number | string): Money256 {
    return new Money256(amountStr, assetId);
  }

  public static fromBigInt(amount: bigint, assetId: number | string): Money256 {
    return new Money256(amount, assetId);
  }

  public static parseCanonicalString(str: string): bigint {
    if (typeof str !== 'string' || !/^(0|[1-9]\d*)$/.test(str)) {
      throw new InvalidMoneyFormatError(
        `Invalid canonical decimal string format: "${str}". Must be non-negative integer string without leading zeros, exponent, or signs.`
      );
    }
    const val = BigInt(str);
    Money256.assertValidRange(val);
    return val;
  }

  private static assertValidRange(val: bigint): void {
    if (val < 0n) {
      throw new InvalidMoneyFormatError('Monetary amount cannot be negative.');
    }
    if (val > MAX_UINT256) {
      throw new Money256OverflowError();
    }
  }

  public add(other: Money256): Money256 {
    this.assertSameAsset(other);
    return new Money256(this.amount + other.amount, this.assetId);
  }

  public subtract(other: Money256): Money256 {
    this.assertSameAsset(other);
    if (this.amount < other.amount) {
      throw new InvalidMoneyFormatError('Subtraction resulting in negative balance is prohibited.');
    }
    return new Money256(this.amount - other.amount, this.assetId);
  }

  public isZero(): boolean {
    return this.amount === 0n;
  }

  public isPositive(): boolean {
    return this.amount > 0n;
  }

  public equals(other: Money256): boolean {
    return this.assetId === other.assetId && this.amount === other.amount;
  }

  public toCanonicalString(): string {
    return this.amount.toString(10);
  }

  public toBigInt(): bigint {
    return this.amount;
  }

  private assertSameAsset(other: Money256): void {
    if (this.assetId !== other.assetId) {
      throw new InvalidMoneyFormatError(
        `Cannot perform arithmetic on different assets: ${this.assetId} and ${other.assetId}`
      );
    }
  }
}
