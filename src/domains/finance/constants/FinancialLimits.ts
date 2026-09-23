/**
 * Constantes e limites numéricos fundamentais do domínio financeiro.
 * Centralizado para evitar acoplamento ou dependências circulares entre
 * Value Objects, Policies e Entidades contábeis.
 */

/**
 * Teto máximo absoluto de inteiros sem sinal de 256 bits (EVM uint256).
 * 2^256 - 1 = 115792089237316195423570985008687907853269984665640564039457584007913129639935n
 */
export const MAX_UINT256: bigint = (1n << 256n) - 1n;

/**
 * Quantidade máxima permitida de lançamentos (debits/credits) em uma única transação contábil.
 */
export const MAX_LEDGER_ENTRIES = 100;

/**
 * Limite de caracteres para descrição de lançamentos no ledger contábil.
 */
export const MAX_LEDGER_DESCRIPTION_LENGTH = 255;

/**
 * Limite de caracteres para chaves de idempotência financeiras.
 */
export const MAX_IDEMPOTENCY_KEY_LENGTH = 255;

/**
 * Limite máximo de dígitos decimais para representação de uint256 (2^256 - 1 possui 78 dígitos).
 * Strings com mais de 78 dígitos decimais excedem matematicamente a capacidade de 256 bits.
 */
export const MAX_UINT256_DECIMAL_DIGITS = 78;

/**
 * Limite máximo de dígitos para inteiros seguros no JavaScript (Number.MAX_SAFE_INTEGER = 9007199254740991, 16 dígitos).
 */
export const MAX_SAFE_INTEGER_DIGITS = 16;

/**
 * Teto de caracteres brutos antes de qualquer processamento ou normalização Unicode.
 * Protege parsers textuais e matemáticos contra ataques de negação de serviço (DoS) por memória/CPU.
 */
export const MAX_RAW_TEXT_CEILING = 1000;

/**
 * Teto de caracteres brutos para qualquer parser numérico (human amounts, base units, IDs).
 * Protege contra payloads abusivos de números gigantescos antes de qualquer regex ou parsing.
 */
export const MAX_NUMERIC_RAW_TEXT_CEILING = 256;
