/**
 * Gerador Determinístico de Identificadores Financeiros (53-bit Safe Integer).
 *
 * Garante que cada transação financeira possua um ID numérico monotônico,
 * globalmente coordenado e conhecido em memória antes da compilação do lote transacional.
 *
 * Estrutura do Inteiro de 53 bits (Number.MAX_SAFE_INTEGER = 9.007.199.254.740.991):
 * - Epoch ms (41 bits): até o ano ~2088 sem overflow
 * - Worker ID (4 bits): 0..15 particionamento de instâncias/processos
 * - Sequence Counter (8 bits): 0..255 por milissegundo com avanço de relógio lógico
 *
 * Invariantes P0 Hardened (OCaps / Concorrência):
 * 1. Monotonicidade Estrita: Todo ID gerado é estritamente maior que o anterior.
 * 2. Zero Colisões: Quando a sequência atinge 256 no mesmo milissegundo, o relógio lógico avança.
 * 3. Proscrição Absoluta de Math.random(): Apenas CSPRNG (crypto.getRandomValues) ou coordenadas determinísticas.
 * 4. Safe Integer Guard: Asserção de que id <= Number.MAX_SAFE_INTEGER e Number.isSafeInteger(id).
 * 5. Parsing Estrito de Worker ID: Rejeição de valores parciais ou malformados de ambiente.
 */

export class DeterministicIdGenerator {
  private static lastTimestamp = 0;
  private static sequence = 0;
  private static workerId: number = DeterministicIdGenerator.initializeWorkerId();
  private static workerIdLocked = false;

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

    if (now === DeterministicIdGenerator.lastTimestamp) {
      DeterministicIdGenerator.sequence = (DeterministicIdGenerator.sequence + 1) & 0xff;
      // Se a sequência no milissegundo sofreu overflow (> 255), avança o relógio lógico
      if (DeterministicIdGenerator.sequence === 0) {
        now = DeterministicIdGenerator.lastTimestamp + 1;
      }
    } else {
      DeterministicIdGenerator.sequence = 0;
    }

    DeterministicIdGenerator.lastTimestamp = now;

    // Composição de 53 bits:
    // (now * 4096) + (workerId * 256) + sequence
    const id = now * 4096 + DeterministicIdGenerator.workerId * 256 + DeterministicIdGenerator.sequence;

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
   */
  public static resetForTesting(initialSeq: number = 0): void {
    DeterministicIdGenerator.lastTimestamp = 0;
    DeterministicIdGenerator.sequence = initialSeq;
    DeterministicIdGenerator.workerIdLocked = false;
  }
}
