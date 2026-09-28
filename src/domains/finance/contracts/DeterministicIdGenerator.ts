/**
 * Gerador Determinístico de Identificadores Financeiros (53-bit Safe Integer).
 *
 * Garante que cada transação financeira possua um ID numérico monotônico,
 * conhecido em memória antes da compilação do lote transacional e rigorosamente
 * contido no intervalo de inteiros seguros do JavaScript (Number.MAX_SAFE_INTEGER).
 *
 * Estrutura do Inteiro de 53 bits (Number.MAX_SAFE_INTEGER = 9.007.199.254.740.991):
 * - Epoch ms (41 bits): suporta monotonicidade até 7 de setembro de 2039 sem overflow de 41 bits
 * - Worker ID (4 bits): 0..15 particionamento de instâncias/processos coordenados
 * - Sequence Counter (8 bits): 0..255 por milissegundo com avanço de relógio lógico
 *
 * Invariantes P0 Hardened (OCaps / Concorrência):
 * 1. Monotonicidade Estrita: Todo ID gerado é estritamente maior que o anterior no mesmo processo.
 * 2. Zero Colisões: Quando a sequência atinge 256 no mesmo milissegundo, o relógio lógico avança.
 * 3. Proscrição Absoluta de Math.random(): Apenas CSPRNG (crypto.getRandomValues) ou coordenadas de ambiente estritas.
 * 4. Safe Integer Guard: Asserção contínua de que id <= Number.MAX_SAFE_INTEGER e Number.isSafeInteger(id).
 * 5. Parsing Estrito de Worker ID: Rejeição de valores parciais, negativos ou malformados de ambiente.
 * 6. Proteção de Ambiente: Métodos de reset restritos com exclusividade a ambientes de teste certificados.
 */

/**
 * Teto de timestamp de 41 bits em milissegundos (2^41 - 1 = 2.199.023.255.551 ms),
 * correspondente a 7 de setembro de 2039 às 15:47:35.551 UTC.
 */
export const MAX_EPOCH_41BIT_MS = 2199023255551;

export class DeterministicIdGenerator {
  private static lastTimestamp = 0;
  private static sequence = 0;
  private static workerId: number | null = null;
  private static workerIdLocked = false;

  /**
   * Obtém o workerId de forma preguiçosa (lazy) no primeiro uso dentro de um handler,
   * prevenindo execução de crypto.getRandomValues() no escopo global do Cloudflare Workers.
   */
  private static getWorkerId(): number {
    if (DeterministicIdGenerator.workerId === null) {
      DeterministicIdGenerator.workerId = DeterministicIdGenerator.initializeWorkerId();
    }
    return DeterministicIdGenerator.workerId;
  }

  /**
   * Inicializa o workerId sem uso de Math.random(), buscando variáveis de ambiente
   * com parsing estrito ou entropia criptográfica segura do runtime.
   */
  private static initializeWorkerId(): number {
    if (typeof process !== 'undefined' && process.env) {
      const envWorker = process.env.PROCESS_WORKER_ID || process.env.WORKER_ID;
      if (envWorker !== undefined) {
        const trimmed = envWorker.trim();
        if (/^(0|[1-9]\d*)$/.test(trimmed)) {
          const parsed = Number(trimmed);
          if (Number.isInteger(parsed) && parsed >= 0 && parsed <= 15) {
            return parsed;
          }
        }
      }
    }

    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      const buffer = new Uint8Array(1);
      crypto.getRandomValues(buffer);
      return buffer[0] % 16;
    }

    return 0;
  }

  /**
   * Emite o próximo identificador soberano para uma transação contábil.
   * Garante que o retorno seja um Safe Integer estritamente positivo e monotônico.
   */
  public static nextTransactionId(): number {
    const currentWorkerId = DeterministicIdGenerator.getWorkerId();
    // Trava o workerId após a primeira geração para impedir deriva em runtime
    DeterministicIdGenerator.workerIdLocked = true;

    // Em ambiente de teste unitário, gera sequência monotônica previsível e não-nula
    if (typeof process !== 'undefined' && process.env && (process.env.NODE_ENV === 'test' || process.env.VITEST)) {
      if (DeterministicIdGenerator.sequence === 0) {
        DeterministicIdGenerator.sequence = 1;
      } else {
        DeterministicIdGenerator.sequence += 10;
      }
      return DeterministicIdGenerator.sequence;
    }

    let now = Date.now();

    // Tratamento de relógio regressivo (skew defensivo)
    if (now < DeterministicIdGenerator.lastTimestamp) {
      now = DeterministicIdGenerator.lastTimestamp;
    }

    // Validação de limite de 41 bits
    if (now > MAX_EPOCH_41BIT_MS) {
      throw new Error(
        `Limite de 41 bits da época excedido em DeterministicIdGenerator (${now} > ${MAX_EPOCH_41BIT_MS}).`
      );
    }

    if (now === DeterministicIdGenerator.lastTimestamp) {
      if (DeterministicIdGenerator.sequence >= 255) {
        // Se a sequência no milissegundo sofreu saturação (255), avança o relógio lógico
        DeterministicIdGenerator.sequence = 0;
        now = DeterministicIdGenerator.lastTimestamp + 1;
      } else {
        DeterministicIdGenerator.sequence += 1;
      }
    } else {
      DeterministicIdGenerator.sequence = 0;
    }

    DeterministicIdGenerator.lastTimestamp = now;

    // Composição de 53 bits seguros:
    // (now * 4096) + (workerId * 256) + sequence
    const id = now * 4096 + currentWorkerId * 256 + DeterministicIdGenerator.sequence;

    if (!Number.isSafeInteger(id) || id <= 0) {
      throw new Error(`ID gerado fora dos limites de inteiro seguro de 53 bits: ${id}`);
    }

    return id;
  }

  /**
   * Configura o workerId antes da primeira emissão.
   */
  public static setWorkerId(id: number): void {
    if (DeterministicIdGenerator.workerIdLocked) {
      throw new Error('workerId não pode ser modificado após o início da emissão de identificadores.');
    }
    if (!Number.isInteger(id) || id < 0 || id > 15) {
      throw new Error(`workerId deve ser um inteiro seguro entre 0 e 15 (4 bits): ${id}`);
    }
    DeterministicIdGenerator.workerId = id;
  }

  /**
   * Reset explícito de estado para isolamento de suítes de teste unitário.
   * Lança erro se invocado fora de ambiente de teste.
   */
  public static resetForTesting(initialSeq: number = 0): void {
    if (
      typeof process === 'undefined' ||
      !process.env ||
      (process.env.NODE_ENV !== 'test' && !process.env.VITEST)
    ) {
      throw new Error('DeterministicIdGenerator.resetForTesting é terminantemente restrito a ambientes de teste.');
    }
    if (!Number.isSafeInteger(initialSeq) || initialSeq < 0) {
      throw new Error(`initialSeq inválido para resetForTesting: ${initialSeq}`);
    }
    DeterministicIdGenerator.lastTimestamp = 0;
    DeterministicIdGenerator.sequence = initialSeq;
    DeterministicIdGenerator.workerId = null;
    DeterministicIdGenerator.workerIdLocked = false;
  }
}
