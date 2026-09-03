import { IUnitOfWork } from '../../ports/output/IUnitOfWork';
import { Result } from '../../../shared/kernel/Result';
import { LedgerTransaction, LedgerEntry } from '../../../domains/finance/entities/LedgerTransaction';
import { Money256 } from '../../../domains/finance/value-objects/Money256';
import { AccountingEntryPolicy } from '../../../domains/finance/policies/AccountingEntryPolicy';
import { FinancialTransactionOrchestrator, OrchestratorResult } from '../services/FinancialTransactionOrchestrator';

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

        const sourceAccountId = sourceAccRes.getValue().id;
        const destinationAccountId = destAccRes.getValue().id;

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
              amount: r.amount as any,
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

        const orchestrator = new FinancialTransactionOrchestrator(repo);
        const orchestratorResult = await orchestrator.executePosting(transaction);
        return Result.ok(orchestratorResult);
      });
    } catch (err: any) {
      return Result.fail(err.message || 'Falha ao realizar transferência.');
    }
  }
}
