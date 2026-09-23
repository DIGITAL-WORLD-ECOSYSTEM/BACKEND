/**
 * Gerador Determinístico de Identificadores Financeiros (53-bit Safe Integer).
 *
 * Garante que cada transação financeira possua um ID numérico conhecido
 * em memória antes da compilação do lote atômico físico (D1.batch / SQLite).
 *
 * Estrutura:
 * - Epoch ms (41 bits)
 * - Worker ID (4 bits: 0..9)
 * - Sequence Counter (8 bits: 0..99)
 *
 * Valor resultante (< 9.007.199.254.740.991) é estritamente garantido como
 * Number.isSafeInteger e compatível com SQLite 64-bit integer.
 */
export class DeterministicIdGenerator {
  private static sequence = 0;
  private static workerId = Math.floor(Math.random() * 10);

  public static nextTransactionId(): number {
    const now = Date.now();
    const seq = DeterministicIdGenerator.sequence++ % 100;
    const id = now * 1000 + DeterministicIdGenerator.workerId * 100 + seq;
    if (!Number.isSafeInteger(id)) {
      throw new Error(`ID gerado fora dos limites de inteiro seguro: ${id}`);
    }
    return id;
  }

  public static setWorkerId(id: number): void {
    if (id < 0 || id > 9 || !Number.isInteger(id)) {
      throw new Error(`workerId deve ser um inteiro entre 0 e 9: ${id}`);
    }
    DeterministicIdGenerator.workerId = id;
  }
}
