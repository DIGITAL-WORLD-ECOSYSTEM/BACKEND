import { IUnitOfWork } from '../../ports/output/IUnitOfWork';
import { Result } from '../../../shared/kernel/Result';
import { LedgerTransaction, LedgerEntry } from '../../../domains/finance/entities/LedgerTransaction';
import { Money256 } from '../../../domains/finance/value-objects/Money256';
import { AccountingEntryPolicy } from '../../../domains/finance/policies/AccountingEntryPolicy';
import { FinancialTransactionOrchestrator, OrchestratorResult } from '../services/FinancialTransactionOrchestrator';
import { CanonicalRequestHashService } from '../services/CanonicalRequestHashService';
import {
  InvalidStateTransitionError,
  IdempotencyConflictError,
  IdempotencyInProgressError,
  AccountOwnershipError,
  FinancialError,
} from '../../../domains/finance/errors/FinancialError';
import { FinancialTransactionStateMachine } from '../../../domains/finance/services/FinancialTransactionStateMachine';
import {
  freezeAuthorizationContext,
  isAuthenticAuthorizationContext,
  AuthorizationContext,
} from '../../../domains/finance/contracts/AuthorizationContext';

export interface ReverseTransactionInput {
  originalTransactionId: number;
  actorUserId: number;
  idempotencyKey: string;
  reason: string;
  requestHash?: string;
  authContext?: AuthorizationContext;
}

export class ReverseTransactionUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(input: ReverseTransactionInput): Promise<Result<OrchestratorResult>> {
    try {
      if (!input.actorUserId) {
        throw new Error('Identificação de actorUserId é obrigatória para efetuar o estorno.');
      }

      return await this.uow.execute(async (factory) => {
        const repo = factory.getFinanceRepository();

        // P0-1: Early idempotency replay check before validating originalTx mutable status
        const prior = await repo.getIdempotencyRecord(input.idempotencyKey, 'finance');
        if (prior?.status === 'completed' && prior.transactionId) {
          const existingTxRes = await repo.getTransactionById(prior.transactionId);
          if (existingTxRes.isSuccess) {
            const existingTx = existingTxRes.getValue();
            const isMatchingReversal =
              existingTx.type === 'reversal' &&
              ((existingTx as any).reversalOfTransactionId === input.originalTransactionId ||
                existingTx.description.includes(`Estorno da Transação #${input.originalTransactionId}`));

            if (isMatchingReversal) {
              if (input.requestHash !== undefined && prior.requestHash && input.requestHash !== prior.requestHash) {
                return Result.fail<OrchestratorResult>(
                  new IdempotencyConflictError('409 Conflict: O requestHash fornecido não coincide com o hash canônico do estorno.')
                );
              }
              return Result.ok<OrchestratorResult>({
                transactionId: prior.transactionId,
                isReplayed: true,
              });
            }
            return Result.fail<OrchestratorResult>(new IdempotencyConflictError());
          }
        }

        if (prior?.status === 'processing') {
          return Result.fail<OrchestratorResult>(
            new IdempotencyInProgressError('Transação de estorno em processamento com esta chave de idempotência.')
          );
        }

        // 1. Obter registro original por ID direto O(1) para validar estado e tipo
        const txRes = await repo.getTransactionById(input.originalTransactionId);
        if (txRes.isFailure) {
          throw new Error(`Registro de transação #${input.originalTransactionId} não encontrado: ${txRes.error}`);
        }
        const originalTx = txRes.getValue();

        // F8: Validação formal da transição de estado via FinancialTransactionStateMachine
        const transitionRes = FinancialTransactionStateMachine.transition(originalTx.status, 'reversed');
        if (transitionRes.isFailure) {
          throw new InvalidStateTransitionError(
            `Transição de estado inválida para estorno: ${transitionRes.error}`
          );
        }

        // FIN-017: Proibir estorno de estorno (reversal of reversal)
        if (originalTx.type === 'reversal') {
          throw new InvalidStateTransitionError('Estorno de transação do tipo "reversal" é estritamente proibido (FIN-017).');
        }

        // 2. Obter lançamentos da transação original
        const originalEntriesRes = await repo.getTransactionEntries(input.originalTransactionId);
        if (originalEntriesRes.isFailure) {
          throw new Error(`Transação original #${input.originalTransactionId} não encontrada: ${originalEntriesRes.error}`);
        }

        const rawEntries = originalEntriesRes.getValue();
        if (!rawEntries || rawEntries.length === 0) {
          throw new Error(`Transação original #${input.originalTransactionId} não possui lançamentos contábeis.`);
        }

        // F1: Bloquear estorno se a transação original já sofreu reembolso parcial ou total (por ativo)
        if (originalTx.type === 'payment') {
          const distinctAssetIds = Array.from(new Set(rawEntries.map((e) => e.assetId)));
          for (const assetId of distinctAssetIds) {
            const refundedTotal = await repo.getRefundsTotalForTransaction(input.originalTransactionId, assetId);
            if (refundedTotal > 0n) {
              throw new InvalidStateTransitionError(
                `Estorno rejeitado: a transação #${input.originalTransactionId} já possui reembolso(s) associado(s) para o ativo #${assetId} (total reembolsado: ${refundedTotal.toString()}). Estornar a transação duplicaria o crédito ao usuário.`
              );
            }
          }
        }

        // 3. Gerar lançamentos inversos via AccountingEntryPolicy
        const domainEntries = rawEntries.map((e) => ({
          accountId: e.accountId,
          assetId: e.assetId,
          entryType: e.direction,
          amount: Money256.fromString(e.amountBaseUnits, e.assetId),
          description: `Original Entry #${e.accountId}`,
        }));

        const reversedRaw = AccountingEntryPolicy.createReversalEntries(domainEntries, input.reason);

        const reverseLedgerEntries: LedgerEntry[] = reversedRaw.map(
          (r) =>
            new LedgerEntry({
              accountId: String(r.accountId),
              amount: r.amount,
              type: r.entryType,
              description: r.description,
            })
        );

        const reversalTx = LedgerTransaction.create({
          idempotencyKey: input.idempotencyKey,
          description: `Estorno da Transação #${input.originalTransactionId}: ${input.reason}`,
          entries: reverseLedgerEntries,
          transactionType: 'reversal',
          category: 'operational',
          userId: originalTx.userId,
          reversalOfTransactionId: input.originalTransactionId,
        });

        if (input.requestHash !== undefined) {
          const canonicalHash = CanonicalRequestHashService.calculateHash(reversalTx);
          if (input.requestHash !== canonicalHash) {
            throw new IdempotencyConflictError('409 Conflict: O requestHash fornecido não coincide com o hash canônico do estorno.');
          }
        }

        let reversalAuthCtx: AuthorizationContext;
        if (input.authContext) {
          if (!isAuthenticAuthorizationContext(input.authContext)) {
            throw new AccountOwnershipError('Contexto de autorização de estorno fornecido é inválido ou não autenticado.');
          }
          reversalAuthCtx = input.authContext;
        } else {
          reversalAuthCtx = freezeAuthorizationContext({
            principalId: input.actorUserId,
            principalType: input.actorUserId === 0 ? 'system' : 'service_account',
            capabilities: ['finance.system.reversal', 'finance.system.operate'],
            correlationId: input.idempotencyKey,
          });
        }

        const orchestrator = new FinancialTransactionOrchestrator(repo, factory.getOutboxRepository());
        const orchestratorResult = await orchestrator.executePosting(reversalTx, reversalAuthCtx);

        // Atualizar transação original para 'reversed' dentro da mesma UoW
        await repo.updateTransactionStatus(input.originalTransactionId, 'reversed', originalTx.version);

        return Result.ok(orchestratorResult);
      });
    } catch (err: unknown) {
      if (err instanceof FinancialError) {
        return Result.fail(err);
      }
      const message = err instanceof Error ? err.message : 'Falha ao estornar transação financeira.';
      return Result.fail(message);
    }
  }
}
