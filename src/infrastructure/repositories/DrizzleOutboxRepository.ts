import { IDomainEvent } from '../../shared/kernel/DomainEvent';
import { Result } from '../../shared/kernel/Result';
import { IOutboxRepository, OutboxEventRecord } from '../../application/ports/output/IOutboxRepository';
import { outboxEvents, eventConsumerReceipts } from '../../db/infrastructure/tables';
import { eq, and, inArray, asc, sql } from 'drizzle-orm';

export class DrizzleOutboxRepository implements IOutboxRepository {
  constructor(private db: any) {}

  async saveEvent(event: IDomainEvent, aggregateId: number, aggregateType: string, aggregateVersion: number): Promise<Result<void>> {
    try {
      const eventId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2);
      await this.db.insert(outboxEvents).values({
        id: eventId,
        aggregateId: String(aggregateId),
        aggregateType,
        aggregateVersion,
        eventName: event.constructor.name,
        payload: JSON.stringify(event),
        metadata: JSON.stringify({ occurredOn: event.dateTimeOccurred }),
        attempts: 0,
        status: 'pending',
        leaseGeneration: 0,
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

      // Select candidate events that are pending/failed or whose lease is expired
      const candidates = await this.db
        .select()
        .from(outboxEvents)
        .where(
          and(
            sql`${outboxEvents.status} IN ('pending', 'failed', 'processing')`,
            sql`(${outboxEvents.leaseExpiresAt} IS NULL OR ${outboxEvents.leaseExpiresAt} < ${now})`
          )
        )
        .orderBy(asc(outboxEvents.createdAt))
        .limit(limit);

      if (candidates.length === 0) {
        return Result.ok([]);
      }

      const claimedEvents: OutboxEventRecord[] = [];

      for (const candidate of candidates) {
        const nextGen = (candidate.leaseGeneration ?? 0) + 1;
        const res = await this.db
          .update(outboxEvents)
          .set({
            leaseOwner: ownerId,
            leaseGeneration: nextGen,
            leaseExpiresAt,
            status: 'processing',
          })
          .where(
            and(
              eq(outboxEvents.id, candidate.id),
              eq(outboxEvents.leaseGeneration, candidate.leaseGeneration ?? 0),
              sql`(${outboxEvents.leaseExpiresAt} IS NULL OR ${outboxEvents.leaseExpiresAt} < ${now})`
            )
          );

        const affected = (res?.meta?.changes ?? res?.rowsAffected ?? 0);
        if (affected > 0) {
          claimedEvents.push({
            ...candidate,
            leaseOwner: ownerId,
            leaseGeneration: nextGen,
            leaseExpiresAt,
            status: 'processing',
          });
        }
      }

      return Result.ok(claimedEvents);
    } catch (error: any) {
      return Result.fail(`Failed to claim outbox lease: ${error.message}`);
    }
  }

  async renewLease(
    ownerId: string,
    eventId: string,
    currentGeneration: number,
    durationMs: number = 30000
  ): Promise<Result<boolean>> {
    try {
      const now = new Date();
      const newExpiresAt = new Date(now.getTime() + durationMs);

      const res = await this.db
        .update(outboxEvents)
        .set({
          leaseExpiresAt: newExpiresAt,
        })
        .where(
          and(
            eq(outboxEvents.id, eventId),
            eq(outboxEvents.leaseOwner, ownerId),
            eq(outboxEvents.leaseGeneration, currentGeneration),
            sql`${outboxEvents.leaseExpiresAt} > ${now}`,
            eq(outboxEvents.status, 'processing')
          )
        );

      const affected = (res?.meta?.changes ?? res?.rowsAffected ?? 0);
      return Result.ok(affected > 0);
    } catch (error: any) {
      return Result.fail(`Failed to renew outbox lease: ${error.message}`);
    }
  }

  async recordConsumerReceipt(consumerId: string, eventId: string): Promise<Result<boolean>> {
    try {
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
        return Result.ok(false);
      }
      return Result.fail(`Failed to record consumer receipt: ${error.message}`);
    }
  }
}

