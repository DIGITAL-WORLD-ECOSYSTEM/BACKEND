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
    // 1. Validação de presença do plano
    if (!plan) {
      return Result.fail('PostingPlan obrigatório para commit contábil.');
    }

    // 2. Validação estrita de autenticidade da PostingSession (Capability Inviolável)
    if (!session || typeof session.isValid !== 'function' || !session.isValid()) {
      return Result.fail('PostingSession obrigatória, autêntica e válida para commit contábil.');
    }

    // 3. Validação de Decisão de Autorização Soberana (DENIED -> Bloqueio imediato)
    if (!plan.authorizationDecision || !plan.authorizationDecision.allowed) {
      const reason = !plan.authorizationDecision
        ? 'Decisão de autorização ausente'
        : (!plan.authorizationDecision.allowed ? plan.authorizationDecision.reason : 'Não autorizada');
      return Result.fail(`PostingPlan rejeitado por falta de autorização de custódia: ${reason}`);
    }

    // 4. Validação de Fencing Mandatório P0 (leaseOwner e leaseGeneration)
    if (!plan.leaseOwner || typeof plan.leaseOwner !== 'string' || plan.leaseOwner.trim().length === 0) {
      return Result.fail('PostingPlan viola invariante P0: leaseOwner obrigatório para fencing de concorrência.');
    }

    if (typeof plan.leaseGeneration !== 'number' || plan.leaseGeneration < 0) {
      return Result.fail('PostingPlan viola invariante P0: leaseGeneration obrigatório para fencing de concorrência.');
    }

    // 5. Validação estrutural de integridade do plano
    if (!plan.transactionRecord || !plan.transactionRecord.id) {
      return Result.fail('PostingPlan incompleto: transactionRecord determinístico obrigatório.');
    }

    if (!plan.outboxEvent || !plan.outboxEvent.eventId) {
      return Result.fail('PostingPlan incompleto: outboxEvent atômico obrigatório.');
    }

    if (!plan.ledgerEntries || plan.ledgerEntries.length < 2) {
      return Result.fail('PostingPlan inválido: exige no mínimo 2 pernas contábeis.');
    }

    // 6. Validação do Invariante FIN-001 de partidas dobradas por ativo
    const netByAsset = new Map<number, bigint>();
    for (const entry of plan.ledgerEntries) {
      const current = netByAsset.get(entry.assetId) ?? 0n;
      const amt = BigInt(entry.amountBaseUnits);
      netByAsset.set(entry.assetId, current + (entry.direction === 'debit' ? amt : -amt));
    }
    for (const [assetId, net] of netByAsset) {
      if (net !== 0n) {
        return Result.fail(`PostingPlan com partidas dobradas desbalanceadas no ativo #${assetId} (diferença: ${net.toString()}).`);
      }
    }

    return await this.executor.execute(plan, session);
  }
}
