import { PostingPlan } from '../../../domains/finance/contracts/PostingPlan';
import { PostingSession } from '../../../domains/finance/contracts/PostingSession';
import { Result } from '../../../shared/kernel/Result';

export interface PostingExecutionResult {
  readonly transactionId: number;
  readonly planId: string;
  readonly executedAt: Date;
}

export interface IPostingExecutor {
  execute(plan: PostingPlan, session: PostingSession): Promise<Result<PostingExecutionResult>>;
}
