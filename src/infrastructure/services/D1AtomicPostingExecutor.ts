import { IPostingExecutor, PostingExecutionResult } from '../../application/ports/output/IPostingExecutor';
import { PostingPlan } from '../../domains/finance/contracts/PostingPlan';
import { PostingSession } from '../../domains/finance/contracts/PostingSession';
import { Result } from '../../shared/kernel/Result';
import {
  financialTransactions,
  financialLedgerEntries,
  accountBalances,
  sqlAssertions,
} from '../../db/finance/tables';
import { outboxEvents, idempotencyKeys } from '../../db/infrastructure/tables';
import { eq, and, sql } from 'drizzle-orm';
import { isD1Database } from '../repositories/db_helper';
import {
  OptimisticConcurrencyError,
  FinancialError,
  AtomicPostingExecutionError,
} from '../../domains/finance/errors/FinancialError';

export class D1AtomicPostingExecutor implements IPostingExecutor {
  constructor(private readonly db: any) {
    if (!db) {
      throw new Error('Database instance is required for D1AtomicPostingExecutor.');
    }
  }

  async execute(plan: PostingPlan, session: PostingSession): Promise<Result<PostingExecutionResult>> {
    if (!session || typeof session.isValid !== 'function' || !session.isValid()) {
      return Result.fail('PostingSession inválida, forjada ou ausente. Execução contábil abortada.');
    }

    if (!plan || !plan.leaseOwner || typeof plan.leaseOwner !== 'string' || typeof plan.leaseGeneration !== 'number') {
      return Result.fail('Fencing de concorrência P0 violado: leaseOwner e leaseGeneration são obrigatórios no PostingPlan.');
    }

    const now = new Date();
    let committedTxId = plan.transactionId;

    try {
      if (typeof this.db.batch === 'function') {
        // Drizzle D1 Driver native batching
        const statements: any[] = [];

        // 1. Financial Transaction
        statements.push(
          this.db.insert(financialTransactions).values({
            id: plan.transactionRecord.id,
            userId: plan.transactionRecord.actorUserId ?? null,
            actorUserId: plan.transactionRecord.actorUserId,
            authorizedByUserId: plan.transactionRecord.authorizedByUserId,
            type: plan.transactionRecord.type as any,
            category: plan.transactionRecord.category as any,
            description: plan.transactionRecord.description,
            status: 'completed',
            sourceType: plan.transactionRecord.sourceType,
            sourceId: plan.transactionRecord.sourceId,
            reversalOfTransactionId: plan.transactionRecord.reversalOfTransactionId ?? null,
            refundOfTransactionId: plan.transactionRecord.refundOfTransactionId ?? null,
            correlationId: plan.transactionRecord.correlationId,
            createdAt: now,
            completedAt: now,
            version: 1,
          })
        );

        // 2. Financial Ledger Entries
        for (const entry of plan.ledgerEntries) {
          statements.push(
            this.db.insert(financialLedgerEntries).values({
              transactionId: entry.transactionId,
              entryOrdinal: entry.entryOrdinal,
              accountId: entry.accountId,
              assetId: entry.assetId,
              direction: entry.direction,
              amountBaseUnits: entry.amountBaseUnits,
              createdAt: now,
            })
          );
        }

        // 3. Balance Mutations with OCC & Physical Assertion Guards
        for (const mutation of plan.balanceMutations) {
          statements.push(
            this.db
              .update(accountBalances)
              .set({
                availableBaseUnits: mutation.newAvailableBaseUnits,
                version: mutation.expectedVersion + 1,
                updatedAt: now,
              })
              .where(
                and(
                  eq(accountBalances.accountId, mutation.accountId),
                  eq(accountBalances.assetId, mutation.assetId),
                  eq(accountBalances.version, mutation.expectedVersion),
                  sql`(SELECT status FROM financial_accounts WHERE id = ${mutation.accountId}) = 'active'`,
                  sql`(SELECT status FROM financial_assets WHERE id = ${mutation.assetId}) = 'active'`
                )
              )
          );

          statements.push(
            this.db.run(sql`
              INSERT INTO _sql_assertions (id, guard)
              VALUES (1, (SELECT CASE WHEN changes() = 1 THEN 1 ELSE 0 END))
              ON CONFLICT(id) DO UPDATE SET guard = (SELECT CASE WHEN changes() = 1 THEN 1 ELSE 0 END)
            `)
          );
        }

        // 4. Outbox Event
        statements.push(
          this.db.insert(outboxEvents).values({
            id: plan.outboxEvent.eventId,
            eventName: plan.outboxEvent.eventName,
            aggregateId: plan.outboxEvent.aggregateId,
            aggregateType: 'LedgerTransaction',
            aggregateVersion: plan.outboxEvent.aggregateVersion,
            payload: plan.outboxEvent.payload,
            status: 'pending',
            attempts: 0,
            leaseGeneration: 0,
            createdAt: now,
          })
        );

        // 5. Idempotency Completion & Physical Assertion Guard (Fencing P0 Estrito)
        const idempotencyConditions = [
          eq(idempotencyKeys.scope, plan.scope),
          eq(idempotencyKeys.key, plan.idempotencyKey),
          eq(idempotencyKeys.status, 'processing'),
          eq(idempotencyKeys.requestHash, plan.requestHash),
          eq(idempotencyKeys.leaseOwner, plan.leaseOwner),
          eq(idempotencyKeys.leaseGeneration, plan.leaseGeneration),
        ];

        const idempotencyUpdateSet: any = {
          status: 'completed',
          financialTransactionId: plan.transactionId,
          updatedAt: now,
        };
        if (plan.responseStatus !== undefined && plan.responseStatus !== null) {
          idempotencyUpdateSet.responseStatus = plan.responseStatus;
        }
        if (plan.responsePayload !== undefined && plan.responsePayload !== null) {
          idempotencyUpdateSet.responsePayload = plan.responsePayload;
        }

        statements.push(
          this.db
            .update(idempotencyKeys)
            .set(idempotencyUpdateSet)
            .where(and(...idempotencyConditions))
        );

        statements.push(
          this.db.run(sql`
            INSERT INTO _sql_assertions (id, guard)
            VALUES (1, (SELECT CASE WHEN changes() = 1 THEN 1 ELSE 0 END))
            ON CONFLICT(id) DO UPDATE SET guard = (SELECT CASE WHEN changes() = 1 THEN 1 ELSE 0 END)
          `)
        );

        await this.db.batch(statements);
      } else if (isD1Database(this.db)) {
        // Fallback for D1 client with raw batch
        const d1 = this.db.$client || this.db.session?.client;
        if (d1 && typeof d1.batch === 'function' && typeof d1.prepare === 'function') {
          // If raw D1 client
          const statements: any[] = [];
          // 1. Transaction
          statements.push(
            d1
              .prepare(
                `INSERT INTO financial_transactions (id, user_id, actor_user_id, authorized_by_user_id, type, category, description, status, source_type, source_id, reversal_of_transaction_id, refund_of_transaction_id, correlation_id, created_at, completed_at, version)
                 VALUES (?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?, ?, 1)`
              )
              .bind(
                plan.transactionRecord.id,
                plan.transactionRecord.actorUserId ?? null,
                plan.transactionRecord.actorUserId,
                plan.transactionRecord.authorizedByUserId,
                plan.transactionRecord.type,
                plan.transactionRecord.category,
                plan.transactionRecord.description,
                plan.transactionRecord.sourceType,
                plan.transactionRecord.sourceId,
                plan.transactionRecord.reversalOfTransactionId ?? null,
                plan.transactionRecord.refundOfTransactionId ?? null,
                plan.transactionRecord.correlationId,
                now.getTime(),
                now.getTime()
              )
          );

          // 2. Ledger entries
          for (const entry of plan.ledgerEntries) {
            statements.push(
              d1
                .prepare(
                  `INSERT INTO financial_ledger_entries (transaction_id, entry_ordinal, account_id, asset_id, direction, amount_base_units, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?)`
                )
                .bind(
                  entry.transactionId,
                  entry.entryOrdinal,
                  entry.accountId,
                  entry.assetId,
                  entry.direction,
                  entry.amountBaseUnits,
                  now.getTime()
                )
            );
          }

          // 3. Balance mutations + assertions
          for (const mutation of plan.balanceMutations) {
            statements.push(
              d1
                .prepare(
                  `UPDATE account_balances
                   SET available_base_units = ?,
                       version = version + 1,
                       updated_at = ?
                   WHERE account_id = ?
                     AND asset_id = ?
                     AND version = ?
                     AND (SELECT status FROM financial_accounts WHERE id = ?) = 'active'
                     AND (SELECT status FROM financial_assets WHERE id = ?) = 'active'`
                )
                .bind(
                  mutation.newAvailableBaseUnits,
                  now.getTime(),
                  mutation.accountId,
                  mutation.assetId,
                  mutation.expectedVersion,
                  mutation.accountId,
                  mutation.assetId
                )
            );

            statements.push(
              d1.prepare(
                `INSERT INTO _sql_assertions (id, guard)
                 VALUES (1, (SELECT CASE WHEN changes() = 1 THEN 1 ELSE 0 END))
                 ON CONFLICT(id) DO UPDATE SET guard = (SELECT CASE WHEN changes() = 1 THEN 1 ELSE 0 END)`
              )
            );
          }

          // 4. Outbox event
          statements.push(
            d1
              .prepare(
                `INSERT INTO outbox_events (id, event_name, aggregate_id, aggregate_type, aggregate_version, payload, status, attempts, lease_generation, created_at)
                 VALUES (?, ?, ?, 'LedgerTransaction', ?, ?, 'pending', 0, 0, ?)`
              )
              .bind(
                plan.outboxEvent.eventId,
                plan.outboxEvent.eventName,
                plan.outboxEvent.aggregateId,
                plan.outboxEvent.aggregateVersion,
                plan.outboxEvent.payload,
                Math.floor(now.getTime() / 1000)
              )
          );

          // 5. Idempotency completion + assertion (Fencing P0 Estrito com requestHash)
          statements.push(
            d1
              .prepare(
                `UPDATE idempotency_keys
                 SET status = 'completed',
                     financial_transaction_id = ?,
                     response_status = ?,
                     response_payload = ?,
                     updated_at = ?
                 WHERE scope = ?
                   AND key = ?
                   AND status = 'processing'
                   AND request_hash = ?
                   AND lease_owner = ?
                   AND lease_generation = ?`
              )
              .bind(
                plan.transactionId,
                plan.responseStatus,
                plan.responsePayload,
                Math.floor(now.getTime() / 1000),
                plan.scope,
                plan.idempotencyKey,
                plan.requestHash,
                plan.leaseOwner,
                plan.leaseGeneration
              )
          );

          statements.push(
            d1.prepare(
              `INSERT INTO _sql_assertions (id, guard)
               VALUES (1, (SELECT CASE WHEN changes() = 1 THEN 1 ELSE 0 END))
               ON CONFLICT(id) DO UPDATE SET guard = (SELECT CASE WHEN changes() = 1 THEN 1 ELSE 0 END)`
            )
          );

          await d1.batch(statements);
        } else {
          throw new Error('D1 client does not support batch execution.');
        }
      } else if (typeof this.db.transaction === 'function') {
        // SQLite Immediate Transaction
        await this.db.transaction(
          async (tx: any) => {
            committedTxId = await this.executeStatementsOnExecutor(tx, plan, now);
          },
          { behavior: 'immediate' }
        );
      } else {
        // Already inside a transaction or single connection executor
        committedTxId = await this.executeStatementsOnExecutor(this.db, plan, now);
      }

      session.markConsumed();

      return Result.ok({
        transactionId: committedTxId,
        planId: plan.planId,
        executedAt: now,
      });
    } catch (err: any) {
      const msg = `${err?.message || ''} ${err?.cause?.message || ''}`.toLowerCase();

      if (msg.includes('guard = 1') || msg.includes('ck_sql_assertions_guard')) {
        return Result.fail(
          new OptimisticConcurrencyError(
            'Falha de concorrência ou guarda física violada: versão de saldo divergente, conta inativa ou lease de idempotência expirado.'
          )
        );
      }

      if (msg.includes('uq_ledger_entry_ordinal')) {
        return Result.fail(
          new AtomicPostingExecutionError(
            'Violação estrutural de unicidade: ordinal de perna contábil duplicado na mesma transação.',
            'DUPLICATE_LEDGER_ORDINAL'
          )
        );
      }

      return Result.fail(
        new AtomicPostingExecutionError(`Falha durante execução atômica no banco de dados: ${err?.message || String(err)}`)
      );
    }
  }

  private async executeStatementsOnExecutor(
    executor: any,
    plan: PostingPlan,
    now: Date
  ): Promise<number> {
    // 1. Financial Transaction
    const [inserted] = await executor.insert(financialTransactions).values({
      userId: plan.transactionRecord.actorUserId ?? null,
      actorUserId: plan.transactionRecord.actorUserId,
      authorizedByUserId: plan.transactionRecord.authorizedByUserId,
      type: plan.transactionRecord.type as any,
      category: plan.transactionRecord.category as any,
      description: plan.transactionRecord.description,
      status: 'completed',
      sourceType: plan.transactionRecord.sourceType,
      sourceId: plan.transactionRecord.sourceId,
      reversalOfTransactionId: plan.transactionRecord.reversalOfTransactionId ?? null,
      refundOfTransactionId: plan.transactionRecord.refundOfTransactionId ?? null,
      correlationId: plan.transactionRecord.correlationId,
      createdAt: now,
      completedAt: now,
      version: 1,
    }).returning({ id: financialTransactions.id });

    const finalTxId = inserted?.id ?? plan.transactionRecord.id;

    // 2. Financial Ledger Entries
    for (const entry of plan.ledgerEntries) {
      await executor.insert(financialLedgerEntries).values({
        transactionId: finalTxId,
        entryOrdinal: entry.entryOrdinal,
        accountId: entry.accountId,
        assetId: entry.assetId,
        direction: entry.direction,
        amountBaseUnits: entry.amountBaseUnits,
        createdAt: now,
      });
    }

    // 3. Balance Mutations with OCC & Physical Assertion Guards
    for (const mutation of plan.balanceMutations) {
      await executor
        .update(accountBalances)
        .set({
          availableBaseUnits: mutation.newAvailableBaseUnits,
          version: mutation.expectedVersion + 1,
          updatedAt: now,
        })
        .where(
          and(
            eq(accountBalances.accountId, mutation.accountId),
            eq(accountBalances.assetId, mutation.assetId),
            eq(accountBalances.version, mutation.expectedVersion),
            sql`(SELECT status FROM financial_accounts WHERE id = ${mutation.accountId}) = 'active'`,
            sql`(SELECT status FROM financial_assets WHERE id = ${mutation.assetId}) = 'active'`
          )
        );

      await executor.run(sql`
        INSERT INTO _sql_assertions (id, guard)
        VALUES (1, (SELECT CASE WHEN changes() = 1 THEN 1 ELSE 0 END))
        ON CONFLICT(id) DO UPDATE SET guard = (SELECT CASE WHEN changes() = 1 THEN 1 ELSE 0 END);
      `);
    }

    // 4. Outbox Event
    await executor.insert(outboxEvents).values({
      id: plan.outboxEvent.eventId,
      eventName: plan.outboxEvent.eventName,
      aggregateId: String(finalTxId),
      aggregateType: 'LedgerTransaction',
      aggregateVersion: plan.outboxEvent.aggregateVersion,
      payload: plan.outboxEvent.payload,
      status: 'pending',
      attempts: 0,
      leaseGeneration: 0,
      createdAt: now,
    });

    // 5. Idempotency Completion & Assertion Guard (Fencing P0 Estrito)
    const execIdempConditions = [
      eq(idempotencyKeys.scope, plan.scope),
      eq(idempotencyKeys.key, plan.idempotencyKey),
      eq(idempotencyKeys.status, 'processing'),
      eq(idempotencyKeys.requestHash, plan.requestHash),
      eq(idempotencyKeys.leaseOwner, plan.leaseOwner),
      eq(idempotencyKeys.leaseGeneration, plan.leaseGeneration),
    ];

    const execIdempUpdateSet: any = {
      status: 'completed',
      financialTransactionId: finalTxId,
      updatedAt: now,
    };
    if (plan.responseStatus !== undefined && plan.responseStatus !== null) {
      execIdempUpdateSet.responseStatus = plan.responseStatus;
    }
    if (plan.responsePayload !== undefined && plan.responsePayload !== null) {
      execIdempUpdateSet.responsePayload = plan.responsePayload;
    }

    await executor
      .update(idempotencyKeys)
      .set(execIdempUpdateSet)
      .where(and(...execIdempConditions));

    await executor.run(sql`
      INSERT INTO _sql_assertions (id, guard)
      VALUES (1, (SELECT CASE WHEN changes() = 1 THEN 1 ELSE 0 END))
      ON CONFLICT(id) DO UPDATE SET guard = (SELECT CASE WHEN changes() = 1 THEN 1 ELSE 0 END);
    `);

    return finalTxId;
  }
}
