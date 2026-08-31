import { Result } from '../../../shared/kernel/Result';
import { eventInbox } from '../../../db/infrastructure/tables';
import { eq, and } from 'drizzle-orm';

export interface RecordWebhookEventInput {
  eventId: string;
  providerId: number;
  externalEventId: string;
  payload: Record<string, any>;
}

export class EventInboxService {
  /**
   * Garante idempotência estrita no recebimento de webhooks/eventos externos (DOD-14).
   * Retorna { isDuplicate: true } se o evento já foi processado anteriormente.
   */
  async processEventOnce<T>(
    db: any,
    input: RecordWebhookEventInput,
    handler: () => Promise<Result<T>>
  ): Promise<Result<{ isDuplicate: boolean; result?: T }>> {
    try {
      // 0. Verificação prévia por (providerId, externalEventId)
      const existing = await db
        .select()
        .from(eventInbox)
        .where(
          and(
            eq(eventInbox.providerId, input.providerId),
            eq(eventInbox.externalEventId, input.externalEventId)
          )
        )
        .limit(1);

      if (existing && existing.length > 0) {
        return Result.ok({ isDuplicate: true });
      }

      // 1. Tentar registrar no inbox de eventos (UNIQUE(provider_id, external_event_id))
      await db
        .insert(eventInbox)
        .values({
          id: input.eventId,
          providerId: input.providerId,
          externalEventId: input.externalEventId,
          payload: JSON.stringify(input.payload),
          processedAt: new Date(),
        });
    } catch (err: any) {
      const code = String(err?.code || err?.extendedCode || err?.rawCode || err?.cause?.code || '');
      const isSqliteConstraintCode =
        code === 'SQLITE_CONSTRAINT' ||
        code === 'SQLITE_CONSTRAINT_UNIQUE' ||
        code === 'SQLITE_CONSTRAINT_PRIMARYKEY' ||
        code === '1555' ||
        code === '2067';

      const errStr = `${err.message || ''} ${code} ${err.cause?.message || ''}`.toLowerCase();
      if (
        isSqliteConstraintCode ||
        errStr.includes('unique') ||
        errStr.includes('constraint') ||
        errStr.includes('d1_error: unique constraint')
      ) {
        // Evento duplicado já processado ou concorrência na chave única
        return Result.ok({ isDuplicate: true });
      }
      return Result.fail(`Erro ao registrar evento no inbox: ${err.message}`);
    }

    // 2. Executar handler do evento
    const handlerResult = await handler();
    let resultVal: any = handlerResult;
    if (handlerResult && typeof handlerResult === 'object' && 'isFailure' in handlerResult) {
      if ((handlerResult as any).isFailure) {
        return Result.fail(`Falha ao processar evento externo: ${(handlerResult as any).error}`);
      }
      resultVal = (handlerResult as any).getValue();
    }

    return Result.ok({ isDuplicate: false, result: resultVal });
  }
}
