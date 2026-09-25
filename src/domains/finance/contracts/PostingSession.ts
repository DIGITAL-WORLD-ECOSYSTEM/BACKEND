/**
 * Capability de Sessão de Postagem Financeira (PostingSession).
 *
 * Representa a autoridade não-forjável para executar exatamente um lote
 * de mutação contábil dentro da fronteira transacional física.
 *
 * Em conformidade com o princípio de Object-Capability (OCaps - P0-01, P0-19, P0-B):
 * 1. O estado de consumo é protegido em escopo estritamente privado de módulo (WeakSet).
 * 2. A sessão é vinculada à instância física da fronteira de execução (boundaryRef / db) e seu identificador (boundaryId).
 * 3. A sessão é de uso estritamente único (single-use: markConsumed / tryConsume com semântica atômica).
 * 4. Imutabilidade absoluta em runtime via Object.freeze(this).
 * 5. Proscrição total de Math.random(): aleatoriedade criptograficamente segura via CSPRNG do runtime.
 */

export type PostingExecutionMode = 'd1-batch' | 'sqlite-transaction';

/**
 * Registros soberanos em escopo de módulo (inacessíveis por código externo).
 */
const VALID_POSTING_SESSIONS = new WeakSet<PostingSession>();
const CONSUMED_POSTING_SESSIONS = new WeakSet<PostingSession>();

export class PostingSession {
  public readonly mode: PostingExecutionMode;
  public readonly sessionId: string;
  public readonly boundaryId: string;
  public readonly boundaryRef: object;
  public readonly createdAtEpochMs: number;

  /**
   * Construtor soberano: exige referência legítima da fronteira transacional,
   * identificadores não-vazios e validação de modo de despacho.
   */
  public constructor(
    boundaryRef: object,
    mode: PostingExecutionMode,
    boundaryId: string
  ) {
    if (!boundaryRef || (typeof boundaryRef !== 'object' && typeof boundaryRef !== 'function')) {
      throw new Error('PostingSession exige uma referência física de fronteira transacional válida.');
    }
    if (mode !== 'd1-batch' && mode !== 'sqlite-transaction') {
      throw new Error(`Modo de execução inválido para PostingSession: ${mode}`);
    }
    if (!boundaryId || typeof boundaryId !== 'string' || boundaryId.trim().length === 0) {
      throw new Error('Identificador de fronteira física não-vazio obrigatório para PostingSession.');
    }

    this.mode = mode;
    this.boundaryId = boundaryId.trim();
    this.boundaryRef = boundaryRef;
    this.createdAtEpochMs = Date.now();

    // Geração de ID com CSPRNG estrito (sem Math.random())
    this.sessionId = PostingSession.generateSecureSessionId();

    // Registra a sessão como válida e congela a instância contra adulteração externa
    VALID_POSTING_SESSIONS.add(this);
    Object.freeze(this);
  }

  /**
   * Emissor seguro de ID de sessão com CSPRNG do runtime.
   * Lança erro explícito (fail-closed) se o ambiente não possuir suporte criptográfico seguro.
   */
  private static generateSecureSessionId(): string {
    if (typeof crypto !== 'undefined') {
      if (typeof crypto.randomUUID === 'function') {
        return `ps_${crypto.randomUUID()}`;
      }
      if (typeof crypto.getRandomValues === 'function') {
        const buffer = new Uint8Array(16);
        crypto.getRandomValues(buffer);
        const hex = Array.from(buffer, (b) => b.toString(16).padStart(2, '0')).join('');
        return `ps_${hex}`;
      }
    }
    throw new Error('Ambiente inseguro: CSPRNG indisponível para geração segura de PostingSession.');
  }

  /**
   * Getter imutável para retrocompatibilidade com chamadores legados.
   * Retorna sempre uma nova instância de Date para evitar mutação do estado interno via .setTime().
   */
  public get createdAt(): Date {
    return new Date(this.createdAtEpochMs);
  }

  /**
   * Valida em runtime se esta instância foi criada legitimamente pela fronteira,
   * retém a autoridade e ainda não foi consumida (invariante de uso único).
   */
  public isValid(): boolean {
    return (
      VALID_POSTING_SESSIONS.has(this) &&
      !CONSUMED_POSTING_SESSIONS.has(this) &&
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
   * Tenta adquirir e consumir a sessão de forma atômica.
   * Retorna true se a sessão estava válida e foi consumida com sucesso;
   * retorna false se já havia sido consumida ou não pertencia ao registro autêntico.
   */
  public tryConsume(): boolean {
    if (!this.isValid()) {
      return false;
    }
    CONSUMED_POSTING_SESSIONS.add(this);
    return true;
  }

  /**
   * Marca a sessão como consumida após a execução bem-sucedida do lote físico.
   * Operação irreversível que invalida permanentemente a sessão.
   */
  public markConsumed(): void {
    CONSUMED_POSTING_SESSIONS.add(this);
  }

  /**
   * Consulta se a sessão já foi consumida.
   */
  public isConsumed(): boolean {
    return CONSUMED_POSTING_SESSIONS.has(this);
  }
}
