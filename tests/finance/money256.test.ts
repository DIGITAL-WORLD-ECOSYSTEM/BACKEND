import { describe, it, expect } from 'vitest';
import { Money256, MAX_UINT256 } from '../../src/domains/finance/value-objects/Money256';
import {
  InvalidMoneyFormatError,
  Money256OverflowError,
} from '../../src/domains/finance/errors/FinancialError';

describe('Money256 Value Object (EVM 256-bit Precision)', () => {
  it('parses valid canonical decimal strings correctly', () => {
    const m1 = Money256.fromString('0', 1);
    expect(m1.toCanonicalString()).toBe('0');
    expect(m1.toBigInt()).toBe(0n);

    const m2 = Money256.fromString('1000', 1);
    expect(m2.toCanonicalString()).toBe('1000');
    expect(m2.toBigInt()).toBe(1000n);

    const maxStr = MAX_UINT256.toString(10);
    const mMax = Money256.fromString(maxStr, 1);
    expect(mMax.toBigInt()).toBe(MAX_UINT256);
  });

  it('rejects invalid formatting (exponents, leading zeros, signs, whitespace, decimals)', () => {
    expect(() => Money256.fromString('0001', 1)).toThrow(InvalidMoneyFormatError);
    expect(() => Money256.fromString('00123', 1)).toThrow(InvalidMoneyFormatError);
    expect(() => Money256.fromString('+100', 1)).toThrow(InvalidMoneyFormatError);
    expect(() => Money256.fromString('-50', 1)).toThrow(InvalidMoneyFormatError);
    expect(() => Money256.fromString('1e18', 1)).toThrow(InvalidMoneyFormatError);
    expect(() => Money256.fromString('100.0', 1)).toThrow(InvalidMoneyFormatError);
    expect(() => Money256.fromString(' 100 ', 1)).toThrow(InvalidMoneyFormatError);
  });

  it('throws Money256OverflowError on values exceeding 2^256 - 1', () => {
    const overMax = MAX_UINT256 + 1n;
    expect(() => Money256.fromBigInt(overMax, 1)).toThrow(Money256OverflowError);
  });

  it('executes immutable arithmetic operations safely', () => {
    const a = Money256.fromString('500', 1);
    const b = Money256.fromString('300', 1);

    const sum = a.add(b);
    expect(sum.toCanonicalString()).toBe('800');
    expect(a.toCanonicalString()).toBe('500'); // Immutability

    const diff = a.subtract(b);
    expect(diff.toCanonicalString()).toBe('200');

    expect(() => b.subtract(a)).toThrow(InvalidMoneyFormatError); // Prohibits negative result
  });

  it('prohibits arithmetic across different asset IDs', () => {
    const a = Money256.fromString('100', 1);
    const b = Money256.fromString('100', 2);
    expect(() => a.add(b)).toThrow(InvalidMoneyFormatError);
  });

  it('supports comparison operators (greaterThan, greaterThanOrEqual, lessThan, lessThanOrEqual, zero)', () => {
    const zero = Money256.zero(1);
    const a = Money256.fromString('500', 1);
    const b = Money256.fromString('300', 1);
    const c = Money256.fromString('500', 1);

    expect(zero.isZero()).toBe(true);
    expect(a.greaterThan(b)).toBe(true);
    expect(b.greaterThan(a)).toBe(false);

    expect(a.greaterThanOrEqual(c)).toBe(true);
    expect(a.greaterThanOrEqual(b)).toBe(true);

    expect(b.lessThan(a)).toBe(true);
    expect(a.lessThan(b)).toBe(false);

    expect(a.lessThanOrEqual(c)).toBe(true);
    expect(b.lessThanOrEqual(a)).toBe(true);

    expect(Object.isFrozen(a)).toBe(true);
  });
});
