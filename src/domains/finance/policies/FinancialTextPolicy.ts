import {
  MAX_LEDGER_DESCRIPTION_LENGTH,
  MAX_IDEMPOTENCY_KEY_LENGTH,
  MAX_RAW_TEXT_CEILING,
} from '../constants/FinancialLimits';
import {
  InvalidIdentifierError,
  InvalidLedgerTransactionError,
  FinancialValidationError,
} from '../errors/FinancialError';

export {
  MAX_LEDGER_DESCRIPTION_LENGTH,
  MAX_IDEMPOTENCY_KEY_LENGTH,
  MAX_RAW_TEXT_CEILING,
};

/**
 * Regex explícita de caracteres proibidos em textos financeiros:
 * - C0 control characters (\u0000-\u001F)
 * - DEL (\u007F)
 * - C1 control characters (\u0080-\u009F)
 * - Zero-width spaces & joiners (\u200B-\u200D)
 * - Bidi override & directional controls (\u202A-\u202E, \u2066-\u2069)
 * - Byte Order Mark BOM (\uFEFF)
 */
export const DANGEROUS_TEXT_CHARACTERS_REGEX =
  /[\u0000-\u001F\u007F\u0080-\u009F\u200B-\u200D\u202A-\u202E\u2066-\u2069\uFEFF]/u;

/**
 * Regex global para uso EXCLUSIVO em replace() para sanitização de logs e diagnósticos.
 * NUNCA utilizar com .test(), pois expressões com flag /g são stateful em JavaScript.
 */
export const DANGEROUS_TEXT_CHARACTERS_REGEX_GLOBAL =
  /[\u0000-\u001F\u007F\u0080-\u009F\u200B-\u200D\u202A-\u202E\u2066-\u2069\uFEFF]/gu;

export class FinancialTextPolicy {
  public static readonly MAX_LEDGER_DESCRIPTION_LENGTH = MAX_LEDGER_DESCRIPTION_LENGTH;
  public static readonly MAX_IDEMPOTENCY_KEY_LENGTH = MAX_IDEMPOTENCY_KEY_LENGTH;
  public static readonly MAX_RAW_TEXT_CEILING = MAX_RAW_TEXT_CEILING;

  /**
   * Remove globalmente caracteres perigosos EXCLUSIVAMENTE para sanitização
   * de diagnósticos e logs. Nunca deve ser usado para mascarar dados financeiros de negócio.
   */
  public static stripDangerousCharacters(value: unknown): string {
    let str: string;
    if (typeof value === 'string') {
      str = value;
    } else if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
      str = value.toString();
    } else {
      str = '';
    }
    const capped = str.length > MAX_RAW_TEXT_CEILING ? str.slice(0, MAX_RAW_TEXT_CEILING) : str;
    DANGEROUS_TEXT_CHARACTERS_REGEX_GLOBAL.lastIndex = 0;
    return capped.replace(DANGEROUS_TEXT_CHARACTERS_REGEX_GLOBAL, '');
  }

  /**
   * Sanitiza e valida descrições e motivos financeiros de linha única:
   * 1. Verifica tipo string
   * 2. Aplica teto de tamanho bruto (pré-NFC para proteção DoS)
   * 3. Aplica normalização canônica Unicode NFC
   * 4. Rejeita caracteres de controle e invisíveis
   * 5. Garante limite semântico de code points sem quebras de linha
   */
  public static sanitizeSingleLine(raw: unknown, maxLength: number, fieldName: string): string {
    if (typeof raw !== 'string') {
      throw new InvalidLedgerTransactionError(`${fieldName} must be a string.`);
    }

    if (raw.length > MAX_RAW_TEXT_CEILING) {
      throw new InvalidLedgerTransactionError(
        `${fieldName} length exceeds maximum raw limit of ${MAX_RAW_TEXT_CEILING}.`
      );
    }

    const normalized = raw.normalize('NFC').trim();
    if (!normalized) {
      throw new InvalidLedgerTransactionError(`${fieldName} cannot be empty.`);
    }

    if (DANGEROUS_TEXT_CHARACTERS_REGEX.test(normalized)) {
      throw new InvalidLedgerTransactionError(
        `${fieldName} contains forbidden Unicode control, bidi, or invisible characters.`
      );
    }

    const codePointLength = Array.from(normalized).length;
    if (codePointLength > maxLength) {
      throw new InvalidLedgerTransactionError(
        `${fieldName} length (${codePointLength}) exceeds maximum limit (${maxLength}).`
      );
    }

    return normalized;
  }

  /**
   * Normaliza e valida descrições seguras do ledger contábil.
   */
  public static normalizeSafeDescription(
    raw: unknown,
    maxLength: number = MAX_LEDGER_DESCRIPTION_LENGTH,
    fieldName: string = 'description'
  ): string {
    return this.sanitizeSingleLine(raw, maxLength, fieldName);
  }

  /**
   * getCodePointLength: conta code points Unicode via Array.from().
   * NOTA DE PRECISÃO: opera sobre code points Unicode, NÃO garante grapheme-cluster preservation.
   */
  public static getCodePointLength(text: string): number {
    return Array.from(text).length;
  }

  /**
   * truncateCodePoints: trunca texto respeitando code points Unicode (evita quebra de surrogate pairs).
   * NOTA DE PRECISÃO: é code-point safe, mas NÃO garante preservação de grapheme clusters complexos.
   */
  public static truncateCodePoints(text: string, maxCodePoints: number): string {
    const chars = Array.from(text);
    if (chars.length <= maxCodePoints) {
      return text;
    }
    return chars.slice(0, maxCodePoints).join('');
  }

  /**
   * Afirmação canônica para identificadores e chaves de idempotência:
   * - Sem espaços nas extremidades
   * - Sem caracteres de controle ou perigosos
   * - Tamanho entre 1 e 255 caracteres
   */
  public static assertSafeIdentifierText(raw: unknown, fieldName: string = 'id'): string {
    if (typeof raw !== 'string') {
      throw new InvalidIdentifierError(`${fieldName} must be a string.`);
    }

    if (raw.length === 0 || raw.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
      throw new InvalidIdentifierError(
        `${fieldName} length must be between 1 and ${MAX_IDEMPOTENCY_KEY_LENGTH}.`
      );
    }

    if (raw !== raw.trim()) {
      throw new InvalidIdentifierError(`${fieldName} must not contain leading or trailing whitespace.`);
    }

    if (DANGEROUS_TEXT_CHARACTERS_REGEX.test(raw)) {
      throw new InvalidIdentifierError(`${fieldName} contains forbidden characters.`);
    }

    return raw;
  }

  /**
   * Validação canônica estrita para chaves de idempotência.
   */
  public static canonicalizeIdempotencyKey(raw: unknown): string {
    return this.assertSafeIdentifierText(raw, 'idempotencyKey');
  }

  /**
   * Formata a descrição de estorno contábil preservando integralmente o motivo:
   * - O motivo (reason) é preservado integralmente dentro do limite disponível
   * - A descrição original é o elemento sacrificável e sofre truncamento Unicode-safe
   * - O resultado final nunca excede maxLength (255)
   */
  public static formatReversalDescription(
    reason: string,
    originalDescription: string,
    maxLength: number = MAX_LEDGER_DESCRIPTION_LENGTH
  ): string {
    if (typeof reason !== 'string' || reason.length > MAX_RAW_TEXT_CEILING) {
      throw new FinancialValidationError('Reversal reason must be a string within raw size limit.');
    }
    if (
      originalDescription !== undefined &&
      originalDescription !== null &&
      (typeof originalDescription !== 'string' || originalDescription.length > MAX_RAW_TEXT_CEILING)
    ) {
      throw new FinancialValidationError('Original description must be a string within raw size limit.');
    }

    const cleanReason = (reason || '').normalize('NFC').trim();
    const cleanOriginal = (originalDescription || '').normalize('NFC').trim();

    if (DANGEROUS_TEXT_CHARACTERS_REGEX.test(cleanReason)) {
      throw new InvalidLedgerTransactionError('Reversal reason contains forbidden characters.');
    }

    const prefixStart = 'Reversal (';
    const prefixEnd = '): ';
    const maxReasonLen = maxLength - prefixStart.length - prefixEnd.length - 4;

    if (cleanReason.length > maxReasonLen) {
      throw new FinancialValidationError(
        `Reversal reason is too long to fit into maximum description length of ${maxLength}.`
      );
    }

    const prefix = `${prefixStart}${cleanReason}${prefixEnd}`;
    const maxOriginalLen = maxLength - prefix.length;
    const origChars = Array.from(cleanOriginal);

    const finalOriginal =
      origChars.length > maxOriginalLen
        ? `${origChars.slice(0, Math.max(0, maxOriginalLen - 3)).join('')}...`
        : cleanOriginal;

    return `${prefix}${finalOriginal}`;
  }
}
