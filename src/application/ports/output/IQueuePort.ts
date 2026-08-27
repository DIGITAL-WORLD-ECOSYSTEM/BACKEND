import { Result } from '../../../shared/kernel/Result';

/**
 * Interface abstrata para abstrair a mensageria e o enfileiramento (ex: Cloudflare Queues).
 * A implementação real injetada cuidará da segurança criptográfica (ex: AES-GCM) 
 * para garantir que dados sensíveis não transitem em texto plano nas filas.
 */
export interface IQueuePort {
  /**
   * Enfileira uma solicitação de redefinição de senha criptografando o token.
   * O UseCase não precisa conhecer detalhes de criptografia, apenas fornece o dado puro.
   */
  dispatchPasswordReset(email: string, rawToken: string): Promise<Result<void>>;
}
