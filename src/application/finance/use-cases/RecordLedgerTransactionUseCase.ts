import { IUnitOfWork } from '../../ports/output/IUnitOfWork';
import { LedgerTransaction } from '../../../domains/finance/entities/LedgerTransaction';
import { Result } from '../../../shared/kernel/Result';
import { FinancialTransactionOrchestrator, OrchestratorResult } from '../services/FinancialTransactionOrchestrator';
import { CanonicalRequestHashService } from '../services/CanonicalRequestHashService';

export class RecordLedgerTransactionUseCase {
  constructor(private readonly unitOfWork: IUnitOfWork) {}

  /**
   * Application entry point for generic ledger posting.
   * Valida a integridade do hash do cliente (se fornecido) e delega a execução
   * transacional para a Autoridade Física Central (FinancialTransactionOrchestrator).
   */
  async execute(
    transaction: LedgerTransaction,
    providedRequestHash?: string
  ): Promise<Result<OrchestratorResult>> {
    try {
      const canonicalHash = CanonicalRequestHashService.calculateHash(transaction);
      // Se um hash do cliente for fornecido, deve coincidir com o hash canônico calculado para evitar payload falsificado
      if (providedRequestHash && providedRequestHash !== canonicalHash) {
        return Result.fail('409 Conflict: O requestHash fornecido não coincide com o hash canônico do payload (FIN-008).');
      }

      return await this.unitOfWork.execute(async (factory) => {
        const repo = factory.getFinanceRepository();
        const orchestrator = new FinancialTransactionOrchestrator(repo, factory.getOutboxRepository());
        const orchestratorResult = await orchestrator.executePosting(transaction);
        return Result.ok(orchestratorResult);
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Falha ao processar lançamento no ledger financeiro.';
      return Result.fail(message);
    }
  }
}
