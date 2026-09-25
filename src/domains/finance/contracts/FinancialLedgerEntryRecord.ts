import {
  LedgerEntryDirection,
  isLedgerEntryDirection,
} from '../value-objects/LedgerEntryDirection';
import { parsePositiveSafeIntegerId } from '../value-objects/FinancialIdentifier';
import {
  MAX_NUMERIC_RAW_TEXT_CEILING,
  MAX_UINT256_DECIMAL_DIGITS,
  MAX_UINT256,
} from '../constants/FinancialLimits';

/**
 * Padrão canônico decimal estrito para montantes de base units em formato string.
 */
const CANONICAL_BASE_UNITS_PATTERN = /^(0|[1-9]\d*)$/;

/**
 * Raw persistence record de infraestrutura/transporte serializado para o livro-razão.
 *
 * ATENÇÃO ARQUITETURAL:
 * Este contrato reflete o transporte serializado da camada de persistência.
 * Todo dado contábil transportado por este record DEVE ser validado através
 * dos Value Objects (BaseUnits, Money256) e Aggregate (LedgerTransaction)
 * antes de qualquer operação financeira de negócio.
 */
export interface FinancialLedgerEntryRecord {
  readonly accountId: number;
  readonly assetId: number;
  readonly direction: LedgerEntryDirection;
  readonly amountBaseUnits: string;
}

/**
 * Validador e normalizador canônico de FinancialLedgerEntryRecord para consumo pelo domínio.
 *
 * Invariantes P0 Hardened:
 * 1. accountId e assetId: inteiros positivos de 53 bits seguros em JS (parsePositiveSafeIntegerId).
 * 2. direction: validação estrita via type guard isLedgerEntryDirection ('debit' | 'credit').
 * 3. amountBaseUnits: string não-vazia, teto bruto anti-DoS, teto de 78 dígitos decimais e limite uint256.
 * 4. Imutabilidade: congelamento profundo via Object.freeze.
 */
export function validateCanonicalLedgerEntryRecord(record: FinancialLedgerEntryRecord): {
  readonly accountId: number;
  readonly assetId: number;
  readonly direction: LedgerEntryDirection;
  readonly amountBaseUnits: string;
} {
  if (!record || typeof record !== 'object') {
    throw new Error('FinancialLedgerEntryRecord deve ser um objeto válido.');
  }

  // 1. Identificadores de 53 bits seguros
  const accountId = parsePositiveSafeIntegerId(record.accountId, 'record.accountId');
  const assetId = parsePositiveSafeIntegerId(record.assetId, 'record.assetId');

  // 2. Validação da direção contábil ('debit' | 'credit')
  if (!isLedgerEntryDirection(record.direction)) {
    throw new Error(
      `Direção contábil inválida em FinancialLedgerEntryRecord: '${String(record.direction)}'. Esperado 'debit' ou 'credit'.`
    );
  }

  // 3. Validação do montante serializado em base units
  if (typeof record.amountBaseUnits !== 'string') {
    throw new Error(
      `amountBaseUnits em FinancialLedgerEntryRecord deve ser string. Recebido: ${typeof record.amountBaseUnits}`
    );
  }

  const trimmedAmount = record.amountBaseUnits.trim();

  if (trimmedAmount.length === 0) {
    throw new Error('amountBaseUnits em FinancialLedgerEntryRecord não pode ser string vazia.');
  }

  if (trimmedAmount.length > MAX_NUMERIC_RAW_TEXT_CEILING) {
    throw new Error(
      `amountBaseUnits excede o teto anti-DoS de ${MAX_NUMERIC_RAW_TEXT_CEILING} caracteres: tamanho ${trimmedAmount.length}`
    );
  }

  if (!CANONICAL_BASE_UNITS_PATTERN.test(trimmedAmount)) {
    throw new Error(
      `amountBaseUnits contém formato não-canônico: '${trimmedAmount}'. Permitido apenas inteiros sem sinal e sem zeros à esquerda.`
    );
  }

  if (trimmedAmount.length > MAX_UINT256_DECIMAL_DIGITS) {
    throw new Error(
      `amountBaseUnits excede o teto decimal de 256 bits (${MAX_UINT256_DECIMAL_DIGITS} dígitos).`
    );
  }

  const bigintValue = BigInt(trimmedAmount);
  if (bigintValue > MAX_UINT256) {
    throw new Error('amountBaseUnits excede o limite máximo unsigned de 256 bits (MAX_UINT256).');
  }

  return Object.freeze({
    accountId,
    assetId,
    direction: record.direction,
    amountBaseUnits: trimmedAmount,
  });
}
