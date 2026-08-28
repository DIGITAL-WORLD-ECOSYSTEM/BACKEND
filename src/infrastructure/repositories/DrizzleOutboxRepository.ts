import { IDomainEvent } from '../../shared/kernel/DomainEvent';
import { Result } from '../../shared/kernel/Result';
import { IOutboxRepository, OutboxEventRecord } from '../../application/ports/output/IOutboxRepository';
import { outboxEvents } from '../../db/infrastructure/tables';
import { eq, and, inArray, asc, sql } from 'drizzle-orm';

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

  async claimPendingLease(
    ownerId: string,
    leaseDurationMs: number = 30000,
    limit: number = 10
  ): Promise<Result<OutboxEventRecord[]>> {
    try {
      const now = new Date();
      const leaseExpiresAt = new Date(now.getTime() + leaseDurationMs);

      // Select candidate unpublished events whose lease is expired or free
      const candidates = await this.db
        .select()
        .from(outboxEvents)
        .where(
          and(
            eq(outboxEvents.published, false),
            sql`(${outboxEvents.leaseExpiresAt} IS NULL OR ${outboxEvents.leaseExpiresAt} < ${now})`
          )
        )
        .orderBy(asc(outboxEvents.createdAt))
        .limit(limit);

      if (candidates.length === 0) {
        return Result.ok([]);
      }

      const claimedIds = candidates.map((c: any) => c.id);

      // Claim lease for selected events atomically
      await this.db
        .update(outboxEvents)
        .set({
          leaseOwner: ownerId,
          leaseExpiresAt,
        })
        .where(
          and(
            inArray(outboxEvents.id, claimedIds),
            eq(outboxEvents.published, false)
          )
        );

      return Result.ok(candidates);
    } catch (error: any) {
      return Result.fail(`Failed to claim outbox lease: ${error.message}`);
    }
  }

  async recordConsumerReceipt(consumerId: string, eventId: string): Promise<Result<boolean>> {
    try {
      const { eventConsumerReceipts } = await import('../../db/infrastructure/tables');
      const id = `${consumerId}:${eventId}`;
      await this.db.insert(eventConsumerReceipts).values({
        id,
        consumerId,
        eventId,
        processedAt: new Date(),
      });
      return Result.ok(true);
    } catch (error: any) {
      if (error.message && (error.message.includes('UNIQUE') || error.message.includes('unique'))) {
        return Result.ok(false); // Already processed by consumer!
      }
      return Result.fail(`Failed to record consumer receipt: ${error.message}`);
    }
  }
}

