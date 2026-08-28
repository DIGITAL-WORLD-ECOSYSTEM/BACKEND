import { IDomainEvent } from '../../../shared/kernel/DomainEvent';
import { Result } from '../../../shared/kernel/Result';

export interface OutboxEventRecord {
  id: string; // UUID
  aggregateId: string | number;
  aggregateType: string;
  aggregateVersion: number;
  eventName: string;
  payload: string; // JSON
  metadata?: string | null; // JSON
  attempts: number;
  status: 'pending' | 'processing' | 'published' | 'failed' | 'dead_letter';
  publishedAt?: Date | null;
  leaseOwner?: string | null;
  leaseGeneration?: number;
  leaseExpiresAt?: Date | null;
  error?: string | null;
  createdAt: Date;
}

export interface IOutboxRepository {
  /**
   * Persiste um evento de domínio no Outbox (UoW transactional context).
   */
  saveEvent(
    event: IDomainEvent,
    aggregateId: number | string,
    aggregateType: string,
    aggregateVersion: number
  ): Promise<Result<void>>;

  /**
   * Adquire um lease atômico (CAS com fencing token leaseGeneration) para eventos pendentes/expirados.
   */
  claimPendingLease(
    ownerId: string,
    leaseDurationMs?: number,
    limit?: number
  ): Promise<Result<OutboxEventRecord[]>>;

  /**
   * Renova o lease de um evento em processamento se a geração do token corresponder.
   */
  renewLease?(
    ownerId: string,
    eventId: string,
    currentGeneration: number,
    durationMs?: number
  ): Promise<Result<boolean>>;

  /**
   * Registra a recepção idempotente do consumidor via event_consumer_receipts.
   */
  recordConsumerReceipt(consumerId: string, eventId: string): Promise<Result<boolean>>;
}
