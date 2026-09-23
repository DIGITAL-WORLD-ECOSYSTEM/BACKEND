/**
 * Capability de Sessão de Postagem Financeira (PostingSession).
 *
 * Representa a autoridade não-forjável para executar exatamente um lote
 * de mutação contábil dentro da fronteira transacional física (D1.batch / SQLite tx).
 *
 * O construtor é privado e protegido por símbolo de módulo: a camada de aplicação
 * não pode instanciar esta classe diretamente via `new PostingSession()`.
 */

export const PostingCapabilityToken: unique symbol = Symbol('PostingCapabilityToken');

export type PostingExecutionMode = 'd1-batch' | 'sqlite-transaction';

export class PostingSession {
  private constructor(
    private readonly _token: typeof PostingCapabilityToken,
    public readonly mode: PostingExecutionMode,
    public readonly sessionId: string
  ) {}

  /**
   * Fábrica soberana restrita à Unit of Work / PostingExecutionBoundary.
   */
  public static createAuthorizedSession(
    token: typeof PostingCapabilityToken,
    mode: PostingExecutionMode,
    sessionId: string
  ): PostingSession {
    if (token !== PostingCapabilityToken) {
      throw new Error('Tentativa ilegal de forjar PostingSession sem capability token.');
    }
    return new PostingSession(token, mode, sessionId);
  }
}
