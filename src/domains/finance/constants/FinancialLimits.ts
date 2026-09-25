/**
 * Constantes e limites fundamentais do domínio financeiro.
 *
 * RESPONSABILIDADE ARQUITETURAL
 * -----------------------------
 * Este módulo centraliza exclusivamente:
 *
 * - bounds matemáticos do domínio financeiro;
 * - cardinalidades estruturais do ledger e PostingPlan;
 * - limites de representação;
 * - limites textuais do domínio;
 * - limites criptográficos de representação;
 * - limites de identificadores e chaves financeiras;
 * - limites estruturais de ativos;
 * - limites matemáticos de deltas contábeis;
 * - metadados executáveis sobre a semântica dos limites;
 * - invariantes estruturais entre os próprios limites.
 *
 * NÃO colocar neste arquivo:
 * - regras contábeis;
 * - autorização/custódia;
 * - regras específicas de uma operação;
 * - timeouts;
 * - retries;
 * - limites HTTP;
 * - configuração de D1/SQLite/Drizzle;
 * - execução de SQL;
 * - validação de requests HTTP.
 *
 * PRINCÍPIO CENTRAL
 * -----------------
 * Cada constante deve representar uma destas categorias:
 *
 * 1. MATHEMATICAL
 *    Propriedade matemática do domínio, independente de produto.
 *
 * 2. REPRESENTATION
 *    Limite relacionado à representação textual, criptográfica ou de
 *    interoperabilidade.
 *
 * 3. DOMAIN_STRUCTURAL_POLICY
 *    Limite estrutural deliberado do Finance Core.
 *
 * A classificação é exposta em `FINANCIAL_LIMIT_CATEGORIES` e deve permanecer
 * sincronizada com `FINANCIAL_LIMITS`.
 *
 * SEMÂNTICA DE TAMANHO TEXTUAL
 * ----------------------------
 * Os limites textuais deste módulo são expressos em UTF-16 code units,
 * alinhados à semântica de `string.length` do JavaScript/TypeScript.
 *
 * IMPORTANTE:
 * ----------------
 * SQLite e JavaScript não devem ser considerados semanticamente equivalentes
 * para contagem textual de Unicode. Portanto:
 *
 * - `FinancialTextPolicy` é a autoridade da validação textual da aplicação;
 * - constraints físicas do banco NÃO devem depender de `length(column)` para
 *   reproduzir exatamente a semântica de `string.length`;
 * - caracteres NUL (`U+0000`) devem ser rejeitados pela política textual
 *   antes da persistência;
 * - a persistência não deve ser utilizada como substituto da validação
 *   canônica realizada no domínio.
 *
 * ARITMÉTICA FINANCEIRA
 * ---------------------
 * Valores financeiros nunca usam `number`.
 *
 * Quantias:
 *
 *   string decimal canônica -> Money256 -> bigint
 *
 * Identificadores pequenos que explicitamente atravessam fronteiras com
 * `number` devem obedecer `Number.isSafeInteger()`.
 *
 * `MAX_JS_SAFE_INTEGER` NÃO é limite monetário.
 *
 * OVERFLOW ACUMULADO
 * ------------------
 * `MAX_SINGLE_LEDGER_ENTRY_AMOUNT` limita o maior delta individual de uma
 * perna de forma que a SOMA DOS DELTAS NOVOS de até `MAX_LEDGER_ENTRIES`
 * pernas não ultrapasse `MAX_UINT256`.
 *
 * ISSO NÃO garante, isoladamente:
 *
 *   existingBalance + delta <= MAX_UINT256
 *
 * A verificação do saldo efetivo deve continuar obrigatoriamente em
 * `Money256` durante a aplicação do delta sobre o saldo atual.
 *
 * Portanto:
 *
 *   per-entry bound
 *        +
 *   runtime checked addition
 *        =
 *   proteção efetiva contra overflow.
 *
 * COMPATIBILIDADE
 * ---------------
 * Alguns aliases antigos são preservados temporariamente para evitar quebra
 * abrupta dos consumidores existentes.
 *
 * Eles são explicitamente marcados como `@deprecated` e NÃO devem ser
 * utilizados em código novo.
 *
 * O teste arquitetural deve bloquear NOVOS usos desses aliases.
 *
 * RASTREABILIDADE DE CONSUMIDORES
 * -------------------------------
 * Referências arquiteturais esperadas:
 *
 * - `Money256.ts`
 *   -> UINT256_*
 *   -> MAX_JS_SAFE_INTEGER*
 *
 * - `BaseUnits.ts`
 *   -> UINT256_*
 *   -> asset decimal bounds
 *
 * - `FinancialTextPolicy.ts`
 *   -> *_LENGTH
 *   -> *_TEXT_*
 *   -> NUL_CODE_POINT
 *
 * - `PostingPlanBuilder.ts`
 *   -> LEDGER_ENTRY_*
 *   -> POSTING_PLAN_*
 *
 * - `CanonicalRequestHashService.ts`
 *   -> SHA256_*
 *   -> MAX_CANONICAL_REQUEST_HASH_HEX_DIGITS
 *
 * - `IdempotencyScope.ts`
 *   -> MAX_IDEMPOTENCY_KEY_LENGTH
 *   -> MAX_IDEMPOTENCY_SCOPE_LENGTH
 *
 * - `DrizzleOutboxRepository.ts`
 *   -> MAX_OUTBOX_EVENT_NAME_LENGTH
 *   -> MAX_OUTBOX_AGGREGATE_TYPE_LENGTH
 *
 * A fonte da verdade sobre utilização efetiva permanece sendo a análise
 * estática/grep do código-fonte e os testes arquiteturais.
 */

/* ========================================================================== */
/* CATEGORY METADATA                                                          */
/* ========================================================================== */

export type FinancialLimitCategory =
    | 'MATHEMATICAL'
    | 'REPRESENTATION'
    | 'DOMAIN_STRUCTURAL_POLICY';

/**
 * Definição formal de uma política de limite.
 *
 * Esse tipo existe para que a classificação semântica do Finance Core possa
 * ser tratada como metadado verificável, e não somente como comentário.
 */
export interface FinancialLimitDefinition<
    T extends number | bigint,
> {
    readonly value: T;
    readonly category: FinancialLimitCategory;
}

/**
 * Unidade de comprimento textual usada pelo domínio.
 *
 * O valor é deliberadamente literal e não deve ser reinterpretado como
 * "Unicode code points" ou "grapheme clusters".
 */
export const FINANCIAL_TEXT_LENGTH_UNIT =
    'UTF16_CODE_UNITS' as const;

/**
 * Ponto de código Unicode NUL.
 *
 * `FinancialTextPolicy` deve rejeitar explicitamente esse caractere antes
 * da persistência.
 */
export const NUL_CODE_POINT = 0x0000;

/**
 * Política explícita de rejeição de NUL.
 *
 * Esta constante declara a política; o enforcement permanece em
 * `FinancialTextPolicy`.
 */
export const REJECT_NUL_IN_FINANCIAL_TEXT = true;

/* ========================================================================== */
/* UINT256 / MATHEMATICAL DOMAIN BOUNDS                                       */
/* ========================================================================== */

/**
 * CATEGORY: MATHEMATICAL
 *
 * Largura matemática do tipo financeiro uint256.
 */
export const UINT256_BITS = 256;

/**
 * CATEGORY: MATHEMATICAL
 *
 * Menor valor representável por uint256.
 */
export const MIN_UINT256 = 0n;

/**
 * CATEGORY: MATHEMATICAL
 *
 * Maior valor representável por uint256.
 *
 * Fórmula:
 *
 *   2^256 - 1
 */
export const MAX_UINT256: bigint =
    (1n << BigInt(UINT256_BITS)) - 1n;

/**
 * CATEGORY: REPRESENTATION
 *
 * Quantidade máxima de dígitos decimais necessários para representar
 * qualquer valor uint256 sem sinal.
 *
 * Derivado diretamente do valor matemático.
 */
export const MAX_UINT256_DECIMAL_DIGITS =
    String(MAX_UINT256).length;

/**
 * CATEGORY: REPRESENTATION
 *
 * Quantidade de bits representados por cada dígito hexadecimal.
 */
export const HEX_BITS_PER_DIGIT = 4;

/**
 * CATEGORY: REPRESENTATION
 *
 * Quantidade máxima de dígitos hexadecimais necessários para representar
 * qualquer uint256 sem prefixo `0x`.
 */
export const MAX_UINT256_HEX_DIGITS =
    UINT256_BITS / HEX_BITS_PER_DIGIT;

/**
 * CATEGORY: REPRESENTATION
 *
 * Valor seguro máximo para interoperabilidade explícita com JavaScript
 * `number`.
 *
 * NÃO é limite financeiro.
 */
export const MAX_JS_SAFE_INTEGER =
    Number.MAX_SAFE_INTEGER;

/**
 * CATEGORY: REPRESENTATION
 *
 * Quantidade de dígitos decimais de `Number.MAX_SAFE_INTEGER`.
 */
export const MAX_JS_SAFE_INTEGER_DECIMAL_DIGITS =
    String(MAX_JS_SAFE_INTEGER).length;

/* ========================================================================== */
/* LEGACY COMPATIBILITY ALIASES                                               */
/* ========================================================================== */

/**
 * @deprecated
 *
 * Use `MAX_JS_SAFE_INTEGER_DECIMAL_DIGITS`.
 *
 * Não utilizar em código novo.
 */
export const MAX_SAFE_INTEGER_DIGITS =
    MAX_JS_SAFE_INTEGER_DECIMAL_DIGITS;

/* ========================================================================== */
/* LEDGER / DOUBLE-ENTRY STRUCTURAL LIMITS                                    */
/* ========================================================================== */

/**
 * CATEGORY: DOMAIN_STRUCTURAL_POLICY
 *
 * Quantidade mínima estrutural de partidas de uma transação double-entry.
 *
 * Esta constante NÃO substitui a validação de equilíbrio contábil.
 */
export const MIN_DOUBLE_ENTRY_LEDGER_ENTRIES = 2;

/**
 * CATEGORY: DOMAIN_STRUCTURAL_POLICY
 *
 * Mínimo de lançamentos de uma transação financeira.
 */
export const MIN_LEDGER_ENTRIES =
    MIN_DOUBLE_ENTRY_LEDGER_ENTRIES;

/**
 * CATEGORY: DOMAIN_STRUCTURAL_POLICY
 *
 * Máximo de partidas permitidas em uma única transação contábil.
 */
export const MAX_LEDGER_ENTRIES = 100;

/**
 * CATEGORY: DOMAIN_STRUCTURAL_POLICY
 *
 * Menor ordinal válido.
 */
export const MIN_LEDGER_ENTRY_ORDINAL = 1;

/**
 * CATEGORY: DOMAIN_STRUCTURAL_POLICY
 *
 * Maior ordinal válido.
 *
 * Derivado da cardinalidade máxima para impedir divergência.
 */
export const MAX_LEDGER_ENTRY_ORDINAL =
    MAX_LEDGER_ENTRIES;

/**
 * CATEGORY: DOMAIN_STRUCTURAL_POLICY
 *
 * Quantidade mínima de entradas de um PostingPlan.
 */
export const MIN_POSTING_PLAN_ENTRIES =
    MIN_LEDGER_ENTRIES;

/**
 * CATEGORY: DOMAIN_STRUCTURAL_POLICY
 *
 * Quantidade máxima de entradas de um PostingPlan.
 */
export const MAX_POSTING_PLAN_ENTRIES =
    MAX_LEDGER_ENTRIES;

/* ========================================================================== */
/* LEDGER / ACCUMULATED DELTA SAFETY                                          */
/* ========================================================================== */

/**
 * CATEGORY: DOMAIN_STRUCTURAL_POLICY
 *
 * Maior valor permitido por uma perna contábil individual considerando
 * a cardinalidade máxima de um PostingPlan.
 *
 * Fórmula:
 *
 *   floor(MAX_UINT256 / MAX_LEDGER_ENTRIES)
 *
 * Propriedade garantida:
 *
 *   MAX_SINGLE_LEDGER_ENTRY_AMOUNT * MAX_LEDGER_ENTRIES
 *       <= MAX_UINT256
 *
 * IMPORTANTE:
 *
 * Esse bound protege somente a soma dos NOVOS DELTAS de uma transação.
 * Não substitui:
 *
 *   currentBalance + delta <= MAX_UINT256
 *
 * A adição contra o saldo existente deve continuar sendo validada
 * por `Money256`.
 */
export const MAX_SINGLE_LEDGER_ENTRY_AMOUNT: bigint =
    MAX_UINT256 / BigInt(MAX_LEDGER_ENTRIES);

/**
 * CATEGORY: DOMAIN_STRUCTURAL_POLICY
 *
 * Nome semântico para o mesmo bound quando consumido pelo mecanismo
 * de projeção de saldo.
 */
export const MAX_SINGLE_BALANCE_DELTA_AMOUNT: bigint =
    MAX_SINGLE_LEDGER_ENTRY_AMOUNT;

/**
 * CATEGORY: DOMAIN_STRUCTURAL_POLICY
 *
 * Nome explícito não-ambíguo para o limite de magnitude de delta individual
 * do lançamento/PostingPlan (P0-Matrix / P0-01).
 *
 * Propriedade garantida:
 *   MAX_SINGLE_POSTING_DELTA_MAGNITUDE * MAX_LEDGER_ENTRIES <= MAX_UINT256
 *
 * A adição/subtração contra o saldo existente da conta continua sendo
 * validada em tempo de execução por `Money256`.
 */
export const MAX_SINGLE_POSTING_DELTA_MAGNITUDE: bigint =
    MAX_SINGLE_LEDGER_ENTRY_AMOUNT;

/**
 * CATEGORY: MATHEMATICAL
 *
 * Maior soma teórica dos deltas individuais sob a política atual
 * de cardinalidade.
 */
export const MAX_POSTING_PLAN_ABSOLUTE_DELTA_SUM: bigint =
    MAX_SINGLE_LEDGER_ENTRY_AMOUNT *
    BigInt(MAX_LEDGER_ENTRIES);

/**
 * CATEGORY: MATHEMATICAL
 *
 * Invariante matemática do teto agregado.
 */
export const POSTING_PLAN_DELTA_BOUND_IS_UINT256_SAFE =
    MAX_POSTING_PLAN_ABSOLUTE_DELTA_SUM <= MAX_UINT256;

/* ========================================================================== */
/* ASSET DECIMAL SUPPORT POLICY                                               */
/* ========================================================================== */

/**
 * CATEGORY: DOMAIN_STRUCTURAL_POLICY
 *
 * Menor quantidade suportada de casas decimais por ativo.
 */
export const MIN_SUPPORTED_ASSET_DECIMALS = 0;

/**
 * CATEGORY: DOMAIN_STRUCTURAL_POLICY
 *
 * Maior quantidade suportada de casas decimais pelo Finance Core.
 *
 * Esta é uma POLÍTICA DE SUPORTE DO SISTEMA, e não uma propriedade
 * matemática universal de todos os ativos digitais.
 *
 * O valor 18 representa o envelope atualmente adotado para ativos EVM
 * e os casos de integração suportados pelo Finance Core.
 */
export const MAX_SUPPORTED_ASSET_DECIMALS = 18;

/**
 * CATEGORY: DOMAIN_STRUCTURAL_POLICY
 *
 * Maior quantidade de casas decimais permitida em um human amount
 * pelo envelope do Finance Core.
 *
 * O limite efetivo de uma operação concreta deve continuar sendo:
 *
 *   min(asset.decimals, MAX_SUPPORTED_ASSET_DECIMALS)
 */
export const MAX_HUMAN_AMOUNT_DECIMAL_PLACES =
    MAX_SUPPORTED_ASSET_DECIMALS;

/**
 * Nome mais explícito para novos consumidores.
 */
export const MAX_SUPPORTED_HUMAN_AMOUNT_DECIMAL_PLACES =
    MAX_HUMAN_AMOUNT_DECIMAL_PLACES;

/* ========================================================================== */
/* LEGACY ASSET DECIMAL COMPATIBILITY                                         */
/* ========================================================================== */

/**
 * @deprecated
 *
 * Use `MIN_SUPPORTED_ASSET_DECIMALS`.
 */
export const MIN_ASSET_DECIMALS =
    MIN_SUPPORTED_ASSET_DECIMALS;

/**
 * @deprecated
 *
 * Use `MAX_SUPPORTED_ASSET_DECIMALS`.
 */
export const MAX_ASSET_DECIMALS =
    MAX_SUPPORTED_ASSET_DECIMALS;

/* ========================================================================== */
/* TEXT / INPUT SAFETY                                                        */
/* ========================================================================== */

/**
 * CATEGORY: REPRESENTATION
 *
 * Teto máximo de texto bruto antes de normalização/processamento.
 *
 * Unidade:
 *   UTF-16 code units
 */
export const MAX_RAW_TEXT_CEILING = 1000;

/**
 * CATEGORY: REPRESENTATION
 *
 * Teto máximo de texto bruto para parsers numéricos.
 *
 * Este é um ceiling operacional de entrada bruta, NÃO a quantidade
 * matemática necessária para representar um uint256.
 */
export const MAX_NUMERIC_RAW_TEXT_CEILING = 256;

/**
 * CATEGORY: REPRESENTATION
 *
 * Teto operacional para buffers brutos de entrada numérica (payload protection contra DoS).
 * Distinto da representação matemática de uint256 (MAX_UINT256_DECIMAL_DIGITS = 78).
 */
export const MAX_NUMERIC_INPUT_TEXT_CEILING =
    MAX_NUMERIC_RAW_TEXT_CEILING;

/**
 * CATEGORY: DOMAIN_STRUCTURAL_POLICY
 *
 * Menor descrição contábil permitida.
 */
export const MIN_LEDGER_DESCRIPTION_LENGTH = 1;

/**
 * CATEGORY: DOMAIN_STRUCTURAL_POLICY
 *
 * Maior descrição contábil permitida.
 *
 * Unidade:
 *   UTF-16 code units
 */
export const MAX_LEDGER_DESCRIPTION_LENGTH = 255;

/**
 * CATEGORY: REPRESENTATION
 *
 * Teto default de texto financeiro genérico.
 *
 * Contratos específicos devem preferir um limite especializado.
 */
export const MAX_FINANCIAL_TEXT_DEFAULT_LENGTH = 255;

/**
 * @deprecated
 *
 * Use `MAX_FINANCIAL_TEXT_DEFAULT_LENGTH`.
 */
export const MAX_FINANCIAL_TEXT_LENGTH =
    MAX_FINANCIAL_TEXT_DEFAULT_LENGTH;

/* ========================================================================== */
/* IDEMPOTENCY / CANONICAL HASH                                               */
/* ========================================================================== */

/**
 * CATEGORY: DOMAIN_STRUCTURAL_POLICY
 *
 * Comprimento mínimo de uma chave de idempotência.
 *
 * Unidade:
 *   UTF-16 code units
 */
export const MIN_IDEMPOTENCY_KEY_LENGTH = 1;

/**
 * CATEGORY: DOMAIN_STRUCTURAL_POLICY
 *
 * Comprimento máximo de uma chave de idempotência.
 *
 * Unidade:
 *   UTF-16 code units
 */
export const MAX_IDEMPOTENCY_KEY_LENGTH = 255;

/**
 * CATEGORY: DOMAIN_STRUCTURAL_POLICY
 *
 * Comprimento mínimo do escopo de idempotência.
 */
export const MIN_IDEMPOTENCY_SCOPE_LENGTH = 1;

/**
 * CATEGORY: DOMAIN_STRUCTURAL_POLICY
 *
 * Comprimento máximo do escopo de idempotência.
 *
 * Unidade:
 *   UTF-16 code units
 */
export const MAX_IDEMPOTENCY_SCOPE_LENGTH = 255;

/**
 * CATEGORY: MATHEMATICAL
 *
 * Largura criptográfica do SHA-256.
 */
export const SHA256_BITS = 256;

/**
 * CATEGORY: REPRESENTATION
 *
 * Tamanho em bytes do digest SHA-256.
 */
export const SHA256_BYTES =
    SHA256_BITS / 8;

/**
 * CATEGORY: REPRESENTATION
 *
 * Tamanho hexadecimal do digest SHA-256 sem prefixo `0x`.
 */
export const SHA256_HEX_DIGITS =
    SHA256_BITS / HEX_BITS_PER_DIGIT;

/**
 * CATEGORY: REPRESENTATION
 *
 * Tamanho máximo da representação hexadecimal do request hash canônico.
 */
export const MAX_CANONICAL_REQUEST_HASH_HEX_DIGITS =
    SHA256_HEX_DIGITS;

/**
 * CATEGORY: REPRESENTATION
 *
 * Comprimento do prefixo hexadecimal opcional `0x`.
 *
 * O prefixo não faz parte de `SHA256_HEX_DIGITS`.
 */
export const HEX_PREFIX_LENGTH = 2;

/* ========================================================================== */
/* POSTING PLAN SEAL                                                          */
/* ========================================================================== */

/**
 * O domínio reconhece conceitualmente a existência de um selo de integridade
 * do PostingPlan, porém NÃO fixa aqui algoritmo, encoding ou comprimento.
 *
 * O contrato concreto deve ser estabelecido quando:
 *
 * - `PostingPlan` definir sua representação;
 * - `PostingAuthority` definir o processo de verificação.
 *
 * Isso impede que SHA-256/hex seja imposto artificialmente neste módulo.
 */

/* ========================================================================== */
/* EXTERNAL FINANCIAL IDENTIFIERS / REFERENCES                               */
/* ========================================================================== */

/**
 * CATEGORY: REPRESENTATION
 *
 * Teto estrutural default para identificadores financeiros textuais.
 *
 * Este valor é um fallback para identificadores externos/domain-facing.
 * IDs internos INTEGER do banco não utilizam este limite.
 */
export const MAX_FINANCIAL_IDENTIFIER_DEFAULT_LENGTH = 255;

/**
 * CATEGORY: REPRESENTATION
 *
 * Identificador externo textual de conta financeira.
 *
 * Este nome torna explícita a distinção entre:
 *
 * - account.id INTEGER interno;
 * - identificador textual externo/domain-facing.
 */
export const MAX_EXTERNAL_FINANCIAL_ACCOUNT_ID_LENGTH =
    MAX_FINANCIAL_IDENTIFIER_DEFAULT_LENGTH;

/**
 * CATEGORY: REPRESENTATION
 *
 * Identificador externo textual de transação financeira.
 */
export const MAX_EXTERNAL_FINANCIAL_TRANSACTION_ID_LENGTH =
    MAX_FINANCIAL_IDENTIFIER_DEFAULT_LENGTH;

/**
 * CATEGORY: REPRESENTATION
 *
 * Identificador externo textual de lançamento contábil.
 */
export const MAX_EXTERNAL_LEDGER_ENTRY_ID_LENGTH =
    MAX_FINANCIAL_IDENTIFIER_DEFAULT_LENGTH;

/**
 * CATEGORY: REPRESENTATION
 *
 * Identificador externo textual de ativo.
 */
export const MAX_EXTERNAL_ASSET_ID_LENGTH =
    MAX_FINANCIAL_IDENTIFIER_DEFAULT_LENGTH;

/**
 * CATEGORY: REPRESENTATION
 *
 * Identificador textual do ator/usuário.
 */
export const MAX_ACTOR_USER_ID_LENGTH =
    MAX_FINANCIAL_IDENTIFIER_DEFAULT_LENGTH;

/**
 * CATEGORY: REPRESENTATION
 *
 * Identificador textual de autorização/capacidade.
 */
export const MAX_AUTHORIZATION_ID_LENGTH =
    MAX_FINANCIAL_IDENTIFIER_DEFAULT_LENGTH;

/**
 * CATEGORY: REPRESENTATION
 *
 * Identificador textual de rota de conta sistêmica.
 */
export const MAX_SYSTEM_ACCOUNT_ROUTE_ID_LENGTH =
    MAX_FINANCIAL_IDENTIFIER_DEFAULT_LENGTH;

/**
 * CATEGORY: REPRESENTATION
 *
 * Referência externa de reconciliação.
 */
export const MAX_EXTERNAL_REFERENCE_LENGTH =
    MAX_FINANCIAL_IDENTIFIER_DEFAULT_LENGTH;

/**
 * CATEGORY: REPRESENTATION
 *
 * Referência financeira textual canônica.
 */
export const MAX_FINANCIAL_REFERENCE_LENGTH =
    MAX_FINANCIAL_IDENTIFIER_DEFAULT_LENGTH;

/* ========================================================================== */
/* LEGACY IDENTIFIER COMPATIBILITY                                            */
/* ========================================================================== */

/**
 * @deprecated
 *
 * Use `MAX_EXTERNAL_FINANCIAL_ACCOUNT_ID_LENGTH`.
 */
export const MAX_FINANCIAL_ACCOUNT_ID_LENGTH =
    MAX_EXTERNAL_FINANCIAL_ACCOUNT_ID_LENGTH;

/**
 * @deprecated
 *
 * Use `MAX_EXTERNAL_FINANCIAL_TRANSACTION_ID_LENGTH`.
 */
export const MAX_FINANCIAL_TRANSACTION_ID_LENGTH =
    MAX_EXTERNAL_FINANCIAL_TRANSACTION_ID_LENGTH;

/**
 * @deprecated
 *
 * Use `MAX_EXTERNAL_LEDGER_ENTRY_ID_LENGTH`.
 */
export const MAX_LEDGER_ENTRY_ID_LENGTH =
    MAX_EXTERNAL_LEDGER_ENTRY_ID_LENGTH;

/**
 * @deprecated
 *
 * Use `MAX_EXTERNAL_ASSET_ID_LENGTH`.
 */
export const MAX_ASSET_ID_LENGTH =
    MAX_EXTERNAL_ASSET_ID_LENGTH;

/* ========================================================================== */
/* ASSET SYMBOLIC CODE                                                        */
/* ========================================================================== */

/**
 * CATEGORY: DOMAIN_STRUCTURAL_POLICY
 *
 * Comprimento mínimo do código simbólico público do ativo.
 *
 * Exemplos:
 *   BRL
 *   USD
 *   BTC
 *   ETH
 *
 * Unidade:
 *   UTF-16 code units
 */
export const MIN_SUPPORTED_ASSET_CODE_LENGTH = 1;

/**
 * CATEGORY: DOMAIN_STRUCTURAL_POLICY
 *
 * Comprimento máximo do código simbólico público do ativo.
 *
 * Esta é uma POLÍTICA DE SUPORTE do Finance Core, não uma propriedade
 * universal de todos os tickers existentes.
 *
 * Unidade:
 *   UTF-16 code units
 */
export const MAX_SUPPORTED_ASSET_CODE_LENGTH = 16;

/**
 * @deprecated
 *
 * Use `MIN_SUPPORTED_ASSET_CODE_LENGTH`.
 */
export const MIN_ASSET_CODE_LENGTH =
    MIN_SUPPORTED_ASSET_CODE_LENGTH;

/**
 * @deprecated
 *
 * Use `MAX_SUPPORTED_ASSET_CODE_LENGTH`.
 */
export const MAX_ASSET_CODE_LENGTH =
    MAX_SUPPORTED_ASSET_CODE_LENGTH;

/* ========================================================================== */
/* REPRESENTATION / SERIALIZATION                                             */
/* ========================================================================== */

/**
 * CATEGORY: REPRESENTATION
 *
 * Comprimento máximo de uma representação decimal de uint256.
 *
 * Válido para:
 *
 *   0 ... MAX_UINT256
 *
 * Não inclui wrappers de protocolo.
 */
export const MAX_UINT256_STRING_LENGTH =
    MAX_UINT256_DECIMAL_DIGITS;

/**
 * CATEGORY: REPRESENTATION
 *
 * Comprimento máximo da representação hexadecimal de uint256 sem `0x`.
 */
export const MAX_UINT256_HEX_STRING_LENGTH =
    MAX_UINT256_HEX_DIGITS;

/* ========================================================================== */
/* TRANSACTIONAL OUTBOX                                                       */
/* ========================================================================== */

/**
 * CATEGORY: DOMAIN_STRUCTURAL_POLICY
 *
 * Comprimento máximo do nome de evento contábil.
 *
 * Unidade:
 *   UTF-16 code units
 */
export const MAX_OUTBOX_EVENT_NAME_LENGTH = 255;

/**
 * CATEGORY: DOMAIN_STRUCTURAL_POLICY
 *
 * Comprimento máximo do tipo de agregado do outbox.
 *
 * Unidade:
 *   UTF-16 code units
 */
export const MAX_OUTBOX_AGGREGATE_TYPE_LENGTH = 255;

/* ========================================================================== */
/* ARCHITECTURAL INVARIANT REFERENCES                                         */
/* ========================================================================== */

/**
 * CATEGORY: DOMAIN_STRUCTURAL_POLICY
 *
 * Faixa válida de quantidade de entradas do ledger.
 */
export const LEDGER_ENTRY_COUNT_MIN =
    MIN_LEDGER_ENTRIES;

export const LEDGER_ENTRY_COUNT_MAX =
    MAX_LEDGER_ENTRIES;

/**
 * CATEGORY: DOMAIN_STRUCTURAL_POLICY
 *
 * Faixa válida de quantidade de entradas do PostingPlan.
 */
export const POSTING_PLAN_ENTRY_COUNT_MIN =
    MIN_POSTING_PLAN_ENTRIES;

export const POSTING_PLAN_ENTRY_COUNT_MAX =
    MAX_POSTING_PLAN_ENTRIES;

/**
 * CATEGORY: DOMAIN_STRUCTURAL_POLICY
 *
 * Faixa válida de ordinais do ledger/PostingPlan.
 */
export const POSTING_PLAN_ORDINAL_MIN =
    MIN_LEDGER_ENTRY_ORDINAL;

export const POSTING_PLAN_ORDINAL_MAX =
    MAX_LEDGER_ENTRY_ORDINAL;

/**
 * CATEGORY: DOMAIN_STRUCTURAL_POLICY
 *
 * Teto máximo individual de delta contábil permitido pelo bound
 * de acumulação estrutural.
 */
export const ACCUMULATED_OVERFLOW_SAFE_ENTRY_AMOUNT_MAX: bigint =
    MAX_SINGLE_LEDGER_ENTRY_AMOUNT;

/* ========================================================================== */
/* LEGACY COMPATIBILITY EXPORTS                                               */
/* ========================================================================== */

/**
 * @deprecated
 *
 * Use `MAX_FINANCIAL_IDENTIFIER_DEFAULT_LENGTH`.
 *
 * O nome legado é preservado para compatibilidade, mas não deve ser usado
 * em código novo.
 */
export const MAX_FINANCIAL_IDENTIFIER_LENGTH =
    MAX_FINANCIAL_IDENTIFIER_DEFAULT_LENGTH;

/* ========================================================================== */
/* MACHINE-READABLE FINANCIAL LIMIT MANIFEST                                  */
/* ========================================================================== */

/**
 * Manifesto único dos limites canônicos.
 *
 * `FINANCIAL_LIMITS` é a referência machine-readable dos limites expostos
 * pelo módulo. O `Object.freeze` protege o manifesto contra mutação acidental
 * em runtime.
 *
 * Aliases legados permanecem disponíveis para consumidores antigos, mas não
 * fazem parte deste manifesto canônico.
 */
const financialLimits = {
    UINT256_BITS,
    MIN_UINT256,
    MAX_UINT256,
    MAX_UINT256_DECIMAL_DIGITS,
    HEX_BITS_PER_DIGIT,
    MAX_UINT256_HEX_DIGITS,
    MAX_JS_SAFE_INTEGER,
    MAX_JS_SAFE_INTEGER_DECIMAL_DIGITS,

    MIN_DOUBLE_ENTRY_LEDGER_ENTRIES,
    MIN_LEDGER_ENTRIES,
    MAX_LEDGER_ENTRIES,
    MIN_LEDGER_ENTRY_ORDINAL,
    MAX_LEDGER_ENTRY_ORDINAL,
    MIN_POSTING_PLAN_ENTRIES,
    MAX_POSTING_PLAN_ENTRIES,

    MAX_SINGLE_LEDGER_ENTRY_AMOUNT,
    MAX_SINGLE_BALANCE_DELTA_AMOUNT,
    MAX_SINGLE_POSTING_DELTA_MAGNITUDE,
    MAX_POSTING_PLAN_ABSOLUTE_DELTA_SUM,

    MIN_SUPPORTED_ASSET_DECIMALS,
    MAX_SUPPORTED_ASSET_DECIMALS,
    MAX_HUMAN_AMOUNT_DECIMAL_PLACES,
    MAX_SUPPORTED_HUMAN_AMOUNT_DECIMAL_PLACES,

    MAX_RAW_TEXT_CEILING,
    MAX_NUMERIC_RAW_TEXT_CEILING,
    MAX_NUMERIC_INPUT_TEXT_CEILING,
    MIN_LEDGER_DESCRIPTION_LENGTH,
    MAX_LEDGER_DESCRIPTION_LENGTH,
    MAX_FINANCIAL_TEXT_DEFAULT_LENGTH,

    MIN_IDEMPOTENCY_KEY_LENGTH,
    MAX_IDEMPOTENCY_KEY_LENGTH,
    MIN_IDEMPOTENCY_SCOPE_LENGTH,
    MAX_IDEMPOTENCY_SCOPE_LENGTH,

    SHA256_BITS,
    SHA256_BYTES,
    SHA256_HEX_DIGITS,
    MAX_CANONICAL_REQUEST_HASH_HEX_DIGITS,
    HEX_PREFIX_LENGTH,

    MAX_FINANCIAL_IDENTIFIER_DEFAULT_LENGTH,
    MAX_EXTERNAL_FINANCIAL_ACCOUNT_ID_LENGTH,
    MAX_EXTERNAL_FINANCIAL_TRANSACTION_ID_LENGTH,
    MAX_EXTERNAL_LEDGER_ENTRY_ID_LENGTH,
    MAX_EXTERNAL_ASSET_ID_LENGTH,
    MAX_ACTOR_USER_ID_LENGTH,
    MAX_AUTHORIZATION_ID_LENGTH,
    MAX_SYSTEM_ACCOUNT_ROUTE_ID_LENGTH,
    MAX_EXTERNAL_REFERENCE_LENGTH,
    MAX_FINANCIAL_REFERENCE_LENGTH,

    MIN_SUPPORTED_ASSET_CODE_LENGTH,
    MAX_SUPPORTED_ASSET_CODE_LENGTH,

    MAX_UINT256_STRING_LENGTH,
    MAX_UINT256_HEX_STRING_LENGTH,

    MAX_OUTBOX_EVENT_NAME_LENGTH,
    MAX_OUTBOX_AGGREGATE_TYPE_LENGTH,

    LEDGER_ENTRY_COUNT_MIN,
    LEDGER_ENTRY_COUNT_MAX,
    POSTING_PLAN_ENTRY_COUNT_MIN,
    POSTING_PLAN_ENTRY_COUNT_MAX,
    POSTING_PLAN_ORDINAL_MIN,
    POSTING_PLAN_ORDINAL_MAX,

    ACCUMULATED_OVERFLOW_SAFE_ENTRY_AMOUNT_MAX,
} as const;

export const FINANCIAL_LIMITS = Object.freeze(financialLimits);

/**
 * Nome de um limite canônico do Finance Core.
 */
export type FinancialLimitName =
    keyof typeof FINANCIAL_LIMITS;

/* ========================================================================== */
/* EXECUTABLE CATEGORY METADATA                                               */
/* ========================================================================== */

/**
 * Classificação machine-readable dos limites.
 *
 * A tipagem exige que cada chave de `FINANCIAL_LIMITS` possua uma categoria.
 *
 * Dessa forma:
 *
 * - adicionar um novo limite exige classificá-lo;
 * - remover/renomear um limite exige atualizar a matriz;
 * - a categorização deixa de depender exclusivamente de comentários.
 */
const financialLimitCategories = {
    UINT256_BITS: 'MATHEMATICAL',
    MIN_UINT256: 'MATHEMATICAL',
    MAX_UINT256: 'MATHEMATICAL',
    MAX_UINT256_DECIMAL_DIGITS: 'REPRESENTATION',
    HEX_BITS_PER_DIGIT: 'REPRESENTATION',
    MAX_UINT256_HEX_DIGITS: 'REPRESENTATION',
    MAX_JS_SAFE_INTEGER: 'REPRESENTATION',
    MAX_JS_SAFE_INTEGER_DECIMAL_DIGITS: 'REPRESENTATION',

    MIN_DOUBLE_ENTRY_LEDGER_ENTRIES: 'DOMAIN_STRUCTURAL_POLICY',
    MIN_LEDGER_ENTRIES: 'DOMAIN_STRUCTURAL_POLICY',
    MAX_LEDGER_ENTRIES: 'DOMAIN_STRUCTURAL_POLICY',
    MIN_LEDGER_ENTRY_ORDINAL: 'DOMAIN_STRUCTURAL_POLICY',
    MAX_LEDGER_ENTRY_ORDINAL: 'DOMAIN_STRUCTURAL_POLICY',
    MIN_POSTING_PLAN_ENTRIES: 'DOMAIN_STRUCTURAL_POLICY',
    MAX_POSTING_PLAN_ENTRIES: 'DOMAIN_STRUCTURAL_POLICY',

    MAX_SINGLE_LEDGER_ENTRY_AMOUNT: 'DOMAIN_STRUCTURAL_POLICY',
    MAX_SINGLE_BALANCE_DELTA_AMOUNT: 'DOMAIN_STRUCTURAL_POLICY',
    MAX_SINGLE_POSTING_DELTA_MAGNITUDE: 'DOMAIN_STRUCTURAL_POLICY',
    MAX_POSTING_PLAN_ABSOLUTE_DELTA_SUM: 'MATHEMATICAL',

    MIN_SUPPORTED_ASSET_DECIMALS: 'DOMAIN_STRUCTURAL_POLICY',
    MAX_SUPPORTED_ASSET_DECIMALS: 'DOMAIN_STRUCTURAL_POLICY',
    MAX_HUMAN_AMOUNT_DECIMAL_PLACES: 'DOMAIN_STRUCTURAL_POLICY',
    MAX_SUPPORTED_HUMAN_AMOUNT_DECIMAL_PLACES:
        'DOMAIN_STRUCTURAL_POLICY',

    MAX_RAW_TEXT_CEILING: 'REPRESENTATION',
    MAX_NUMERIC_RAW_TEXT_CEILING: 'REPRESENTATION',
    MAX_NUMERIC_INPUT_TEXT_CEILING: 'REPRESENTATION',
    MIN_LEDGER_DESCRIPTION_LENGTH: 'DOMAIN_STRUCTURAL_POLICY',
    MAX_LEDGER_DESCRIPTION_LENGTH: 'DOMAIN_STRUCTURAL_POLICY',
    MAX_FINANCIAL_TEXT_DEFAULT_LENGTH: 'REPRESENTATION',

    MIN_IDEMPOTENCY_KEY_LENGTH: 'DOMAIN_STRUCTURAL_POLICY',
    MAX_IDEMPOTENCY_KEY_LENGTH: 'DOMAIN_STRUCTURAL_POLICY',
    MIN_IDEMPOTENCY_SCOPE_LENGTH: 'DOMAIN_STRUCTURAL_POLICY',
    MAX_IDEMPOTENCY_SCOPE_LENGTH: 'DOMAIN_STRUCTURAL_POLICY',

    SHA256_BITS: 'MATHEMATICAL',
    SHA256_BYTES: 'REPRESENTATION',
    SHA256_HEX_DIGITS: 'REPRESENTATION',
    MAX_CANONICAL_REQUEST_HASH_HEX_DIGITS: 'REPRESENTATION',
    HEX_PREFIX_LENGTH: 'REPRESENTATION',

    MAX_FINANCIAL_IDENTIFIER_DEFAULT_LENGTH:
        'REPRESENTATION',
    MAX_EXTERNAL_FINANCIAL_ACCOUNT_ID_LENGTH:
        'REPRESENTATION',
    MAX_EXTERNAL_FINANCIAL_TRANSACTION_ID_LENGTH:
        'REPRESENTATION',
    MAX_EXTERNAL_LEDGER_ENTRY_ID_LENGTH:
        'REPRESENTATION',
    MAX_EXTERNAL_ASSET_ID_LENGTH:
        'REPRESENTATION',
    MAX_ACTOR_USER_ID_LENGTH:
        'REPRESENTATION',
    MAX_AUTHORIZATION_ID_LENGTH:
        'REPRESENTATION',
    MAX_SYSTEM_ACCOUNT_ROUTE_ID_LENGTH:
        'REPRESENTATION',
    MAX_EXTERNAL_REFERENCE_LENGTH:
        'REPRESENTATION',
    MAX_FINANCIAL_REFERENCE_LENGTH:
        'REPRESENTATION',

    MIN_SUPPORTED_ASSET_CODE_LENGTH:
        'DOMAIN_STRUCTURAL_POLICY',
    MAX_SUPPORTED_ASSET_CODE_LENGTH:
        'DOMAIN_STRUCTURAL_POLICY',

    MAX_UINT256_STRING_LENGTH:
        'REPRESENTATION',
    MAX_UINT256_HEX_STRING_LENGTH:
        'REPRESENTATION',

    MAX_OUTBOX_EVENT_NAME_LENGTH:
        'DOMAIN_STRUCTURAL_POLICY',
    MAX_OUTBOX_AGGREGATE_TYPE_LENGTH:
        'DOMAIN_STRUCTURAL_POLICY',

    LEDGER_ENTRY_COUNT_MIN:
        'DOMAIN_STRUCTURAL_POLICY',
    LEDGER_ENTRY_COUNT_MAX:
        'DOMAIN_STRUCTURAL_POLICY',
    POSTING_PLAN_ENTRY_COUNT_MIN:
        'DOMAIN_STRUCTURAL_POLICY',
    POSTING_PLAN_ENTRY_COUNT_MAX:
        'DOMAIN_STRUCTURAL_POLICY',
    POSTING_PLAN_ORDINAL_MIN:
        'DOMAIN_STRUCTURAL_POLICY',
    POSTING_PLAN_ORDINAL_MAX:
        'DOMAIN_STRUCTURAL_POLICY',

    ACCUMULATED_OVERFLOW_SAFE_ENTRY_AMOUNT_MAX:
        'DOMAIN_STRUCTURAL_POLICY',
} as const satisfies {
    readonly [K in FinancialLimitName]:
    FinancialLimitCategory;
};

export const FINANCIAL_LIMIT_CATEGORIES = Object.freeze(
    financialLimitCategories,
);

/* ========================================================================== */
/* MACHINE-READABLE LEGACY ALIAS MANIFEST                                    */
/* ========================================================================== */

/**
 * Aliases legados que ainda podem existir temporariamente.
 *
 * Esse manifesto permite que um teste arquitetural proíba novos usos no
 * código de produção sem remover imediatamente a compatibilidade binária/
 * de compilação dos consumidores antigos.
 */
export const FINANCIAL_DEPRECATED_LIMIT_ALIASES = Object.freeze(
    [
        'MAX_SAFE_INTEGER_DIGITS',
        'MIN_ASSET_DECIMALS',
        'MAX_ASSET_DECIMALS',
        'MIN_ASSET_CODE_LENGTH',
        'MAX_ASSET_CODE_LENGTH',
        'MAX_FINANCIAL_ACCOUNT_ID_LENGTH',
        'MAX_FINANCIAL_TRANSACTION_ID_LENGTH',
        'MAX_LEDGER_ENTRY_ID_LENGTH',
        'MAX_ASSET_ID_LENGTH',
        'MAX_FINANCIAL_TEXT_LENGTH',
        'MAX_FINANCIAL_IDENTIFIER_LENGTH',
    ] as const,
);

/* ========================================================================== */
/* EXECUTABLE INVARIANTS                                                      */
/* ========================================================================== */

/**
 * Verifica a coerência interna dos limites do módulo.
 *
 * IMPORTANTE:
 *
 * - esta função não possui efeitos colaterais externos;
 * - ela NÃO é executada automaticamente no import;
 * - pode ser chamada pelos testes do Finance Core;
 * - pode ser utilizada por uma etapa de bootstrap/diagnóstico se desejado.
 *
 * A escolha de não executar automaticamente evita side effects em um módulo
 * puramente declarativo do domínio.
 */
export function assertFinancialLimitsConsistency(): void {
    assertCondition(
        Number.isInteger(UINT256_BITS) &&
        UINT256_BITS > 0,
        'UINT256_BITS must be a positive integer.',
    );

    assertCondition(
        Number.isInteger(HEX_BITS_PER_DIGIT) &&
        HEX_BITS_PER_DIGIT > 0,
        'HEX_BITS_PER_DIGIT must be a positive integer.',
    );

    assertCondition(
        UINT256_BITS % HEX_BITS_PER_DIGIT === 0,
        'UINT256_BITS must be divisible by HEX_BITS_PER_DIGIT.',
    );

    assertCondition(
        MIN_UINT256 === 0n,
        'MIN_UINT256 must remain zero.',
    );

    assertCondition(
        MAX_UINT256 ===
        (1n << BigInt(UINT256_BITS)) - 1n,
        'MAX_UINT256 must equal 2^UINT256_BITS - 1.',
    );

    assertCondition(
        MAX_UINT256_DECIMAL_DIGITS ===
        String(MAX_UINT256).length,
        'MAX_UINT256_DECIMAL_DIGITS must match MAX_UINT256 decimal representation.',
    );

    assertCondition(
        MAX_UINT256_HEX_DIGITS ===
        UINT256_BITS / HEX_BITS_PER_DIGIT,
        'MAX_UINT256_HEX_DIGITS must be derived from UINT256_BITS.',
    );

    assertCondition(
        Number.isSafeInteger(MAX_JS_SAFE_INTEGER) &&
        MAX_JS_SAFE_INTEGER === Number.MAX_SAFE_INTEGER,
        'MAX_JS_SAFE_INTEGER must equal Number.MAX_SAFE_INTEGER.',
    );

    assertCondition(
        MIN_DOUBLE_ENTRY_LEDGER_ENTRIES >= 2,
        'Double-entry ledger minimum must be at least two entries.',
    );

    assertCondition(
        MIN_LEDGER_ENTRIES ===
        MIN_DOUBLE_ENTRY_LEDGER_ENTRIES,
        'MIN_LEDGER_ENTRIES must derive from MIN_DOUBLE_ENTRY_LEDGER_ENTRIES.',
    );

    assertCondition(
        MIN_LEDGER_ENTRIES <= MAX_LEDGER_ENTRIES,
        'MIN_LEDGER_ENTRIES must not exceed MAX_LEDGER_ENTRIES.',
    );

    assertCondition(
        MIN_LEDGER_ENTRY_ORDINAL === 1,
        'MIN_LEDGER_ENTRY_ORDINAL must remain one.',
    );

    assertCondition(
        MAX_LEDGER_ENTRY_ORDINAL ===
        MAX_LEDGER_ENTRIES,
        'MAX_LEDGER_ENTRY_ORDINAL must equal MAX_LEDGER_ENTRIES.',
    );

    assertCondition(
        MIN_POSTING_PLAN_ENTRIES ===
        MIN_LEDGER_ENTRIES,
        'MIN_POSTING_PLAN_ENTRIES must derive from MIN_LEDGER_ENTRIES.',
    );

    assertCondition(
        MAX_POSTING_PLAN_ENTRIES ===
        MAX_LEDGER_ENTRIES,
        'MAX_POSTING_PLAN_ENTRIES must derive from MAX_LEDGER_ENTRIES.',
    );

    assertCondition(
        MAX_SINGLE_LEDGER_ENTRY_AMOUNT >= 0n,
        'MAX_SINGLE_LEDGER_ENTRY_AMOUNT cannot be negative.',
    );

    assertCondition(
        MAX_SINGLE_LEDGER_ENTRY_AMOUNT *
        BigInt(MAX_LEDGER_ENTRIES) <=
        MAX_UINT256,
        'Aggregated per-entry ledger deltas must remain uint256-safe.',
    );

    assertCondition(
        MAX_SINGLE_BALANCE_DELTA_AMOUNT ===
        MAX_SINGLE_LEDGER_ENTRY_AMOUNT,
        'Balance delta bound must derive from the single ledger entry bound.',
    );

    assertCondition(
        MAX_POSTING_PLAN_ABSOLUTE_DELTA_SUM <=
        MAX_UINT256,
        'MAX_POSTING_PLAN_ABSOLUTE_DELTA_SUM must remain uint256-safe.',
    );

    assertCondition(
        POSTING_PLAN_DELTA_BOUND_IS_UINT256_SAFE ===
        true,
        'POSTING_PLAN_DELTA_BOUND_IS_UINT256_SAFE must be true.',
    );

    assertCondition(
        MIN_SUPPORTED_ASSET_DECIMALS >= 0,
        'Minimum supported asset decimals cannot be negative.',
    );

    assertCondition(
        MIN_SUPPORTED_ASSET_DECIMALS <=
        MAX_SUPPORTED_ASSET_DECIMALS,
        'Minimum asset decimals cannot exceed maximum asset decimals.',
    );

    assertCondition(
        MAX_HUMAN_AMOUNT_DECIMAL_PLACES ===
        MAX_SUPPORTED_ASSET_DECIMALS,
        'Human amount decimal limit must derive from supported asset decimals.',
    );

    assertCondition(
        MAX_SUPPORTED_HUMAN_AMOUNT_DECIMAL_PLACES ===
        MAX_HUMAN_AMOUNT_DECIMAL_PLACES,
        'Supported human amount decimal alias must remain synchronized.',
    );

    assertCondition(
        MIN_LEDGER_DESCRIPTION_LENGTH >= 0 &&
        MIN_LEDGER_DESCRIPTION_LENGTH <=
        MAX_LEDGER_DESCRIPTION_LENGTH,
        'Ledger description length bounds are inconsistent.',
    );

    assertCondition(
        MAX_LEDGER_DESCRIPTION_LENGTH <=
        MAX_RAW_TEXT_CEILING,
        'Ledger description length must not exceed raw text ceiling.',
    );

    assertCondition(
        MAX_NUMERIC_RAW_TEXT_CEILING <=
        MAX_RAW_TEXT_CEILING,
        'Numeric raw text ceiling cannot exceed global raw text ceiling.',
    );

    assertCondition(
        MIN_IDEMPOTENCY_KEY_LENGTH >= 1 &&
        MIN_IDEMPOTENCY_KEY_LENGTH <=
        MAX_IDEMPOTENCY_KEY_LENGTH,
        'Idempotency key bounds are inconsistent.',
    );

    assertCondition(
        MIN_IDEMPOTENCY_SCOPE_LENGTH >= 1 &&
        MIN_IDEMPOTENCY_SCOPE_LENGTH <=
        MAX_IDEMPOTENCY_SCOPE_LENGTH,
        'Idempotency scope bounds are inconsistent.',
    );

    assertCondition(
        SHA256_BITS === 256,
        'SHA256_BITS must remain 256.',
    );

    assertCondition(
        SHA256_BITS % 8 === 0,
        'SHA256_BITS must be divisible by eight.',
    );

    assertCondition(
        SHA256_BYTES === SHA256_BITS / 8,
        'SHA256_BYTES must derive from SHA256_BITS.',
    );

    assertCondition(
        SHA256_HEX_DIGITS ===
        SHA256_BITS / HEX_BITS_PER_DIGIT,
        'SHA256_HEX_DIGITS must derive from SHA256_BITS and HEX_BITS_PER_DIGIT.',
    );

    assertCondition(
        MAX_CANONICAL_REQUEST_HASH_HEX_DIGITS ===
        SHA256_HEX_DIGITS,
        'Canonical request hash size must derive from SHA256_HEX_DIGITS.',
    );

    assertCondition(
        HEX_PREFIX_LENGTH === 2,
        'HEX_PREFIX_LENGTH must remain compatible with 0x.',
    );

    assertCondition(
        MAX_FINANCIAL_IDENTIFIER_DEFAULT_LENGTH >= 1,
        'Default financial identifier length must be positive.',
    );

    assertCondition(
        MAX_EXTERNAL_FINANCIAL_ACCOUNT_ID_LENGTH ===
        MAX_FINANCIAL_IDENTIFIER_DEFAULT_LENGTH,
        'External account identifier bound must derive from the default.',
    );

    assertCondition(
        MAX_EXTERNAL_FINANCIAL_TRANSACTION_ID_LENGTH ===
        MAX_FINANCIAL_IDENTIFIER_DEFAULT_LENGTH,
        'External transaction identifier bound must derive from the default.',
    );

    assertCondition(
        MAX_EXTERNAL_LEDGER_ENTRY_ID_LENGTH ===
        MAX_FINANCIAL_IDENTIFIER_DEFAULT_LENGTH,
        'External ledger entry identifier bound must derive from the default.',
    );

    assertCondition(
        MAX_EXTERNAL_ASSET_ID_LENGTH ===
        MAX_FINANCIAL_IDENTIFIER_DEFAULT_LENGTH,
        'External asset identifier bound must derive from the default.',
    );

    assertCondition(
        MAX_ACTOR_USER_ID_LENGTH ===
        MAX_FINANCIAL_IDENTIFIER_DEFAULT_LENGTH,
        'Actor identifier bound must derive from the default.',
    );

    assertCondition(
        MAX_AUTHORIZATION_ID_LENGTH ===
        MAX_FINANCIAL_IDENTIFIER_DEFAULT_LENGTH,
        'Authorization identifier bound must derive from the default.',
    );

    assertCondition(
        MAX_SYSTEM_ACCOUNT_ROUTE_ID_LENGTH ===
        MAX_FINANCIAL_IDENTIFIER_DEFAULT_LENGTH,
        'System account route identifier bound must derive from the default.',
    );

    assertCondition(
        MAX_EXTERNAL_REFERENCE_LENGTH ===
        MAX_FINANCIAL_IDENTIFIER_DEFAULT_LENGTH,
        'External reference bound must derive from the default.',
    );

    assertCondition(
        MAX_FINANCIAL_REFERENCE_LENGTH ===
        MAX_FINANCIAL_IDENTIFIER_DEFAULT_LENGTH,
        'Financial reference bound must derive from the default.',
    );

    assertCondition(
        MIN_SUPPORTED_ASSET_CODE_LENGTH >= 1 &&
        MIN_SUPPORTED_ASSET_CODE_LENGTH <=
        MAX_SUPPORTED_ASSET_CODE_LENGTH,
        'Asset symbolic code length bounds are inconsistent.',
    );

    assertCondition(
        MAX_UINT256_STRING_LENGTH ===
        MAX_UINT256_DECIMAL_DIGITS,
        'MAX_UINT256_STRING_LENGTH must derive from MAX_UINT256_DECIMAL_DIGITS.',
    );

    assertCondition(
        MAX_UINT256_HEX_STRING_LENGTH ===
        MAX_UINT256_HEX_DIGITS,
        'MAX_UINT256_HEX_STRING_LENGTH must derive from MAX_UINT256_HEX_DIGITS.',
    );

    assertCondition(
        MAX_FINANCIAL_TEXT_DEFAULT_LENGTH <=
        MAX_RAW_TEXT_CEILING,
        'Default financial text length must not exceed raw text ceiling.',
    );

    assertCondition(
        MAX_OUTBOX_EVENT_NAME_LENGTH <=
        MAX_RAW_TEXT_CEILING,
        'Outbox event name length must not exceed raw text ceiling.',
    );

    assertCondition(
        MAX_OUTBOX_AGGREGATE_TYPE_LENGTH <=
        MAX_RAW_TEXT_CEILING,
        'Outbox aggregate type length must not exceed raw text ceiling.',
    );

    assertCondition(
        LEDGER_ENTRY_COUNT_MIN ===
        MIN_LEDGER_ENTRIES,
        'LEDGER_ENTRY_COUNT_MIN must derive from MIN_LEDGER_ENTRIES.',
    );

    assertCondition(
        LEDGER_ENTRY_COUNT_MAX ===
        MAX_LEDGER_ENTRIES,
        'LEDGER_ENTRY_COUNT_MAX must derive from MAX_LEDGER_ENTRIES.',
    );

    assertCondition(
        POSTING_PLAN_ENTRY_COUNT_MIN ===
        MIN_POSTING_PLAN_ENTRIES,
        'POSTING_PLAN_ENTRY_COUNT_MIN must derive from MIN_POSTING_PLAN_ENTRIES.',
    );

    assertCondition(
        POSTING_PLAN_ENTRY_COUNT_MAX ===
        MAX_POSTING_PLAN_ENTRIES,
        'POSTING_PLAN_ENTRY_COUNT_MAX must derive from MAX_POSTING_PLAN_ENTRIES.',
    );

    assertCondition(
        POSTING_PLAN_ORDINAL_MIN ===
        MIN_LEDGER_ENTRY_ORDINAL,
        'POSTING_PLAN_ORDINAL_MIN must derive from MIN_LEDGER_ENTRY_ORDINAL.',
    );

    assertCondition(
        POSTING_PLAN_ORDINAL_MAX ===
        MAX_LEDGER_ENTRY_ORDINAL,
        'POSTING_PLAN_ORDINAL_MAX must derive from MAX_LEDGER_ENTRY_ORDINAL.',
    );

    assertCondition(
        ACCUMULATED_OVERFLOW_SAFE_ENTRY_AMOUNT_MAX ===
        MAX_SINGLE_LEDGER_ENTRY_AMOUNT,
        'Accumulated overflow safe entry amount must derive from the single entry bound.',
    );

    assertCondition(
        MAX_SINGLE_POSTING_DELTA_MAGNITUDE ===
        MAX_SINGLE_LEDGER_ENTRY_AMOUNT,
        'MAX_SINGLE_POSTING_DELTA_MAGNITUDE must equal MAX_SINGLE_LEDGER_ENTRY_AMOUNT.',
    );

    assertCondition(
        MAX_NUMERIC_INPUT_TEXT_CEILING ===
        MAX_NUMERIC_RAW_TEXT_CEILING,
        'MAX_NUMERIC_INPUT_TEXT_CEILING must equal MAX_NUMERIC_RAW_TEXT_CEILING.',
    );

    assertCondition(
        Object.keys(FINANCIAL_LIMITS).length ===
        Object.keys(FINANCIAL_LIMIT_CATEGORIES).length,
        'FINANCIAL_LIMITS and FINANCIAL_LIMIT_CATEGORIES must be strictly bijective.',
    );
}

/**
 * Assertion interna sem dependência de framework.
 */
function assertCondition(
    condition: boolean,
    message: string,
): asserts condition {
    if (!condition) {
        throw new Error(
            `Finance Core FinancialLimits invariant violation: ${message}`,
        );
    }
}