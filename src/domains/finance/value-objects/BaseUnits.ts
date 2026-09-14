import {
  InvalidMoneyFormatError,
  Money256OverflowError,
} from '../errors/FinancialError';

export const MAX_UINT256 = (1n << 256n) - 1n; // 2^256 - 1

export const LEDGER_ENTRY_DIRECTIONS = ['debit', 'credit'] as const;
export type LedgerEntryDirection = typeof LEDGER_ENTRY_DIRECTIONS[number];

export function isLedgerEntryDirection(value: unknown): value is LedgerEntryDirection {
  return typeof value === 'string' && (value === 'debit' || value === 'credit');
}

/**
 * FIN-AMT-001: Canonical Base Unit Range
 * Valida se um valor de base units é uma string decimal canônica e respeita o teto de 256 bits.
 * Permite zero ("0") para saldos, limites e projeções.
 */
export function parseCanonicalBaseUnits(value: unknown): string {
  if (typeof value !== 'string') {
    throw new InvalidMoneyFormatError('O valor de unidades base deve ser fornecido como string decimal canônica.');
  }

  if (!/^(0|[1-9]\d*)$/.test(value)) {
    throw new InvalidMoneyFormatError(
      `Formato de unidades base inválido: "${value}". Deve ser uma string de inteiros sem sinal, sem decimais, sem espaços e sem zeros à esquerda.`
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
