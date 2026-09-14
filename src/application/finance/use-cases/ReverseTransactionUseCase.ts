import { IUnitOfWork } from '../../ports/output/IUnitOfWork';
import { Result } from '../../../shared/kernel/Result';
import { LedgerTransaction, LedgerEntry } from '../../../domains/finance/entities/LedgerTransaction';
import { Money256 } from '../../../domains/finance/value-objects/Money256';
import { AccountingEntryPolicy } from '../../../domains/finance/policies/AccountingEntryPolicy';
import { FinancialTransactionOrchestrator, OrchestratorResult } from '../services/FinancialTransactionOrchestrator';
import { CanonicalRequestHashService } from '../services/CanonicalRequestHashService';
import { InvalidStateTransitionError } from '../../../domains/finance/errors/FinancialError';

export interface ReverseTransactionInput {
  originalTransactionId: number;
  actorUserId: number;
  idempotencyKey: string;
  reason: string;
  requestHash?: string;
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

        // 1. Obter lançamentos da transação original
        const originalEntriesRes = await repo.getTransactionEntries(input.originalTransactionId);
        if (originalEntriesRes.isFailure) {
          throw new Error(`Transação original #${input.originalTransactionId} não encontrada: ${originalEntriesRes.error}`);
        }

        const rawEntries = originalEntriesRes.getValue();
        if (!rawEntries || rawEntries.length === 0) {
          throw new Error(`Transação original #${input.originalTransactionId} não possui lançamentos contábeis.`);
        }

        // 2. Obter registro original por ID direto O(1) para validar estado e tipo
        const txRes = await repo.getTransactionById(input.originalTransactionId);
        if (txRes.isFailure) {
          throw new Error(`Registro de transação #${input.originalTransactionId} não encontrado: ${txRes.error}`);
        }
        const originalTx = txRes.getValue();

        if (originalTx.status !== 'completed') {
          throw new InvalidStateTransitionError(
            `Apenas transações no status "completed" podem ser estornadas. Status atual: "${originalTx.status}".`
          );
        }

        // FIN-017: Proibir estorno de estorno (reversal of reversal)
        if (originalTx.type === 'reversal') {
          throw new InvalidStateTransitionError('Estorno de transação do tipo "reversal" é estritamente proibido (FIN-017).');
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
            throw new Error('409 Conflict: O requestHash fornecido não coincide com o hash canônico do estorno.');
          }
        }

        const orchestrator = new FinancialTransactionOrchestrator(repo, factory.getOutboxRepository());
        const orchestratorResult = await orchestrator.executePosting(reversalTx);

        // Atualizar transação original para 'reversed' dentro da mesma UoW
        await repo.updateTransactionStatus(input.originalTransactionId, 'reversed', originalTx.version);

        return Result.ok(orchestratorResult);
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Falha ao estornar transação financeira.';
      return Result.fail(message);
    }
  }
}
