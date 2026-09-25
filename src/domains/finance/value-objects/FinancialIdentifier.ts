import {
  MAX_JS_SAFE_INTEGER_DECIMAL_DIGITS,
} from '../constants/FinancialLimits';
import {
  InvalidIdentifierError,
} from '../errors/FinancialError';

/**
 * Valida e normaliza um identificador inteiro positivo representável
 * com segurança pela semântica numérica do JavaScript.
 *
 * O identificador não é um montante monetário e, portanto, sua
 * representação física pode utilizar number após a validação de
 * Number.isSafeInteger().
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
      !/^[1-9]\d*$/.test(id)
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
 * Value Object para um identificador financeiro físico inteiro positivo.
 *
 * A identidade é normalizada para um inteiro seguro do JavaScript.
 * O objeto é imutável em TypeScript e em runtime.
 */
export class FinancialIdentifier {
  public readonly value: number;

  private constructor(value: number) {
    this.value = value;
    Object.freeze(this);
  }

  /**
   * Cria um identificador a partir de sua representação aceita.
   */
  public static from(
    id: number | string
  ): FinancialIdentifier {
    return new FinancialIdentifier(
      parsePositiveSafeIntegerId(id, 'id')
    );
  }

  /**
   * Cria um identificador a partir de number validado.
   */
  public static fromNumber(
    id: number
  ): FinancialIdentifier {
    return new FinancialIdentifier(
      parsePositiveSafeIntegerId(id, 'id')
    );
  }

  /**
   * Cria um identificador a partir de string decimal canônica.
   */
  public static fromString(
    id: string
  ): FinancialIdentifier {
    return new FinancialIdentifier(
      parsePositiveSafeIntegerId(id, 'id')
    );
  }

  /**
   * Compara dois identificadores por valor.
   */
  public equals(
    other: unknown
  ): boolean {
    if (!(other instanceof FinancialIdentifier)) {
      return false;
    }

    return this.value === other.value;
  }

  /**
   * Retorna o identificador como number seguro.
   */
  public toNumber(): number {
    return this.value;
  }

  /**
   * Retorna a representação decimal canônica.
   */
  public toString(): string {
    return this.value.toString(10);
  }
}
