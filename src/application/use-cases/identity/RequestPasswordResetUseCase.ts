import { IUnitOfWork } from '../../../application/ports/output/IUnitOfWork';
import { ISecurityAuditPort } from '../../../application/ports/output/ISecurityAuditPort';
import { Result } from '../../../shared/kernel/Result';
import { RequestPasswordResetDTO } from '../../../application/dto/identity/RequestPasswordResetDTO';
import { IDomainEvent } from '../../../shared/kernel/DomainEvent';
import { IQueuePort } from '../../../application/ports/output/IQueuePort';

export class PasswordResetRequestedEvent implements IDomainEvent {
  dateTimeOccurred: Date = new Date();
  constructor(
    public readonly userId: number,
    public readonly email: string
    // rawToken removido por segurança (FASE 5)
  ) {}

  getAggregateId(): string {
    return String(this.userId);
  }
}

export class RequestPasswordResetUseCase {
  constructor(
    private readonly uow: IUnitOfWork,
    private readonly queuePort: IQueuePort,
    private readonly auditPort?: ISecurityAuditPort
  ) {}

  async execute(dto: RequestPasswordResetDTO): Promise<Result<void>> {
    if (!dto.email) {
      return Result.fail<void>('E-mail é obrigatório.');
    }

    const normalizedEmail = dto.email.trim().toLowerCase();

    // Use variable to extract rawToken out of the UoW closure
    let generatedRawToken: string | null = null;

    await this.uow.execute(async (factory) => {
      const userRepo = factory.getUserRepository();
      const resetRepo = factory.getPasswordResetRepository();
      const outboxRepo = factory.getOutboxRepository();

      const user = await userRepo.findByEmail(normalizedEmail);
      if (!user) {
        // Anti-user enumeration: Return success even if user not found
        // But do not generate a token.
        return Result.ok();
      }

      // Generate secure random token
      const rawTokenBytes = new Uint8Array(32);
      if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
        crypto.getRandomValues(rawTokenBytes);
      } else {
        for (let i = 0; i < 32; i++) rawTokenBytes[i] = Math.floor(Math.random() * 256);
      }
      const rawToken = Array.from(rawTokenBytes).map(b => b.toString(16).padStart(2, '0')).join('');
      generatedRawToken = rawToken;

      // Create token hash for DB storage
      const tokenHashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rawToken));
      const tokenHash = Array.from(new Uint8Array(tokenHashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');

      const expiresAt = new Date(Date.now() + 3600 * 1000); // 1 hour expiration

      await resetRepo.create({
        userId: user.id,
        tokenHash,
        expiresAt,
      });

      // Salva evento de auditoria no Outbox SEM o rawToken
      const event = new PasswordResetRequestedEvent(user.id, user.email || '');
      await outboxRepo.saveEvent(event, user.id, 'User', 1);

      if (this.auditPort) {
        await this.auditPort.logEvent({
          event: 'password_reset_requested',
          userId: user.id,
          metadata: { email: user.email },
        });
      }

      return Result.ok();
    });

    if (generatedRawToken) {
      await this.queuePort.dispatchPasswordReset(normalizedEmail, generatedRawToken);
    }

    // Retorna void em vez de vazar o rawToken!
    return Result.ok();
  }
}

