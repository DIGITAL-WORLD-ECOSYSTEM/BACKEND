import {
  MAX_UINT256,
  MAX_UINT256_DECIMAL_DIGITS,
  MAX_NUMERIC_RAW_TEXT_CEILING,
} from '../constants/FinancialLimits';
import {
  InvalidMoneyFormatError,
  Money256OverflowError,
  CurrencyMismatchError,
  FinancialValidationError,
} from '../errors/FinancialError';
import { Money256 } from './Money256';
import {
  LEDGER_ENTRY_DIRECTIONS,
  type LedgerEntryDirection,
  isLedgerEntryDirection,
} from './LedgerEntryDirection';

/**
 * @deprecated Importe diretamente de './LedgerEntryDirection'.
 * Re-exportação mantida exclusivamente para compatibilidade retroativa com o razão contábil.
 */
export {
  LEDGER_ENTRY_DIRECTIONS,
  type LedgerEntryDirection,
  isLedgerEntryDirection,
};

/**
 * Padrões de expressões regulares pré-compiladas no escopo do módulo.
 */
const CANONICAL_BASE_UNITS_PATTERN = /^(0|[1-9]\d*)$/;
const CANONICAL_HUMAN_DECIMAL_PATTERN = /^\d+(?:\.\d+)?$/;

/**
 * Contexto imutável de precisão de um ativo utilizado exclusivamente
 * nas conversões entre unidades base e representação decimal humana.
 */
export interface AssetPrecisionContext {
  readonly id: number;
  readonly decimals: number;
}

/**
 * Type guard de runtime para AssetPrecisionContext com proteção contra duck-typing.
 */
export function isAssetPrecisionContext(
  value: unknown
): value is AssetPrecisionContext {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  if (
    !Object.prototype.hasOwnProperty.call(candidate, 'id') ||
    !Object.prototype.hasOwnProperty.call(candidate, 'decimals')
  ) {
    return false;
  }

  const id = candidate.id;
  const decimals = candidate.decimals;

  return (
    typeof id === 'number' &&
    Number.isSafeInteger(id) &&
    id > 0 &&
    typeof decimals === 'number' &&
    Number.isInteger(decimals) &&
    decimals >= 0 &&
    decimals <= 18
  );
}

/**
 * Valida a precisão decimal suportada pelo domínio financeiro (0 a 18 casas).
 */
function assertValidDecimals(decimals: unknown): asserts decimals is number {
  if (
    typeof decimals !== 'number' ||
    !Number.isInteger(decimals) ||
    decimals < 0 ||
    decimals > 18
  ) {
    throw new InvalidMoneyFormatError(
      `Invalid decimals precision: ${String(decimals)}. Must be integer between 0 and 18.`
    );
  }
}

/**
 * FIN-AMT-001: Canonical Base Unit Range
 * Valida se um valor de base units é uma string decimal canônica e respeita o teto de 256 bits.
 * Permite zero ("0") para saldos, limites e projeções.
 *
 * Ordem estrita de validação defensiva:
 * 1º Tipo primitivo string
 * 2º Verificação de string não-vazia
 * 3º Teto de tamanho textual bruto (MAX_NUMERIC_RAW_TEXT_CEILING = 256)
 * 4º Teto lexical de capacidade uint256 (MAX_UINT256_DECIMAL_DIGITS = 78)
 * 5º Validação por regex ancorada (^ e $)
 * 6º Conversão para BigInt e validação de intervalo (0n a MAX_UINT256).
 */
export function parseCanonicalBaseUnits(value: unknown): string {
  if (typeof value !== 'string') {
    throw new InvalidMoneyFormatError(
      'O valor de unidades base deve ser fornecido como string decimal canônica.'
    );
  }

  if (value.length === 0) {
    throw new InvalidMoneyFormatError(
      'O valor de unidades base não pode ser vazio.'
    );
  }

  if (value.length > MAX_NUMERIC_RAW_TEXT_CEILING) {
    throw new InvalidMoneyFormatError(
      `O valor de unidades base excede o teto textual de ${MAX_NUMERIC_RAW_TEXT_CEILING}.`
    );
  }

  if (value.length > MAX_UINT256_DECIMAL_DIGITS) {
    throw new Money256OverflowError(
      'O valor de unidades base excede o limite máximo de 78 dígitos decimais (uint256).'
    );
  }

  if (!CANONICAL_BASE_UNITS_PATTERN.test(value)) {
    throw new InvalidMoneyFormatError(
      'Formato de unidades base inválido. Deve ser uma string de inteiros sem sinal, sem decimais, sem espaços e sem zeros à esquerda.'
    );
  }

  const numericBigInt = BigInt(value);
  if (numericBigInt > MAX_UINT256) {
    throw new Money256OverflowError();
  }

  return value;
}

/**
 * Valida montante estritamente positivo para lançamentos do ledger contábil (> 0).
 */
export function parsePositiveCanonicalBaseUnits(value: unknown): string {
  const canonical = parseCanonicalBaseUnits(value);
  if (canonical === '0') {
    throw new InvalidMoneyFormatError(
      'Lançamentos no ledger contábil exigem montante estritamente positivo (> 0).'
    );
  }
  return canonical;
}

/**
 * Conversor estático puro de escala entre representação decimal humana e unidades atômicas inteiras (Money256).
 */
export class BaseUnits {
  private constructor() {}

  /**
   * Converte uma quantia decimal humana em unidades base (Money256).
   *
   * Ordem estrita de sanitização e validação defensiva:
   * 1º Tipo primitivo string
   * 2º Sanitização com .trim()
   * 3º Verificação de string não-vazia
   * 4º Checagem de teto de tamanho bruto (MAX_NUMERIC_RAW_TEXT_CEILING)
   * 5º Validação de precisão de casas decimais do ativo
   * 6º Validação por regex ancorada (^ e $)
   * 7º Composição e escalonamento puramente textual (sem float IEEE-754)
   * 8º Barreira de dígitos uint256 e conversão segura para BigInt.
   */
  public static toBaseUnits(
    humanAmount: string,
    assetId: number | string,
    decimals: number
  ): Money256 {
    if (typeof humanAmount !== 'string') {
      throw new InvalidMoneyFormatError(
        'humanAmount must be provided as a string to preserve decimal precision.'
      );
    }

    const trimmed = humanAmount.trim();

    if (trimmed.length === 0) {
      throw new InvalidMoneyFormatError(
        'humanAmount cannot be empty or contain only whitespace.'
      );
    }

    if (trimmed.length > MAX_NUMERIC_RAW_TEXT_CEILING) {
      throw new InvalidMoneyFormatError(
        `humanAmount exceeds maximum raw length ceiling of ${MAX_NUMERIC_RAW_TEXT_CEILING}.`
      );
    }

    assertValidDecimals(decimals);

    if (!CANONICAL_HUMAN_DECIMAL_PATTERN.test(trimmed)) {
      throw new InvalidMoneyFormatError(
        'Invalid amount format. Use a non-negative decimal string without signs or exponent notation.'
      );
    }

    const separatorIndex = trimmed.indexOf('.');

    const integerPart =
      separatorIndex === -1
        ? trimmed
        : trimmed.slice(0, separatorIndex);

    const fractionalPart =
      separatorIndex === -1
        ? ''
        : trimmed.slice(separatorIndex + 1);

    if (fractionalPart.length > decimals) {
      throw new InvalidMoneyFormatError(
        `Precision overflow: fractional part (${fractionalPart.length}) exceeds asset decimals (${decimals})`
      );
    }

    const paddedFraction = fractionalPart.padEnd(decimals, '0');
    const normalizedInteger = integerPart.replace(/^0+(?=\d)/, '');
    const scaled =
      normalizedInteger === '0'
        ? paddedFraction
        : `${normalizedInteger}${paddedFraction}`;
    const canonicalScaled = scaled.replace(/^0+(?=\d)/, '') || '0';

    if (canonicalScaled.length > MAX_UINT256_DECIMAL_DIGITS) {
      throw new Money256OverflowError(
        'Scaled base units amount exceeds uint256 maximum capacity.'
      );
    }

    const combinedBigInt = BigInt(canonicalScaled);

    if (combinedBigInt > MAX_UINT256) {
      throw new Money256OverflowError(
        'Scaled base units amount exceeds uint256 maximum capacity.'
      );
    }

    return new Money256(combinedBigInt, assetId);
  }

  /**
   * Converte unidades base em representação decimal humana legível.
   * Suporta validação contextual de ativo para prevenir divergência de escala econômica.
   * Blindado com runtime guard contra duck-typing.
   */
  public static toHumanAmount(
    baseUnits: Money256,
    decimalsOrAsset: number | AssetPrecisionContext,
    explicitDecimals?: number
  ): string {
    if (!(baseUnits instanceof Money256)) {
      throw new InvalidMoneyFormatError(
        'Expected baseUnits to be an instance of Money256.'
      );
    }

    let decimals: number;

    if (typeof decimalsOrAsset === 'object' && decimalsOrAsset !== null) {
      if (!isAssetPrecisionContext(decimalsOrAsset)) {
        throw new FinancialValidationError(
          'Invalid asset precision context.'
        );
      }
      if (baseUnits.assetId !== decimalsOrAsset.id) {
        throw new CurrencyMismatchError(
          `Asset mismatch during toHumanAmount: expected asset ${decimalsOrAsset.id}, got ${baseUnits.assetId}`
        );
      }
      if (
        explicitDecimals !== undefined &&
        explicitDecimals !== decimalsOrAsset.decimals
      ) {
        throw new FinancialValidationError(
          `Supplied decimals (${explicitDecimals}) does not match asset decimals (${decimalsOrAsset.decimals}).`
        );
      }
      decimals = decimalsOrAsset.decimals;
    } else {
      decimals = decimalsOrAsset;

      assertValidDecimals(decimals);

      if (
        explicitDecimals !== undefined &&
        explicitDecimals !== decimals
      ) {
        throw new FinancialValidationError(
          `Supplied decimals (${explicitDecimals}) does not match conversion decimals (${decimals}).`
        );
      }
    }

    assertValidDecimals(decimals);

    const str = baseUnits.toBigInt().toString(10);
    if (decimals === 0) return str;

    const normalized = str.padStart(decimals + 1, '0');
    const integerPart = normalized.slice(0, -decimals);
    const fractionalPart = normalized.slice(-decimals).replace(/0+$/, '');

    return fractionalPart ? `${integerPart}.${fractionalPart}` : integerPart;
  }
}
