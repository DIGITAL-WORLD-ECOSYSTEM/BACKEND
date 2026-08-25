import { ISecurityAuditPort, SecurityAuditEvent } from '../../application/ports/output/ISecurityAuditPort';
import { TransactionContext } from '../../application/dto/TransactionContext';
import { securityEvents } from '../../db/security/tables';

/**
 * Adapter de Infraestrutura para Auditoria de Segurança.
 * Grava registros imutáveis em security_events utilizando o mesmo cliente
 * de transação Drizzle exposto através de TransactionContext.
 */
export class SecurityAuditAdapter implements ISecurityAuditPort {
  constructor(private readonly db: any) {}

  public async logEvent(event: SecurityAuditEvent, txCtx?: TransactionContext): Promise<void> {
    const executor = (txCtx?.nativeTx as any) || this.db;

    // Mapear eventos de alto nível para os enums de securityEvents
    const eventType =
      event.event === 'identity_linked'
        ? 'credential_created'
        : event.event === 'identity_unlinked'
        ? 'credential_revoked'
        : event.event === 'authentication_succeeded'
        ? 'authentication_succeeded'
        : 'authentication_failed';

    await executor.insert(securityEvents).values({
      id: crypto.randomUUID(),
      userId: event.userId,
      event: eventType,
      result: event.event.includes('failed') ? 'failure' : 'success',
      source: 'api',
      metadata: event.metadata,
      createdAt: event.timestamp || new Date(),
    });
  }
}
