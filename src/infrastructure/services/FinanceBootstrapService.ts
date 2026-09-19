import { IUnitOfWork } from '../../application/ports/output/IUnitOfWork';
import { Result } from '../../shared/kernel/Result';
import { LedgerTransaction, LedgerEntry } from '../../domains/finance/entities/LedgerTransaction';
import { Money256 } from '../../domains/finance/value-objects/Money256';
import { FinancialTransactionOrchestrator } from '../../application/finance/services/FinancialTransactionOrchestrator';
import {
  TreasuryBootstrapOptions,
  TreasuryBootstrapResult,
} from '../../application/ports/output/IFinanceRepository';

export type { TreasuryBootstrapOptions, TreasuryBootstrapResult };

export class FinanceBootstrapService {
  /**
   * Provisiona a infraestrutura básica de contas sistêmicas do Finance Core:
   * 1. Ativo Padrão (ex: BRL, USD, USDT)
   * 2. Contas Sistêmicas com userId = NULL (cumprindo ownerRuleCheck e FIN-019).
   * 3. Lançamento contábil de abertura atômico via FinancialTransactionOrchestrator.
   *
   * Todo o processo executa sob um único Unit of Work (uma única transação de escrita).
   */
  static async seedSystemAccounts(
    uow: IUnitOfWork,
    options: TreasuryBootstrapOptions = {}
  ): Promise<Result<TreasuryBootstrapResult>> {
    return uow.execute(async (factory) => {
      const financeRepo = factory.getFinanceRepository();
      const outboxRepo = factory.getOutboxRepository();

      // 1. Provisiona infraestrutura (ativo, contas sistêmicas e saldos zerados)
      const infraRes = await financeRepo.provisionTreasuryInfrastructure(options);
      if (infraRes.isFailure) {
        return Result.fail<TreasuryBootstrapResult>(
          infraRes.errorObject || infraRes.error || 'Falha ao provisionar infraestrutura contábil sistêmica.'
        );
      }
      const infra = infraRes.getValue();

      // 2. Se houver saldo inicial especificado (> 0n), executa lançamento contábil via Orchestrator
      const initialBalance = options.initialBalanceBaseUnits ?? 0n;
      if (initialBalance > 0n) {
        const openingTransaction = LedgerTransaction.create({
          idempotencyKey: `finance:bootstrap:opening-balance:${infra.treasuryAccountId}:${infra.assetId}`,
          description: 'Genesis Opening Balance Equity Allocation',
          transactionType: 'adjustment',
          category: 'operational',
          entries: [
            new LedgerEntry({
              accountId: String(infra.treasuryAccountId),
              amount: Money256.fromBigInt(initialBalance, infra.assetId),
              type: 'debit',
            }),
            new LedgerEntry({
              accountId: String(infra.openingEquityAccountId),
              amount: Money256.fromBigInt(initialBalance, infra.assetId),
              type: 'credit',
            }),
          ],
        });

        const orchestrator = new FinancialTransactionOrchestrator(financeRepo, outboxRepo);
        await orchestrator.executePosting(openingTransaction);
      }

      return Result.ok<TreasuryBootstrapResult>(infra);
    });
  }
}
