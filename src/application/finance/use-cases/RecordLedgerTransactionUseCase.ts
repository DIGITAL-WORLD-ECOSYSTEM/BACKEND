import { IUnitOfWork } from '../../ports/output/IUnitOfWork';
import { LedgerTransaction } from '../../../domains/finance/entities/LedgerTransaction';
import { Result } from '../../../shared/kernel/Result';
import { FinancialTransactionOrchestrator, OrchestratorResult } from '../services/FinancialTransactionOrchestrator';
import { CanonicalRequestHashService } from '../services/CanonicalRequestHashService';

export class RecordLedgerTransactionUseCase {
  constructor(private readonly unitOfWork: IUnitOfWork) {}

  /**
   * P0: Single Financial Posting Authority.
   * Única porta de entrada autorizada na camada de aplicação para efetuar escrita no ledger.
   */
  async execute(
    transaction: LedgerTransaction,
    customRequestHash?: string
  ): Promise<Result<OrchestratorResult>> {
    try {
      const canonicalHash = CanonicalRequestHashService.calculateHash(transaction);
      // Se um hash customizado for fornecido, deve coincidir com o hash canônico calculado para evitar payload falsificado
      if (customRequestHash && customRequestHash !== canonicalHash) {
        return Result.fail('409 Conflict: O requestHash fornecido não coincide com o hash canônico do payload (FIN-008).');
      }

      return await this.unitOfWork.execute(async (factory) => {
        const repo = factory.getFinanceRepository();
        const orchestrator = new FinancialTransactionOrchestrator(repo);
        const orchestratorResult = await orchestrator.executePosting(transaction, canonicalHash);
        return Result.ok(orchestratorResult);
      });
    } catch (err: any) {
      return Result.fail(err.message || 'Falha ao processar lançamento no ledger financeiro.');
    }
  }
}
