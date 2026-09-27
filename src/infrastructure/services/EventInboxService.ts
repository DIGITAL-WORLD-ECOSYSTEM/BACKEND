import { Result } from '../../shared/kernel/Result';
import { eventInbox } from '../../db/infrastructure/tables';
import { eq, and, sql, lt, or, inArray } from 'drizzle-orm';
import { CanonicalRequestHashService } from '../../application/finance/services/CanonicalRequestHashService';
import { ExternalEventPayloadConflictError } from '../../domains/finance/errors/FinancialError';
import { isUniqueConstraintViolation } from '../repositories/DrizzleFinanceRepository';

export interface RecordWebhookEventInput {
  eventId: string;
  providerId: number;
  eventType?: string;
  externalEventId: string;
  payload: Record<string, any>;
  workerId?: string;
  leaseDurationMs?: number;
}

function generateWorkerId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const nodeCrypto = require('node:crypto');
    if (typeof nodeCrypto.randomUUID === 'function') {
      return nodeCrypto.randomUUID();
    }
  } catch {
    // fallback
  }
  throw new Error('CSPRNG unavailable for secure worker ID generation.');
}

function safeSerializePayload(payload: unknown): string {
  return JSON.stringify(payload, (_key, value) =>
    typeof value === 'bigint' ? value.toString() : value
  );
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
    let workerId: string;
    try {
      workerId = input.workerId || generateWorkerId();
    } catch (e: any) {
      return Result.fail(`Falha de CSPRNG: ${e.message}`);
    }
    const leaseDurationMs = input.leaseDurationMs || 30000; // 30s
    let computedPayloadHash: string;
    try {
      computedPayloadHash = CanonicalRequestHashService.calculateHash(input.payload);
    } catch (e: any) {
      return Result.fail(`Payload inválido para canonicalização: ${e.message}`);
    }
    let serializedPayload: string;
    try {
      serializedPayload = safeSerializePayload(input.payload);
    } catch (e: any) {
      return Result.fail(`Falha ao serializar payload: ${e.message}`);
    }
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
              eq(eventInbox.leaseGeneration, existing.leaseGeneration),
              or(
                inArray(eventInbox.status, ['pending', 'failed']),
                lt(eventInbox.leaseExpiresAt, now),
                eq(eventInbox.leaseOwner, workerId)
              )
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
      if (isUniqueConstraintViolation(err)) {
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
