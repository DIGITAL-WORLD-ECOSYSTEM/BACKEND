import { IUnitOfWork } from '../../ports/output/IUnitOfWork';
import { Result } from '../../../shared/kernel/Result';
import { LedgerTransaction, LedgerEntry } from '../../../domains/finance/entities/LedgerTransaction';
import { Money256 } from '../../../domains/finance/value-objects/Money256';
import { AccountingEntryPolicy } from '../../../domains/finance/policies/AccountingEntryPolicy';
import { FinancialTransactionOrchestrator, OrchestratorResult } from '../services/FinancialTransactionOrchestrator';
import { CanonicalRequestHashService } from '../services/CanonicalRequestHashService';

export interface TransferCommand {
  sourceUserId: number;
  destinationUserId: number;
  amountBaseUnits: string;
  assetId: number;
  description: string;
  idempotencyKey: string;
  requestHash?: string;
}

export class RecordTransferUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(command: TransferCommand): Promise<Result<OrchestratorResult>> {
    try {
      if (command.sourceUserId === command.destinationUserId) {
        return Result.fail('Transferência exige usuários de origem e destino distintos.');
      }

      const amount = Money256.fromString(command.amountBaseUnits, command.assetId);

      return await this.uow.execute(async (factory) => {
        const repo = factory.getFinanceRepository();

        const sourceAccRes = await repo.getOrCreateUserAccount(command.sourceUserId);
        if (sourceAccRes.isFailure) throw new Error(sourceAccRes.error || 'Conta de origem não encontrada');

        const destAccRes = await repo.getOrCreateUserAccount(command.destinationUserId);
        if (destAccRes.isFailure) throw new Error(destAccRes.error || 'Conta de destino não encontrada');

        const sourceAcc = sourceAccRes.getValue();
        if (sourceAcc.status !== 'active') {
          throw new Error('Conta de origem está inativa ou suspensa.');
        }

        const destAcc = destAccRes.getValue();
        if (destAcc.status !== 'active') {
          throw new Error('Conta de destino está inativa ou suspensa.');
        }

        const sourceAccountId = sourceAcc.id;
        const destinationAccountId = destAcc.id;

        const rawEntries = AccountingEntryPolicy.createTransferEntries({
          sourceAccountId,
          destinationAccountId,
          amount,
          description: command.description,
        });

        const ledgerEntries = rawEntries.map(
          (r) =>
            new LedgerEntry({
              accountId: String(r.accountId),
              amount: r.amount,
              type: r.entryType,
              description: r.description,
            })
        );

        const transaction = new LedgerTransaction({
          idempotencyKey: command.idempotencyKey,
          description: command.description,
          entries: ledgerEntries,
          transactionType: 'transfer',
          userId: command.sourceUserId,
        });

        if (command.requestHash !== undefined) {
          const canonicalHash = CanonicalRequestHashService.calculateHash(transaction);
          if (command.requestHash !== canonicalHash) {
            throw new Error('409 Conflict: O requestHash fornecido não coincide com o hash canônico do payload de transferência.');
          }
        }

        const orchestrator = new FinancialTransactionOrchestrator(repo);
        const orchestratorResult = await orchestrator.executePosting(transaction);
        return Result.ok(orchestratorResult);
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Falha ao realizar transferência.';
      return Result.fail(message);
    }
  }
}
