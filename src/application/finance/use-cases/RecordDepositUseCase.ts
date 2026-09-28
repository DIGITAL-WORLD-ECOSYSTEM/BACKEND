import { IUnitOfWork } from '../../ports/output/IUnitOfWork';
import { Result } from '../../../shared/kernel/Result';
import { LedgerTransaction, LedgerEntry } from '../../../domains/finance/entities/LedgerTransaction';
import { Money256 } from '../../../domains/finance/value-objects/Money256';
import { AccountingEntryPolicy } from '../../../domains/finance/policies/AccountingEntryPolicy';
import { FinancialTransactionOrchestrator, OrchestratorResult } from '../services/FinancialTransactionOrchestrator';
import { CanonicalRequestHashService } from '../services/CanonicalRequestHashService';
import {
  AccountInactiveError,
  IdempotencyConflictError,
  AccountOwnershipError,
  FinancialError,
} from '../../../domains/finance/errors/FinancialError';
import {
  freezeAuthorizationContext,
  isAuthenticAuthorizationContext,
  AuthorizationContext,
} from '../../../domains/finance/contracts/AuthorizationContext';

export interface DepositCommand {
  userId: number;
  amountBaseUnits: string;
  assetId: number;
  description: string;
  idempotencyKey: string;
  requestHash?: string;
  authContext?: AuthorizationContext;
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
        const userAcc = userAccRes.getValue();
        if (userAcc.status !== 'active') {
          throw new AccountInactiveError('Conta do Usuário está inativa ou suspensa.');
        }
        const userAccountId = userAcc.id;

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
              amount: r.amount,
              type: r.entryType,
              description: r.description,
            })
        );

        const transaction = LedgerTransaction.create({
          idempotencyKey: command.idempotencyKey,
          description: command.description,
          entries: ledgerEntries,
          transactionType: 'deposit',
          category: 'deposit',
          userId: command.userId,
        });

        if (command.requestHash !== undefined) {
          const canonicalHash = CanonicalRequestHashService.calculateHash(transaction);
          if (command.requestHash !== canonicalHash) {
            throw new IdempotencyConflictError('409 Conflict: O requestHash fornecido não coincide com o hash canônico do payload de depósito.');
          }
        }

        let depositAuthCtx: AuthorizationContext;
        if (command.authContext) {
          if (!isAuthenticAuthorizationContext(command.authContext)) {
            throw new AccountOwnershipError('Contexto de autorização fornecido é inválido ou não autenticado.');
          }
          depositAuthCtx = command.authContext;
        } else {
          // BUG-33-01: Proíbe auto-emissão arbitrária de privilégio de superusuário sem contexto autenticado
          throw new AccountOwnershipError('Depósito exige AuthorizationContext autenticado com capability finance.system.operate.');
        }

        const orchestrator = new FinancialTransactionOrchestrator(repo, factory.getOutboxRepository());
        const orchestratorResult = await orchestrator.executePosting(transaction, depositAuthCtx);
        return Result.ok(orchestratorResult);
      });
    } catch (err: unknown) {
      if (err instanceof FinancialError) {
        return Result.fail(err);
      }
      const message = err instanceof Error ? err.message : 'Falha ao realizar depósito.';
      return Result.fail(message);
    }
  }
}
