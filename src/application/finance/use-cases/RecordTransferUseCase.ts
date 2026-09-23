import { IUnitOfWork } from '../../ports/output/IUnitOfWork';
import { Result } from '../../../shared/kernel/Result';
import { LedgerTransaction, LedgerEntry } from '../../../domains/finance/entities/LedgerTransaction';
import { Money256 } from '../../../domains/finance/value-objects/Money256';
import { AccountingEntryPolicy } from '../../../domains/finance/policies/AccountingEntryPolicy';
import { FinancialTransactionOrchestrator, OrchestratorResult } from '../services/FinancialTransactionOrchestrator';
import { CanonicalRequestHashService } from '../services/CanonicalRequestHashService';
import {
  CustodyAuthorizationPolicy,
  AuthorizationContext,
  CustodyOperationSpec,
} from '../../../domains/finance/contracts/AuthorizationContext';

export interface TransferCommand {
  sourceUserId: number;
  destinationUserId: number;
  amountBaseUnits: string;
  assetId: number;
  description: string;
  idempotencyKey: string;
  requestHash?: string;
  // Forensic & Authorization fields (Gate 4 & Gate 10)
  authenticatedUserId?: number;
  actorUserId?: number;
  authorizedByUserId?: number;
  capabilities?: string[];
  roles?: string[];
  delegatedForUserId?: number | null;
  sourceType?: string;
  sourceId?: string;
  correlationId?: string;
  scope?: string;
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

        if (sourceAccountId === destinationAccountId) {
          throw new Error('Auto-transferência para a mesma conta é proibida.');
        }

        // 1. Custody & Authorization Gate (Gate 4)
        const principalId = command.actorUserId ?? command.authenticatedUserId ?? command.sourceUserId;
        const authCtx: AuthorizationContext = {
          principalId,
          principalType: 'user',
          capabilities: command.capabilities ?? (command.roles?.includes('admin') ? ['admin', 'finance.custody.debit'] : []),
          delegatedForUserId: command.delegatedForUserId ?? null,
          correlationId: command.correlationId ?? `corr_tx_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
        };

        const opSpec: CustodyOperationSpec = {
          operationType: 'transfer',
          sourceAccountId,
          sourceAccountOwnerId: sourceAcc.userId,
          destinationAccountId,
          destinationAccountOwnerId: destAcc.userId,
          assetId: command.assetId,
          amountBaseUnits: amount.amount,
        };

        const authDecision = CustodyAuthorizationPolicy.canDebitSourceAccount(authCtx, opSpec);
        if (!authDecision.allowed) {
          throw new Error(`403 Forbidden: Autorização de custódia negada: ${authDecision.reason}`);
        }

        // 2. Accounting Leg Generation
        const rawEntries = AccountingEntryPolicy.createTransferEntries({
          sourceAccountId,
          destinationAccountId,
          amount,
          description: command.description,
        });

        const ledgerEntries: LedgerEntry[] = rawEntries.map(
          (r) =>
            new LedgerEntry({
              accountId: String(r.accountId),
              amount: r.amount,
              type: r.entryType,
              description: r.description,
            })
        );

        // 3. Deterministic Idempotency & Forensic Lineage (Gate 8 & Gate 10)
        const scope = command.scope ?? 'finance';

        const transaction = LedgerTransaction.create({
          idempotencyKey: command.idempotencyKey,
          description: command.description,
          entries: ledgerEntries,
          transactionType: 'transfer',
          category: 'operational',
          userId: command.sourceUserId,
          actorUserId: authDecision.actorUserId,
          authorizedByUserId: authDecision.authorizedByUserId,
          sourceType: (command.sourceType as any) ?? null,
          sourceId: command.sourceId ?? String(sourceAccountId),
          correlationId: authCtx.correlationId,
          scope,
        });

        if (command.requestHash !== undefined) {
          const canonicalHash = CanonicalRequestHashService.calculateHash(transaction);
          if (command.requestHash !== canonicalHash) {
            throw new Error('409 Conflict: O requestHash fornecido não coincide com o hash canônico do payload de transferência.');
          }
        }

        const orchestrator = new FinancialTransactionOrchestrator(repo, factory.getOutboxRepository());
        const orchestratorResult = await orchestrator.executePosting(transaction);
        return Result.ok(orchestratorResult);
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Falha ao realizar transferência.';
      return Result.fail(message);
    }
  }
}
