/**
 * Catálogo canônico da natureza contábil de movimentação de uma perna
 * de escrituração no livro-razão (partidas dobradas).
 *
 * Representa estritamente a semântica de 'debit' e 'credit', sem vincular
 * sinais matemáticos (+ ou -), cuja interpretação depende exclusivamente da
 * natureza contábil da conta (Ativo, Passivo, PL, etc.).
 */
export const LedgerEntryDirectionConstant = Object.freeze({
  DEBIT: 'debit',
  CREDIT: 'credit',
} as const);

export type LedgerEntryDirection =
  (typeof LedgerEntryDirectionConstant)[keyof typeof LedgerEntryDirectionConstant];

/**
 * Coleção runtime imutável das direções permitidas, derivada da fonte única semântica.
 */
export const LEDGER_ENTRY_DIRECTIONS = Object.freeze([
  LedgerEntryDirectionConstant.DEBIT,
  LedgerEntryDirectionConstant.CREDIT,
] as const);

/**
 * Type guard de runtime para direção contábil.
 */
export function isLedgerEntryDirection(
  value: unknown
): value is LedgerEntryDirection {
  return (
    typeof value === 'string' &&
    LEDGER_ENTRY_DIRECTIONS.includes(value as LedgerEntryDirection)
  );
}
