import { IDomainEvent } from '../../shared/kernel/DomainEvent';
import { Result } from '../../shared/kernel/Result';
import { IOutboxRepository, OutboxEventRecord } from '../../application/ports/output/IOutboxRepository';
import { outboxEvents } from '../../db/infrastructure/tables';
import { eq, asc, sql } from 'drizzle-orm';

export class DrizzleOutboxRepository implements IOutboxRepository {
  // Recebe a instância do banco OU da transação (tx) ativa no UnitOfWork
  constructor(private db: any) {}

  async saveEvent(event: IDomainEvent, aggregateId: number, aggregateType: string, aggregateVersion: number): Promise<Result<void>> {
    try {
      const eventId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2);
      await this.db.insert(outboxEvents).values({
        id: eventId,
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
      const result = await this.db
        .update(outboxEvents)
        .set({
          attempts: sql`${outboxEvents.attempts} + 1`,
          error: error.substring(0, 500)
        })
        .where(eq(outboxEvents.id, eventId))
        .returning();
        
      if (!result || result.length === 0) {
        return Result.fail('Event not found');
      }

      return Result.ok();
    } catch (err: any) {
      return Result.fail(`Failed to mark outbox event as failed: ${err.message}`);
    }
  }
}

