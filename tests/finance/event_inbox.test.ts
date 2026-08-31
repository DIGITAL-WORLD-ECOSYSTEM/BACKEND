import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { unlinkSync } from 'fs';
import { EventInboxService } from '../../src/infrastructure/services/EventInboxService';
import { Result } from '../../src/shared/kernel/Result';
import { runAllMigrationsLibSql } from '../test_helpers/runMigrations';

describe('Invariante DOD-14: Event Inbox Idempotency para Webhooks Externos', () => {
  let sqlite: any;
  let db: any;
  let eventInboxService: EventInboxService;
  const dbFile = 'test_inbox.db';

  beforeAll(async () => {
    sqlite = createClient({ url: `file:${dbFile}` });
    db = drizzle(sqlite);

    await runAllMigrationsLibSql(sqlite);

    eventInboxService = new EventInboxService();
  }, 30000);

  afterAll(() => {
    try { unlinkSync(dbFile); } catch (e) {}
  });

  it('DOD-14: Deve processar a primeira vez e ignorar reenvio duplicado do mesmo providerId + externalEventId', async () => {
    let executionCount = 0;
    const handler = async () => {
      executionCount++;
      return Result.ok({ status: 'processed' });
    };

    const webhookPayload = {
      eventId: 'evt-uuid-1',
      providerId: 10,
      externalEventId: 'ext-tx-999',
      payload: { amount: 500, currency: 'BRL' },
    };

    // Primeira tentativa -> Processa normalmente
    const res1 = await eventInboxService.processEventOnce(db, webhookPayload, handler);
    if (res1.isFailure) console.log('res1 error:', res1.error);
    expect(res1.isSuccess).toBe(true);
    expect(res1.getValue().isDuplicate).toBe(false);
    expect(executionCount).toBe(1);

    // Segunda tentativa com mesmo providerId + externalEventId -> Idempotente! (Ignora execução do handler)
    const res2 = await eventInboxService.processEventOnce(db, webhookPayload, handler);
    if (res2.isFailure) console.log('res2 error:', res2.error);
    expect(res2.isSuccess).toBe(true);
    expect(res2.getValue().isDuplicate).toBe(true);
    expect(executionCount).toBe(1); // Não incrementou!
  });
});
