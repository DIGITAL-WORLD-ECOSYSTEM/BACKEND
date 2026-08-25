import { IDomainEvent } from '../../../shared/kernel/DomainEvent';
import { Result } from '../../../shared/kernel/Result';

export interface OutboxEventRecord {
  id: string; // UUID
  aggregateId: number;
  aggregateType: string;
  aggregateVersion: number;
  eventName: string;
  payload: string; // JSON
  metadata?: string; // JSON
  attempts: number;
  published: boolean;
  publishedAt?: Date;
  error?: string;
  createdAt: Date;
}

export interface IOutboxRepository {
  /**
   * Persiste um evento de domínio no Outbox.
   * IMPORTANTE: Deve ser chamado dentro da mesma transação do banco (UoW).
   */
  saveEvent(event: IDomainEvent, aggregateId: number, aggregateType: string, aggregateVersion: number): Promise<Result<void>>;
  
  /**
   * Busca eventos pendentes para publicação (published = false) limitando a quantidade.
   */
  getPendingEvents(limit: number): Promise<Result<OutboxEventRecord[]>>;
  
  /**
   * Marca um evento como publicado (sucesso).
   */
  markAsPublished(eventId: string): Promise<Result<void>>;
  
  /**
   * Registra uma falha de tentativa de publicação. Incrementa attempts e salva o erro.
   */
  markAsFailed(eventId: string, error: string): Promise<Result<void>>;
}
