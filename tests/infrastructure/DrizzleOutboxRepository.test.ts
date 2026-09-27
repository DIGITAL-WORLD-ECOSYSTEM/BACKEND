import { describe, it, expect, vi } from 'vitest';
import { DrizzleOutboxRepository } from '@/infrastructure/repositories/DrizzleOutboxRepository';
import { IDomainEvent } from '@/shared/kernel/DomainEvent';

describe('DrizzleOutboxRepository', () => {
  it('should safely serialize events containing BigInt values without throwing TypeError', async () => {
    let insertedValue: any = null;
    const mockDb = {
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockImplementation((val) => {
          insertedValue = val;
          return Promise.resolve();
        }),
      }),
    };

    const repo = new DrizzleOutboxRepository(mockDb as any);

    const testEvent: IDomainEvent = {
      dateTimeOccurred: new Date(),
      eventName: 'BigIntTransferRecorded.v1',
      // BigInt properties that normally crash JSON.stringify
      amountBaseUnits: 100000000000000000000n as any,
      feeBigInt: 5000n as any,
      nested: {
        limit: 999999999999999999999999n as any,
      },
    } as any;

    const result = await repo.saveEvent(testEvent, 101, 'LedgerTransaction', 1);

    expect(result.isSuccess).toBe(true);
    expect(insertedValue).not.toBeNull();
    expect(insertedValue.id).toBeDefined();
    expect(typeof insertedValue.id).toBe('string');
    expect(insertedValue.id.length).toBeGreaterThan(10);
    
    // Check deserialization of payload
    const parsedPayload = JSON.parse(insertedValue.payload);
    expect(parsedPayload.amountBaseUnits).toBe('100000000000000000000');
    expect(parsedPayload.feeBigInt).toBe('5000');
    expect(parsedPayload.nested.limit).toBe('999999999999999999999999');
  });

  it('should generate valid CSPRNG UUID for each saved event', async () => {
    const ids: string[] = [];
    const mockDb = {
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockImplementation((val) => {
          ids.push(val.id);
          return Promise.resolve();
        }),
      }),
    };

    const repo = new DrizzleOutboxRepository(mockDb as any);
    const event: IDomainEvent = {
      dateTimeOccurred: new Date(),
      eventName: 'TestEvent.v1',
    };

    await repo.saveEvent(event, 1, 'Aggregate', 1);
    await repo.saveEvent(event, 2, 'Aggregate', 1);

    expect(ids.length).toBe(2);
    expect(ids[0]).not.toBe(ids[1]);
    expect(ids[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });
});
