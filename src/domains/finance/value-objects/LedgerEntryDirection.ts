/**
 * Catálogo canônico da natureza contábil de movimentação de uma perna
 * de escrituração no livro-razão (partidas dobradas).
 */
export const LEDGER_ENTRY_DIRECTIONS = Object.freeze([
  'debit',
  'credit',
] as const);

export type LedgerEntryDirection = (typeof LEDGER_ENTRY_DIRECTIONS)[number];

export function isLedgerEntryDirection(
  value: unknown
): value is LedgerEntryDirection {
  return (
    typeof value === 'string' &&
    LEDGER_ENTRY_DIRECTIONS.includes(value as LedgerEntryDirection)
  );
}

export const LedgerEntryDirectionConstant = Object.freeze({
  DEBIT: 'debit',
  CREDIT: 'credit',
} as const);
