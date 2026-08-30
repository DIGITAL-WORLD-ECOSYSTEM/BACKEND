export class Money {
  constructor(
    public readonly amount: bigint,
    public readonly assetId: string
  ) {
    if (typeof amount !== 'bigint') {
      throw new Error('Money amount must be a bigint');
    }
    if (!assetId || !/^[1-9]\d*$/.test(String(assetId))) {
      throw new Error('Money requires a valid physical assetId (positive integer string)');
    }
  }

  add(other: Money): Money {
    this.assertSameAsset(other);
    return new Money(this.amount + other.amount, this.assetId);
  }

  subtract(other: Money): Money {
    this.assertSameAsset(other);
    return new Money(this.amount - other.amount, this.assetId);
  }

  isZero(): boolean {
    return this.amount === 0n;
  }

  isPositive(): boolean {
    return this.amount > 0n;
  }

  isNegative(): boolean {
    return this.amount < 0n;
  }

  equals(other: Money): boolean {
    if (this.assetId !== other.assetId) return false;
    return this.amount === other.amount;
  }

  private assertSameAsset(other: Money) {
    if (this.assetId !== other.assetId) {
      throw new Error(`Cannot perform math on different assets: ${this.assetId} and ${other.assetId}`);
    }
  }
}
