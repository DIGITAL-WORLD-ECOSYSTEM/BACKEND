import { IQueuePort } from '../../application/ports/output/IQueuePort';
import { Result } from '../../shared/kernel/Result';

export class CloudflareQueueAdapter implements IQueuePort {
  constructor(private readonly queue?: any) {}

  async dispatchPasswordReset(email: string, rawToken: string): Promise<Result<void>> {
    try {
      if (this.queue) {
        await this.queue.send({
          type: 'PASSWORD_RESET_REQUESTED',
          email,
          rawToken,
          timestamp: new Date().toISOString(),
        });
      }
      return Result.ok();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Falha ao despachar evento para a fila';
      return Result.fail(message);
    }
  }
}
