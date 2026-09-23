import { IPostingExecutor, PostingExecutionResult } from '../../ports/output/IPostingExecutor';
import { PostingPlan } from '../../../domains/finance/contracts/PostingPlan';
import { PostingSession } from '../../../domains/finance/contracts/PostingSession';
import { Result } from '../../../shared/kernel/Result';

export class PostingAuthority {
  constructor(private readonly executor: IPostingExecutor) {
    if (!executor) {
      throw new Error('IPostingExecutor é obrigatório para PostingAuthority.');
    }
  }

  /**
   * Ponto Único Soberano de Commit Contábil (Gate 0).
   *
   * Garante que toda e qualquer mutação física no ledger execute através
   * do contrato estático do PostingPlan validado, sob uma PostingSession autorizada.
   */
  public async commit(
    plan: PostingPlan,
    session: PostingSession
  ): Promise<Result<PostingExecutionResult>> {
    if (!plan) {
      return Result.fail('PostingPlan obrigatório para commit contábil.');
    }
    if (!session) {
      return Result.fail('PostingSession obrigatória para commit contábil.');
    }
    return await this.executor.execute(plan, session);
  }
}
