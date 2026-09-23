import {
  MAX_UINT256,
  MAX_UINT256_DECIMAL_DIGITS,
  MAX_RAW_TEXT_CEILING,
  MAX_NUMERIC_RAW_TEXT_CEILING,
} from '../constants/FinancialLimits';
import {
  InvalidMoneyFormatError,
  Money256OverflowError,
  CurrencyMismatchError,
  FinancialValidationError,
} from '../errors/FinancialError';
import { Money256 } from './Money256';

export {
  MAX_UINT256,
  MAX_UINT256_DECIMAL_DIGITS,
  MAX_RAW_TEXT_CEILING,
  MAX_NUMERIC_RAW_TEXT_CEILING,
};

export const LEDGER_ENTRY_DIRECTIONS = ['debit', 'credit'] as const;
export type LedgerEntryDirection = (typeof LEDGER_ENTRY_DIRECTIONS)[number];

export function isLedgerEntryDirection(value: unknown): value is LedgerEntryDirection {
  return typeof value === 'string' && (value === 'debit' || value === 'credit');
}

/**
 * FIN-AMT-001: Canonical Base Unit Range
 * Valida se um valor de base units é uma string decimal canônica e respeita o teto de 256 bits.
 * Permite zero ("0") para saldos, limites e projeções.
 * Impõe teto lexical pré-parser de 78 dígitos.
 */
export function parseCanonicalBaseUnits(value: unknown): string {
  if (typeof value !== 'string') {
    throw new InvalidMoneyFormatError('O valor de unidades base deve ser fornecido como string decimal canônica.');
  }

  if (value.length === 0) {
    throw new InvalidMoneyFormatError('O valor de unidades base não pode ser vazio.');
  }

  if (value.length > MAX_UINT256_DECIMAL_DIGITS) {
    throw new Money256OverflowError('O valor de unidades base excede o limite máximo de 78 dígitos decimais (uint256).');
  }

  if (!/^(0|[1-9]\d*)$/.test(value)) {
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
    throw new InvalidMoneyFormatError('Lançamentos no ledger contábil exigem montante estritamente positivo (> 0).');
  }
  return canonical;
}

export class BaseUnits {
  /**
   * Converte uma quantia decimal humana em unidades base (Money256).
   * Exige representação em string para evitar imprecisões de ponto flutuante IEEE 754.
   * Aplica teto de dígitos no valor escalado efetivo antes de invocar BigInt().
   */
  public static toBaseUnits(
    humanAmount: string,
    assetId: number | string,
    decimals: number
  ): Money256 {
    if (typeof humanAmount !== 'string') {
      throw new InvalidMoneyFormatError('humanAmount must be provided as a string to preserve decimal precision.');
    }

    if (humanAmount.length > MAX_NUMERIC_RAW_TEXT_CEILING) {
      throw new InvalidMoneyFormatError(
        `humanAmount exceeds maximum raw length ceiling of ${MAX_NUMERIC_RAW_TEXT_CEILING}.`
      );
    }

    if (decimals < 0 || decimals > 18 || !Number.isInteger(decimals)) {
      throw new InvalidMoneyFormatError(
        `Invalid decimals precision: ${decimals}. Must be integer between 0 and 18.`
      );
    }

    const trimmed = humanAmount.trim();
    if (!/^\d+(\.\d+)?$/.test(trimmed)) {
      throw new InvalidMoneyFormatError('Invalid amount format.');
    }

    const [integerPart, fractionalPart = ''] = trimmed.split('.');

    if (fractionalPart.length > decimals) {
      throw new InvalidMoneyFormatError(
        `Precision overflow: fractional part (${fractionalPart.length}) exceeds asset decimals (${decimals})`
      );
    }

    const paddedFraction = fractionalPart.padEnd(decimals, '0');
    const normalizedInteger = integerPart.replace(/^0+(?=\d)/, '');
    const scaled = `${normalizedInteger}${paddedFraction}`;
    const canonicalScaled = scaled.replace(/^0+(?=\d)/, '');

    // Limite lexical sobre o valor escalado efetivo antes de invocar BigInt()
    if (canonicalScaled.length > MAX_UINT256_DECIMAL_DIGITS) {
      throw new Money256OverflowError('Scaled base units amount exceeds uint256 maximum capacity.');
    }

    const combinedBigInt = BigInt(canonicalScaled || '0');

    if (combinedBigInt > MAX_UINT256) {
      throw new Money256OverflowError('Scaled base units amount exceeds uint256 maximum capacity.');
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
    decimalsOrAsset: number | { id: number; decimals: number },
    explicitDecimals?: number
  ): string {
    if (!(baseUnits instanceof Money256)) {
      throw new InvalidMoneyFormatError('Expected baseUnits to be an instance of Money256.');
    }

    let decimals: number;

    if (typeof decimalsOrAsset === 'object' && decimalsOrAsset !== null) {
      if (baseUnits.assetId !== decimalsOrAsset.id) {
        throw new CurrencyMismatchError(
          `Asset mismatch during toHumanAmount: expected asset ${decimalsOrAsset.id}, got ${baseUnits.assetId}`
        );
      }
      if (explicitDecimals !== undefined && explicitDecimals !== decimalsOrAsset.decimals) {
        throw new FinancialValidationError(
          `Supplied decimals (${explicitDecimals}) does not match asset decimals (${decimalsOrAsset.decimals}).`
        );
      }
      decimals = decimalsOrAsset.decimals;
    } else {
      decimals = decimalsOrAsset;
    }

    if (decimals < 0 || decimals > 18 || !Number.isInteger(decimals)) {
      throw new InvalidMoneyFormatError(
        `Invalid decimals precision: ${decimals}. Must be integer between 0 and 18.`
      );
    }

    const str = baseUnits.toBigInt().toString().padStart(decimals + 1, '0');
    if (decimals === 0) return str;

    const integerPart = str.slice(0, -decimals);
    const fractionalPart = str.slice(-decimals).replace(/0+$/, '');

    return fractionalPart ? `${integerPart}.${fractionalPart}` : integerPart;
  }
}
