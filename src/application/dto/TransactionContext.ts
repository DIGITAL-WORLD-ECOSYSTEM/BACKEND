/**
 * Abstração de Contexto Transacional no Application Layer.
 * Permite que Use Cases repassem o contexto transacional para repositórios
 * e portas de observabilidade/auditoria sem vazar dependências concretas do Drizzle/D1.
 */
export interface TransactionContext {
  readonly transactionId: string;
  readonly isScoped: true;
  readonly nativeTx?: unknown;
}
