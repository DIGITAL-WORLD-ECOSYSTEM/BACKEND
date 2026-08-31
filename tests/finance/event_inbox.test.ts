import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { readFileSync, unlinkSync } from 'fs';

import { EventInboxService } from '../../src/domains/finance/services/EventInboxService';

describe('Invariante DOD-14: Event Inbox Idempotency para Webhooks Externos', () => {
  let sqlite: any;
  let db: any;
  let eventInboxService: EventInboxService;
  const dbFile = 'test_inbox.db';

  beforeAll(async () => {
    sqlite = createClient({ url: `file:${dbFile}` });
    db = drizzle(sqlite);

    const migrationFiles = [
      './migrations/0000_white_raider.sql',
      './migrations/0007_event_inbox.sql',
    ];

    for (const file of migrationFiles) {
      try {
        const sqlContent = readFileSync(file, 'utf8')
          .replace(/--> statement-breakpoint/g, ';');
        await sqlite.executeMultiple(sqlContent);
      } catch (err: any) {}
    }

    eventInboxService = new EventInboxService();
  }, 30000);

  afterAll(() => {
    try { unlinkSync(dbFile); } catch (e) {}
  });

  it('DOD-14: Deve processar a primeira vez e ignorar reenvio duplicado do mesmo providerId + externalEventId', async () => {
    let executionCount = 0;
    const handler = async () => {
      executionCount++;
      return { status: 'processed' } as any;
    };

    const webhookPayload = {
      eventId: 'evt-uuid-1',
      providerId: 10,
      externalEventId: 'ext-tx-999',
      payload: { amount: 500, currency: 'BRL' },
    };

    // Primeira tentativa -> Processa normalmente
    const res1 = await eventInboxService.processEventOnce(db, webhookPayload, handler);
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
