/**
 * Capability de Sessão de Postagem Financeira (PostingSession).
 *
 * Representa a autoridade não-forjável para executar exatamente um lote
 * de mutação contábil dentro da fronteira transacional física (D1.batch / SQLite tx).
 *
 * O construtor é protegido pelo PostingCapabilityToken: a camada de aplicação
 * não pode instanciar esta classe diretamente via `new PostingSession()`.
 */

export const PostingCapabilityToken: unique symbol = Symbol('PostingCapabilityToken');

export type PostingExecutionMode = 'd1-batch' | 'sqlite-transaction';

export class PostingSession {
  private readonly _token: typeof PostingCapabilityToken;
  public readonly mode: PostingExecutionMode;
  public readonly sessionId: string;
  public readonly createdAt: Date;

  private constructor(
    token: typeof PostingCapabilityToken,
    mode: PostingExecutionMode,
    sessionId: string
  ) {
    this._token = token;
    this.mode = mode;
    this.sessionId = sessionId;
    this.createdAt = new Date();
  }

  /**
   * Valida em runtime se esta instância foi criada por uma autoridade soberana legítima
   * que detém o PostingCapabilityToken inviolável.
   */
  public isValid(): boolean {
    return (
      this._token === PostingCapabilityToken &&
      typeof this.sessionId === 'string' &&
      this.sessionId.length > 0 &&
      (this.mode === 'd1-batch' || this.mode === 'sqlite-transaction')
    );
  }

  /**
   * Fábrica soberana restrita à Unit of Work / PostingExecutionBoundary.
   */
  public static createAuthorizedSession(
    token: typeof PostingCapabilityToken,
    mode: PostingExecutionMode,
    sessionId: string
  ): PostingSession {
    if (token !== PostingCapabilityToken) {
      throw new Error('Tentativa ilegal de forjar PostingSession sem capability token legítima.');
    }
    if (!sessionId || typeof sessionId !== 'string') {
      throw new Error('SessionId inválido para criação de PostingSession.');
    }
    if (mode !== 'd1-batch' && mode !== 'sqlite-transaction') {
      throw new Error(`Modo de execução inválido para PostingSession: ${mode}`);
    }
    return new PostingSession(token, mode, sessionId);
  }
}

