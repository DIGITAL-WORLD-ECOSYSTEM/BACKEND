import { Result } from '../../shared/kernel/Result';
import { eventInbox } from '../../db/infrastructure/tables';
import { eq, and, sql, lt } from 'drizzle-orm';
import { CanonicalRequestHashService } from '../../application/finance/services/CanonicalRequestHashService';
import { ExternalEventPayloadConflictError } from '../../domains/finance/errors/FinancialError';

export interface RecordWebhookEventInput {
  eventId: string;
  providerId: number;
  eventType?: string;
  externalEventId: string;
  payload: Record<string, any>;
  workerId?: string;
  leaseDurationMs?: number;
}

export class EventInboxService {
  /**
   * P0: Event Inbox com claim condicional SQL atômico, leaseGeneration e verificação de payloadHash (FIN-014, FIN-015, FIN-021).
   */
  async processEventOnce<T>(
    db: any,
    input: RecordWebhookEventInput,
    handler: () => Promise<Result<T>>
  ): Promise<Result<{ isDuplicate: boolean; result?: T }>> {
    const workerId = input.workerId || 'default-worker';
    const leaseDurationMs = input.leaseDurationMs || 30000; // 30s
    const computedPayloadHash = CanonicalRequestHashService.calculateHash(input.payload);
    const serializedPayload = JSON.stringify(input.payload);
    const now = new Date();
    const leaseExpiresAt = new Date(now.getTime() + leaseDurationMs);

    let activeLeaseGeneration = 1;

    try {
      // 1. Verificar registro existente
      const [existing] = await db
        .select()
        .from(eventInbox)
        .where(
          and(
            eq(eventInbox.providerId, input.providerId),
            eq(eventInbox.externalEventId, input.externalEventId)
          )
        )
        .limit(1);

      if (existing) {
        // Validação FIN-014: Mesma id de evento com payload divergente
        if (existing.payloadHash && existing.payloadHash !== computedPayloadHash) {
          throw new ExternalEventPayloadConflictError(
            `Conflito de integridade: Evento #${input.externalEventId} do provider #${input.providerId} recebido com payload divergente.`
          );
        }

        if (existing.status === 'processed') {
          return Result.ok({ isDuplicate: true });
        }

        // Se estiver em processing com lease válido mantido por OUTRO worker -> aguardar/rejeitar
        if (
          existing.status === 'processing' &&
          existing.leaseExpiresAt &&
          new Date(existing.leaseExpiresAt) > now &&
          existing.leaseOwner !== workerId
        ) {
          return Result.ok({ isDuplicate: true });
        }

        // Claim atômico condicional de lease
        activeLeaseGeneration = (existing.leaseGeneration || 0) + 1;

        const updateRes = await db
          .update(eventInbox)
          .set({
            status: 'processing',
            leaseOwner: workerId,
            leaseGeneration: activeLeaseGeneration,
            leaseExpiresAt,
            processingStartedAt: now,
            attempts: sql`${eventInbox.attempts} + 1`,
          })
          .where(
            and(
              eq(eventInbox.id, existing.id),
              sql`(${eventInbox.status} = 'pending' OR ${eventInbox.status} = 'failed' OR ${eventInbox.leaseExpiresAt} < ${now.getTime()} OR ${eventInbox.leaseOwner} = ${workerId})`
            )
          );

        const affected = (updateRes?.meta?.changes ?? updateRes?.rowsAffected ?? 0);
        if (affected === 0) {
          // Outro worker obteve o lease concorrentemente
          return Result.ok({ isDuplicate: true });
        }
      } else {
        // Inserir registro inicial como 'processing'
        await db.insert(eventInbox).values({
          id: input.eventId,
          providerId: input.providerId,
          eventType: input.eventType || 'generic',
          externalEventId: input.externalEventId,
          payload: serializedPayload,
          payloadHash: computedPayloadHash,
          status: 'processing',
          leaseOwner: workerId,
          leaseGeneration: 1,
          leaseExpiresAt,
          attempts: 1,
          processingStartedAt: now,
          createdAt: now,
        });
        activeLeaseGeneration = 1;
      }
    } catch (err: any) {
      if (err instanceof ExternalEventPayloadConflictError) {
        return Result.fail(err.message);
      }
      const errStr = String(err.message || '').toLowerCase();
      if (errStr.includes('unique') || errStr.includes('constraint')) {
        return Result.ok({ isDuplicate: true });
      }
      return Result.fail(`Erro ao gerenciar inbox de eventos: ${err.message}`);
    }

    // 2. Executar Handler de Negócio
    let handlerResult: Result<T>;
    try {
      handlerResult = await handler();
    } catch (handlerErr: any) {
      handlerResult = Result.fail(handlerErr.message || 'Erro inesperado no handler do evento.');
    }

    if (handlerResult.isFailure) {
      // Marcar como failed no inbox condicionado ao leaseGeneration
      await db
        .update(eventInbox)
        .set({
          status: 'failed',
          lastError: handlerResult.error,
          leaseOwner: null,
          leaseExpiresAt: null,
        })
        .where(
          and(
            eq(eventInbox.providerId, input.providerId),
            eq(eventInbox.externalEventId, input.externalEventId),
            eq(eventInbox.leaseOwner, workerId),
            eq(eventInbox.leaseGeneration, activeLeaseGeneration)
          )
        );

      return Result.fail(`Falha ao processar evento externo: ${handlerResult.error}`);
    }

    // 3. Atualizar status para 'processed' APÓS sucesso total (FIN-021: Condicionado a leaseOwner e leaseGeneration)
    const finalUpdateRes = await db
      .update(eventInbox)
      .set({
        status: 'processed',
        processedAt: new Date(),
        leaseOwner: null,
        leaseExpiresAt: null,
      })
      .where(
        and(
          eq(eventInbox.providerId, input.providerId),
          eq(eventInbox.externalEventId, input.externalEventId),
          eq(eventInbox.leaseOwner, workerId),
          eq(eventInbox.leaseGeneration, activeLeaseGeneration)
        )
      );

    const finalAffected = (finalUpdateRes?.meta?.changes ?? finalUpdateRes?.rowsAffected ?? 0);
    if (finalAffected === 0) {
      // Worker expirou e perdeu o lease durante a execução do handler
      return Result.fail('Stale Worker Error: O lease do worker expirou antes da conclusão do evento (FIN-021).');
    }

    return Result.ok({ isDuplicate: false, result: handlerResult.getValue() });
  }
}
