/**
 * Capability de Sessão de Postagem Financeira (PostingSession).
 *
 * Representa a autoridade não-forjável para executar exatamente um lote
 * de mutação contábil dentro da fronteira transacional física (D1.batch / SQLite tx).
 *
 * Em conformidade com o princípio de Object-Capability (P0-01, P0-19):
 * 1. O token interno é estritamente privado ao módulo (não-exportado).
 * 2. A sessão é vinculada à fronteira de execução (boundaryId).
 * 3. A sessão é de uso estritamente único (single-use: markConsumed).
 */

const InternalPostingCapabilityToken: unique symbol = Symbol('InternalPostingCapabilityToken');

/**
 * Token de autoridade para testes e fronteiras especializadas que necessitam criar PostingSession.
 */
export const PostingCapabilityToken: unique symbol = Symbol('PostingCapabilityToken');

export type PostingExecutionMode = 'd1-batch' | 'sqlite-transaction';

export class PostingSession {
  private readonly _token: typeof InternalPostingCapabilityToken;
  public readonly mode: PostingExecutionMode;
  public readonly sessionId: string;
  public readonly boundaryId: string;
  public readonly createdAt: Date;
  private _consumed: boolean = false;

  private constructor(
    token: typeof InternalPostingCapabilityToken,
    mode: PostingExecutionMode,
    sessionId: string,
    boundaryId: string
  ) {
    this._token = token;
    this.mode = mode;
    this.sessionId = sessionId;
    this.boundaryId = boundaryId;
    this.createdAt = new Date();
  }

  /**
   * Método de compatibilidade para criação autorizada por portadores do capability token.
   */
  public static createAuthorizedSession(
    token: unknown,
    mode: PostingExecutionMode,
    sessionId: string,
    boundaryId: string = 'authorized-boundary'
  ): PostingSession {
    if (token !== PostingCapabilityToken && token !== InternalPostingCapabilityToken) {
      throw new Error('Token de capability inválido para criar PostingSession.');
    }
    return new PostingSession(InternalPostingCapabilityToken, mode, sessionId, boundaryId);
  }

  /**
   * Valida em runtime se esta instância foi criada legitimamente pela fronteira
   * e ainda não foi consumida (invariante de uso único).
   */
  public isValid(): boolean {
    return (
      this._token === InternalPostingCapabilityToken &&
      !this._consumed &&
      typeof this.sessionId === 'string' &&
      this.sessionId.length > 0 &&
      typeof this.boundaryId === 'string' &&
      this.boundaryId.length > 0 &&
      (this.mode === 'd1-batch' || this.mode === 'sqlite-transaction')
    );
  }

  /**
   * Marca a sessão como consumida após a execução bem-sucedida do lote físico.
   */
  public markConsumed(): void {
    this._consumed = true;
  }

  /**
   * @internal Fábrica de emissão exclusiva da fronteira transacional física (Unit of Work).
   */
  public static _mintFromBoundary(
    mode: PostingExecutionMode,
    boundaryId: string
  ): PostingSession {
    if (!boundaryId || typeof boundaryId !== 'string') {
      throw new Error('Identificador de fronteira física obrigatório para emitir PostingSession.');
    }
    if (mode !== 'd1-batch' && mode !== 'sqlite-transaction') {
      throw new Error(`Modo de execução inválido para PostingSession: ${mode}`);
    }
    const sessionId = `ps_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    return new PostingSession(InternalPostingCapabilityToken, mode, sessionId, boundaryId);
  }
}

/**
 * Função de emissão restrita à fronteira transacional da infraestrutura (Unit of Work / Repository).
 */
export function issueBoundaryPostingSession(
  mode: PostingExecutionMode,
  boundaryId: string
): PostingSession {
  return PostingSession._mintFromBoundary(mode, boundaryId);
}
