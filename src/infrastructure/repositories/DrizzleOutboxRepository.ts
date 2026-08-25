import { IDomainEvent } from '../../shared/kernel/DomainEvent';
import { Result } from '../../shared/kernel/Result';
import { IOutboxRepository, OutboxEventRecord } from '../../application/ports/output/IOutboxRepository';
import { outboxEvents } from '../../db/infrastructure/tables';
import { eq, asc, and } from 'drizzle-orm';
import crypto from 'crypto';

export class DrizzleOutboxRepository implements IOutboxRepository {
  // Recebe a instância do banco OU da transação (tx) ativa no UnitOfWork
  constructor(private db: any) {}

  async saveEvent(event: IDomainEvent, aggregateId: number, aggregateType: string, aggregateVersion: number): Promise<Result<void>> {
    try {
      await this.db.insert(outboxEvents).values({
        id: crypto.randomUUID(),
        aggregateId,
        aggregateType,
        aggregateVersion,
        eventName: event.constructor.name,
        payload: JSON.stringify(event),
        metadata: JSON.stringify({ occurredOn: event.dateTimeOccurred }),
        attempts: 0,
        published: false,
        createdAt: new Date(),
      });
      return Result.ok();
    } catch (error: any) {
      return Result.fail(`Failed to save outbox event: ${error.message}`);
    }
  }

  async getPendingEvents(limit: number): Promise<Result<OutboxEventRecord[]>> {
    try {
      const pending = await this.db
        .select()
        .from(outboxEvents)
        .where(eq(outboxEvents.published, false))
        .orderBy(asc(outboxEvents.createdAt))
        .limit(limit);
        
      return Result.ok(pending);
    } catch (error: any) {
      return Result.fail(`Failed to fetch pending outbox events: ${error.message}`);
    }
  }

  async markAsPublished(eventId: string): Promise<Result<void>> {
    try {
      await this.db
        .update(outboxEvents)
        .set({
          published: true,
          publishedAt: new Date(),
        })
        .where(eq(outboxEvents.id, eventId));
      return Result.ok();
    } catch (error: any) {
      return Result.fail(`Failed to mark outbox event as published: ${error.message}`);
    }
  }

  async markAsFailed(eventId: string, error: string): Promise<Result<void>> {
    try {
      const event = await this.db.select().from(outboxEvents).where(eq(outboxEvents.id, eventId)).limit(1);
      if (!event || event.length === 0) return Result.fail('Event not found');

      await this.db
        .update(outboxEvents)
        .set({
          attempts: event[0].attempts + 1,
          error: error.substring(0, 500)
        })
        .where(eq(outboxEvents.id, eventId));
        
      return Result.ok();
    } catch (err: any) {
      return Result.fail(`Failed to mark outbox event as failed: ${err.message}`);
    }
  }
}

export class EventRepository {
  constructor(private db: any) {}
  async append(event: any): Promise<void> {}
}
