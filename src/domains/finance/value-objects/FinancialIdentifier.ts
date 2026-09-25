import {
  MAX_JS_SAFE_INTEGER_DECIMAL_DIGITS,
} from '../constants/FinancialLimits';
import {
  InvalidIdentifierError,
} from '../errors/FinancialError';

/**
 * Padrão estrito para inteiros decimais positivos sem zeros à esquerda ou caracteres de sinal.
 * Pré-compilado em escopo de módulo para eliminar alocações recorrentes em V8.
 */
const POSITIVE_DECIMAL_INTEGER_PATTERN = /^[1-9]\d*$/;

/**
 * Valida e normaliza um identificador inteiro positivo representável
 * com segurança pela semântica numérica do JavaScript (IEEE-754 53-bit safe integer).
 *
 * Invariantes:
 * - Aceita number seguro estritamente positivo (> 0).
 * - Aceita string decimal canônica sem espaços, sem sinais e sem zeros à esquerda.
 * - Impõe teto lexical pré-conversão de 16 dígitos decimais.
 * - Rejeita floats, NaN, Infinity, strings vazias e valores >= 2^53.
 */
export function parsePositiveSafeIntegerId(
  id: unknown,
  name = 'id'
): number {
  if (typeof id === 'number') {
    if (!Number.isSafeInteger(id) || id <= 0) {
      throw new InvalidIdentifierError(
        `Invalid physical ${name}.`
      );
    }

    return id;
  }

  if (typeof id === 'string') {
    if (
      id.length === 0 ||
      id.length > MAX_JS_SAFE_INTEGER_DECIMAL_DIGITS ||
      !POSITIVE_DECIMAL_INTEGER_PATTERN.test(id)
    ) {
      throw new InvalidIdentifierError(
        `Invalid physical ${name}.`
      );
    }

    const numericId = Number(id);

    if (
      !Number.isSafeInteger(numericId) ||
      numericId <= 0
    ) {
      throw new InvalidIdentifierError(
        `Invalid physical ${name}.`
      );
    }

    return numericId;
  }

  throw new InvalidIdentifierError(
    `Invalid physical ${name}.`
  );
}

/**
 * Value Object para identificador físico inteiro positivo de 53 bits.
 *
 * Encapsula identificadores de entidades financeiras (como assetId, accountId),
 * garantindo imutabilidade profunda e integridade de serialização.
 */
export class FinancialIdentifier {
  public readonly value: number;

  private constructor(value: number) {
    this.value = value;
    Object.freeze(this);
  }

  public static from(
    id: number | string
  ): FinancialIdentifier {
    return new FinancialIdentifier(
      parsePositiveSafeIntegerId(id, 'id')
    );
  }

  public static fromNumber(
    id: number
  ): FinancialIdentifier {
    return new FinancialIdentifier(
      parsePositiveSafeIntegerId(id, 'id')
    );
  }

  public static fromString(
    id: string
  ): FinancialIdentifier {
    return new FinancialIdentifier(
      parsePositiveSafeIntegerId(id, 'id')
    );
  }

  public equals(
    other: unknown
  ): boolean {
    if (!(other instanceof FinancialIdentifier)) {
      return false;
    }

    return this.value === other.value;
  }

  public toNumber(): number {
    return this.value;
  }

  public toString(): string {
    return this.value.toString(10);
  }

  public toJSON(): number {
    return this.value;
  }

  public valueOf(): number {
    return this.value;
  }
}
