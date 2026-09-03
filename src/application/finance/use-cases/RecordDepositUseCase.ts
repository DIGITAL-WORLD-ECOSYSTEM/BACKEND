import { IUnitOfWork } from '../../ports/output/IUnitOfWork';
import { Result } from '../../../shared/kernel/Result';
import { LedgerTransaction, LedgerEntry } from '../../../domains/finance/entities/LedgerTransaction';
import { Money256 } from '../../../domains/finance/value-objects/Money256';
import { AccountingEntryPolicy } from '../../../domains/finance/policies/AccountingEntryPolicy';
import { FinancialTransactionOrchestrator, OrchestratorResult } from '../services/FinancialTransactionOrchestrator';

export interface DepositCommand {
  userId: number;
  amountBaseUnits: string;
  assetId: number;
  description: string;
  idempotencyKey: string;
  requestHash?: string;
}

export class RecordDepositUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(command: DepositCommand): Promise<Result<OrchestratorResult>> {
    try {
      const amount = Money256.fromString(command.amountBaseUnits, command.assetId);

      return await this.uow.execute(async (factory) => {
        const repo = factory.getFinanceRepository();

        const treasuryRes = await repo.getTreasuryAccount();
        if (treasuryRes.isFailure) throw new Error(treasuryRes.error || 'Conta de tesouraria não encontrada');
        const treasuryAccountId = treasuryRes.getValue().id;

        const userAccRes = await repo.getOrCreateUserAccount(command.userId);
        if (userAccRes.isFailure) throw new Error(userAccRes.error || 'Conta do usuário não encontrada');
        const userAccountId = userAccRes.getValue().id;

        const rawEntries = AccountingEntryPolicy.createDepositEntries({
          treasuryAccountId,
          userAccountId,
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
          transactionType: 'deposit',
          userId: command.userId,
        });

        const orchestrator = new FinancialTransactionOrchestrator(repo);
        const orchestratorResult = await orchestrator.executePosting(transaction);
        return Result.ok(orchestratorResult);
      });
    } catch (err: any) {
      return Result.fail(err.message || 'Falha ao realizar depósito.');
    }
  }
}
