import {
  MAX_UINT256,
  MAX_UINT256_DECIMAL_DIGITS,
  MAX_JS_SAFE_INTEGER_DECIMAL_DIGITS,
  MAX_NUMERIC_RAW_TEXT_CEILING,
} from '../constants/FinancialLimits';
import {
  InvalidMoneyFormatError,
  Money256OverflowError,
  CurrencyMismatchError,
  MoneyUnderflowError,
  InvalidIdentifierError,
} from '../errors/FinancialError';

/**
 * @deprecated Importe diretamente de '../constants/FinancialLimits'.
 * Re-exportação preservada exclusivamente para compatibilidade retroativa com suítes de testes e consumidores existentes.
 */
export {
  MAX_UINT256,
  MAX_UINT256_DECIMAL_DIGITS,
  MAX_JS_SAFE_INTEGER_DECIMAL_DIGITS,
  MAX_NUMERIC_RAW_TEXT_CEILING,
};

/** @deprecated Use MAX_JS_SAFE_INTEGER_DECIMAL_DIGITS diretamente de '../constants/FinancialLimits'. */
export const MAX_SAFE_INTEGER_DIGITS = MAX_JS_SAFE_INTEGER_DECIMAL_DIGITS;

/**
 * Validador canônico estrito para IDs físicos inteiros positivos.
 * Rejeita representações com sinais, decimais, espaços, notação exponencial ou hexadecimal.
 * Impõe teto lexical de 16 dígitos decimais antes de qualquer conversão numérica.
 */
export function parsePositiveSafeIntegerId(id: unknown, name = 'id'): number {
  if (typeof id === 'number') {
    if (!Number.isSafeInteger(id) || id <= 0) {
      throw new InvalidIdentifierError(`Invalid physical ${name}.`);
    }
    return id;
  }

  if (typeof id === 'string') {
    if (
      id.length === 0 ||
      id.length > MAX_JS_SAFE_INTEGER_DECIMAL_DIGITS ||
      !/^[1-9]\d*$/.test(id)
    ) {
      throw new InvalidIdentifierError(`Invalid physical ${name}.`);
    }
    const numericId = Number(id);
    if (!Number.isSafeInteger(numericId) || numericId <= 0) {
      throw new InvalidIdentifierError(`Invalid physical ${name}.`);
    }
    return numericId;
  }

  throw new InvalidIdentifierError(`Invalid physical ${name}.`);
}

/**
 * Value Object de alta precisão monetária (256-bit unsigned integer).
 *
 * INVARIANTES FUNDAMENTAIS:
 * 1. Identidade econômica indissociável: Money256 = quantia (amount) + ativo (assetId).
 * 2. Imutabilidade absoluta via Object.freeze.
 * 3. Aritmética puramente inteira com BigInt (sem float / number / Math.floor).
 * 4. Blindagem em tempo de execução contra Duck-Typing / objetos forjados.
 * 5. Prevenção rigorosa de overflow (MAX_UINT256) e underflow (< 0).
 */
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

    Object.freeze(this);
  }

  public static zero(assetId: number | string): Money256 {
    return new Money256(0n, assetId);
  }

  public static max(assetId: number | string): Money256 {
    return new Money256(MAX_UINT256, assetId);
  }

  public static fromString(amountStr: string, assetId: number | string): Money256 {
    return new Money256(amountStr, assetId);
  }

  public static fromBigInt(amount: bigint, assetId: number | string): Money256 {
    return new Money256(amount, assetId);
  }

  public static from(amount: bigint | string | Money256, assetId?: number | string): Money256 {
    if (amount instanceof Money256) {
      if (assetId !== undefined) {
        const expectedAssetId = parsePositiveSafeIntegerId(assetId, 'assetId');
        if (amount.assetId !== expectedAssetId) {
          throw new CurrencyMismatchError(
            `AssetId mismatch: expected ${expectedAssetId}, received ${amount.assetId}`
          );
        }
      }
      return amount;
    }

    if (assetId === undefined) {
      throw new InvalidMoneyFormatError('assetId is required to construct a Money256 instance.');
    }

    if (typeof amount === 'string') {
      return Money256.fromString(amount, assetId);
    }

    if (typeof amount === 'bigint') {
      return Money256.fromBigInt(amount, assetId);
    }

    throw new InvalidMoneyFormatError('Unsupported type for Money256 conversion.');
  }

  /**
   * Parser canônico estrito para strings decimais monetárias.
   * Não aceita espaços em branco, zeros à esquerda ou caracteres de sinal.
   * Impõe teto lexical pré-parser de 78 dígitos (teto do uint256).
   */
  public static parseCanonicalString(str: string): bigint {
    if (typeof str !== 'string') {
      throw new InvalidMoneyFormatError('Monetary amount must be a canonical string.');
    }
    if (str.length === 0) {
      throw new InvalidMoneyFormatError('Monetary string cannot be empty.');
    }
    if (str.length > MAX_NUMERIC_RAW_TEXT_CEILING) {
      throw new InvalidMoneyFormatError(
        `Monetary string exceeds maximum raw text ceiling of ${MAX_NUMERIC_RAW_TEXT_CEILING}.`
      );
    }
    if (str.length > MAX_UINT256_DECIMAL_DIGITS) {
      throw new Money256OverflowError('Canonical monetary string exceeds uint256 limit.');
    }
    if (!/^(0|[1-9]\d*)$/.test(str)) {
      throw new InvalidMoneyFormatError(
        'Invalid canonical decimal string format: must be non-negative integer string without leading zeros, exponent, or signs.'
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

  private static assertMoney256(other: unknown, operationName: string): asserts other is Money256 {
    if (!(other instanceof Money256)) {
      throw new InvalidMoneyFormatError(
        `Invalid argument for Money256.${operationName}: expected Money256 instance.`
      );
    }
  }

  private assertSameAsset(other: Money256): void {
    if (this.assetId !== other.assetId) {
      throw new CurrencyMismatchError(
        `Cannot perform arithmetic on different assets: ${this.assetId} and ${other.assetId}`
      );
    }
  }

  public add(other: Money256): Money256 {
    Money256.assertMoney256(other, 'add');
    this.assertSameAsset(other);
    const sum = this.amount + other.amount;
    if (sum > MAX_UINT256) {
      throw new Money256OverflowError('Overflow: Addition exceeds uint256 limit.');
    }
    return new Money256(sum, this.assetId);
  }

  public subtract(other: Money256): Money256 {
    Money256.assertMoney256(other, 'subtract');
    this.assertSameAsset(other);
    if (this.amount < other.amount) {
      throw new MoneyUnderflowError('Subtraction resulting in negative balance is prohibited.');
    }
    return new Money256(this.amount - other.amount, this.assetId);
  }

  /**
   * Multiplicação monetária por escalar inteiro estrito (bigint).
   * Números de ponto flutuante (number) são proibidos para evitar erros de precisão IEEE 754.
   */
  public multiply(scalar: bigint): Money256 {
    if (typeof scalar !== 'bigint') {
      throw new InvalidMoneyFormatError('Scalar for Money256.multiply must be a bigint primitive.');
    }
    if (scalar < 0n) {
      throw new InvalidMoneyFormatError('Multiplication by negative scalar is not allowed.');
    }
    const result = this.amount * scalar;
    if (result > MAX_UINT256) {
      throw new Money256OverflowError('Overflow: Multiplication exceeds uint256 limit.');
    }
    return new Money256(result, this.assetId);
  }

  public equals(other: unknown): boolean {
    if (!(other instanceof Money256)) {
      return false;
    }
    return this.assetId === other.assetId && this.amount === other.amount;
  }

  public greaterThan(other: Money256): boolean {
    Money256.assertMoney256(other, 'greaterThan');
    this.assertSameAsset(other);
    return this.amount > other.amount;
  }

  public greaterThanOrEqual(other: Money256): boolean {
    Money256.assertMoney256(other, 'greaterThanOrEqual');
    this.assertSameAsset(other);
    return this.amount >= other.amount;
  }

  public lessThan(other: Money256): boolean {
    Money256.assertMoney256(other, 'lessThan');
    this.assertSameAsset(other);
    return this.amount < other.amount;
  }

  public lessThanOrEqual(other: Money256): boolean {
    Money256.assertMoney256(other, 'lessThanOrEqual');
    this.assertSameAsset(other);
    return this.amount <= other.amount;
  }

  public isZero(): boolean {
    return this.amount === 0n;
  }

  public isPositive(): boolean {
    return this.amount > 0n;
  }

  public toCanonicalString(): string {
    return this.amount.toString(10);
  }

  public toString(): string {
    return this.amount.toString(10);
  }

  public toBigInt(): bigint {
    return this.amount;
  }
}
