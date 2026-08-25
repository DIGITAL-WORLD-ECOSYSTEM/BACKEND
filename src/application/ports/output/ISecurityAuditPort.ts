import { TransactionContext } from '../../dto/TransactionContext';

export interface SecurityAuditEvent {
  readonly event:
    | 'identity_linked'
    | 'identity_unlinked'
    | 'identity_login_failed'
    | 'identity_resolution_failed'
    | 'authentication_succeeded'
    | 'authentication_failed'
    | 'account_created'
    | 'totp_verification_failed'
    | 'totp_verification_succeeded'
    | 'password_reset_requested'
    | 'password_reset_confirmed'
    | 'refresh_token_reuse_detected';
  readonly userId?: number;
  readonly metadata: Record<string, unknown>;
  readonly timestamp?: Date;
}

/**
 * Porta de Saída de Auditoria de Segurança.
 * Desacopla Use Cases da tabela security_events e aceita TransactionContext
 * para garantir execução na mesma transação atômica D1/Drizzle.
 */
export interface ISecurityAuditPort {
  logEvent(event: SecurityAuditEvent, txCtx?: TransactionContext): Promise<void>;
}
