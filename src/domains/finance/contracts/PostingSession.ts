/**
 * Capability de Sessão de Postagem Financeira (PostingSession).
 *
 * Representa a autoridade não-forjável para executar exatamente um lote
 * de mutação contábil dentro da fronteira transacional física (D1.batch / SQLite tx).
 *
 * Em conformidade com o princípio de Object-Capability (P0-01, P0-19, P0-B):
 * 1. O token interno é estritamente privado ao módulo (não-exportado).
 * 2. A sessão é vinculada à instância física da fronteira de execução (boundaryRef / db) e seu identificador (boundaryId).
 * 3. A sessão é de uso estritamente único (single-use: markConsumed).
 * 4. Eliminação de tokens públicos (PostingCapabilityToken) e fábricas públicas estáticas
 *    para impedir forja de autoridade por chamadores externos.
 */

const InternalBoundaryToken: unique symbol = Symbol('InternalBoundaryToken');

export type PostingExecutionMode = 'd1-batch' | 'sqlite-transaction';

export class PostingSession {
  private readonly _token: typeof InternalBoundaryToken;
  public readonly mode: PostingExecutionMode;
  public readonly sessionId: string;
  public readonly boundaryId: string;
  public readonly boundaryRef: object;
  public readonly createdAt: Date;
  private _consumed: boolean = false;

  /**
   * Construtor protegido: exige uma referência física legítima da infraestrutura
   * (instância do banco / driver) e identificadores de fronteira.
   */
  public constructor(
    boundaryRef: object,
    mode: PostingExecutionMode,
    boundaryId: string
  ) {
    if (!boundaryRef || (typeof boundaryRef !== 'object' && typeof boundaryRef !== 'function')) {
      throw new Error('PostingSession exige uma referência física de infraestrutura (banco) válida.');
    }
    if (mode !== 'd1-batch' && mode !== 'sqlite-transaction') {
      throw new Error(`Modo de execução inválido para PostingSession: ${mode}`);
    }
    if (!boundaryId || typeof boundaryId !== 'string') {
      throw new Error('Identificador de fronteira física obrigatório para PostingSession.');
    }

    this._token = InternalBoundaryToken;
    this.mode = mode;
    this.boundaryId = boundaryId;
    this.boundaryRef = boundaryRef;
    this.sessionId = `ps_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    this.createdAt = new Date();
  }

  /**
   * Valida em runtime se esta instância foi criada legitimamente pela fronteira,
   * retém a autoridade e ainda não foi consumida (invariante de uso único).
   */
  public isValid(): boolean {
    return (
      this._token === InternalBoundaryToken &&
      !this._consumed &&
      typeof this.sessionId === 'string' &&
      this.sessionId.length > 0 &&
      typeof this.boundaryId === 'string' &&
      this.boundaryId.length > 0 &&
      this.boundaryRef !== null &&
      (typeof this.boundaryRef === 'object' || typeof this.boundaryRef === 'function') &&
      (this.mode === 'd1-batch' || this.mode === 'sqlite-transaction')
    );
  }

  /**
   * Marca a sessão como consumida após a execução bem-sucedida do lote físico.
   */
  public markConsumed(): void {
    this._consumed = true;
  }
}
