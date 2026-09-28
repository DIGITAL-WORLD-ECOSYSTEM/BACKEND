/**
 * Centralized currency formatting utility for presentation in the Finance Core.
 * Formats base units (e.g., centavos) as BRL decimal string (R$ X.YY).
 */
export function formatBaseUnitsToBRL(baseUnits: bigint): string {
  const isNeg = baseUnits < 0n;
  const abs = isNeg ? -baseUnits : baseUnits;
  const str = abs.toString().padStart(3, '0');
  const intPart = str.slice(0, -2);
  const decPart = str.slice(-2);
  return `${isNeg ? '-' : ''}${intPart}.${decPart}`;
}
