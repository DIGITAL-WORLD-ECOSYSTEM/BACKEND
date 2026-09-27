import { IPostingExecutor, PostingExecutionResult } from '../../ports/output/IPostingExecutor';
import { PostingPlan, POSTING_PLAN_SEAL, isAuthenticPostingPlan } from '../../../domains/finance/contracts/PostingPlan';
import { PostingSession } from '../../../domains/finance/contracts/PostingSession';
import { Result } from '../../../shared/kernel/Result';
import { MAX_UINT256 } from '../../../domains/finance/constants/FinancialLimits';

/**
 * Padrão canônico decimal para quantias e novos saldos (compilado em escopo de módulo).
 */
const CANONICAL_DECIMAL_PATTERN = /^(0|[1-9][0-9]*)$/;

export class PostingAuthority {
  constructor(private readonly executor: IPostingExecutor) {
    if (!executor) {
      throw new Error('IPostingExecutor é obrigatório para PostingAuthority.');
    }
    Object.freeze(this);
  }

  /**
   * Ponto Único Soberano de Commit Contábil (Gate 0).
   *
   * Garante que toda e qualquer mutação física no ledger execute através
   * do contrato estático do PostingPlan validado e autenticado, sob uma PostingSession legítima.
   */
  public async commit(
    plan: PostingPlan,
    session: PostingSession
  ): Promise<Result<PostingExecutionResult>> {
    // 1. Validação estrita de autenticidade, unicidade e aquisição atômica da PostingSession (Gate 0 / Anti-TOCTOU)
    if (!session || typeof session.tryAcquireForCommit !== 'function' || !session.tryAcquireForCommit()) {
      return Result.fail('PostingSession obrigatória, autêntica, válida e não-consumida para commit contábil.');
    }

    const failWithRelease = (message: string): Result<PostingExecutionResult> => {
      session.releaseAcquisition?.();
      return Result.fail(message);
    };

    // 2. Validação de presença do plano
    if (!plan) {
      return failWithRelease('PostingPlan obrigatório para commit contábil.');
    }

    // 3. Validação Criptográfica de Origem do Plano (P0-07: Inviolabilidade do PostingPlan)
    if (!isAuthenticPostingPlan(plan)) {
      return failWithRelease(
        'PostingPlan forjado ou não-autenticado: ausência do selo POSTING_PLAN_SEAL emitido por PostingPlanBuilder ou ausência no catálogo autêntico (WeakSet).'
      );
    }

    // 4. Validação de Decisão de Autorização Soberana de Custódia (P0-10)
    if (!plan.authorizationDecision || !plan.authorizationDecision.allowed) {
      const reason = !plan.authorizationDecision
        ? 'Decisão de autorização ausente'
        : (!plan.authorizationDecision.allowed ? plan.authorizationDecision.reason : 'Não autorizada');
      return failWithRelease(`PostingPlan rejeitado por falta de autorização de custódia: ${reason}`);
    }

    // 5. Validação de Fencing Mandatório P0 (leaseOwner, leaseGeneration e requestHash)
    if (!plan.leaseOwner || typeof plan.leaseOwner !== 'string' || plan.leaseOwner.trim().length === 0) {
      return failWithRelease('PostingPlan viola invariante P0: leaseOwner obrigatório para fencing de concorrência.');
    }

    if (typeof plan.leaseGeneration !== 'number' || plan.leaseGeneration < 0) {
      return failWithRelease('PostingPlan viola invariante P0: leaseGeneration obrigatório para fencing de concorrência.');
    }

    if (!plan.requestHash || typeof plan.requestHash !== 'string' || plan.requestHash.trim().length === 0) {
      return failWithRelease('PostingPlan viola invariante P0: requestHash criptográfico soberano obrigatório.');
    }

    // 6. Validação estrutural de integridade do plano e vinculação de identidades
    if (!plan.transactionRecord || plan.transactionRecord.id !== plan.transactionId) {
      return failWithRelease('PostingPlan inconsistente: transactionRecord.id diverge do transactionId do plano.');
    }

    if (
      !plan.outboxEvent ||
      (plan.outboxEvent.aggregateId !== String(plan.transactionId) &&
        plan.outboxEvent.aggregateId !== `tx_${plan.transactionId}`)
    ) {
      return failWithRelease('PostingPlan inconsistente: outboxEvent.aggregateId diverge do transactionId do plano.');
    }

    if (!plan.ledgerEntries || plan.ledgerEntries.length < 2) {
      return failWithRelease('PostingPlan inválido: exige no mínimo 2 pernas contábeis.');
    }

    // 7. Validação das pernas contábeis: vinculação de transactionId, ordinais 1..N e quantias
    const netByAsset = new Map<number, bigint>();

    for (let i = 0; i < plan.ledgerEntries.length; i++) {
      const entry = plan.ledgerEntries[i];

      if (entry.transactionId !== plan.transactionId) {
        return failWithRelease(`PostingPlan corrompido: perna contábil #${i} vinculada a transação ${entry.transactionId} em vez de ${plan.transactionId}.`);
      }

      if (entry.entryOrdinal !== i + 1) {
        return failWithRelease(`PostingPlan corrompido: ordinal da perna contábil #${i} inválido (${entry.entryOrdinal}, esperado ${i + 1}).`);
      }

      if (!CANONICAL_DECIMAL_PATTERN.test(entry.amountBaseUnits)) {
        return failWithRelease(`PostingPlan com formato decimal inválido na perna #${entry.entryOrdinal}: '${entry.amountBaseUnits}'.`);
      }

      const amt = BigInt(entry.amountBaseUnits);
      if (amt <= 0n || amt > MAX_UINT256) {
        return failWithRelease(`PostingPlan com quantia fora dos limites permitidos na perna #${entry.entryOrdinal}: ${entry.amountBaseUnits}.`);
      }

      const currentNet = netByAsset.get(entry.assetId) ?? 0n;
      netByAsset.set(entry.assetId, currentNet + (entry.direction === 'debit' ? amt : -amt));
    }

    // 8. Validação do Invariante FIN-001 de partidas dobradas por ativo
    for (const [assetId, net] of netByAsset) {
      if (net !== 0n) {
        return failWithRelease(`PostingPlan com partidas dobradas desbalanceadas no ativo #${assetId} (diferença: ${net.toString()}).`);
      }
    }

    // 9. Validação das mutações de saldo (P0-08)
    for (const mutation of plan.balanceMutations) {
      if (!Number.isSafeInteger(mutation.accountId) || mutation.accountId <= 0) {
        return failWithRelease(`PostingPlan com mutation em accountId inválido (${mutation.accountId}).`);
      }
      if (!Number.isSafeInteger(mutation.assetId) || mutation.assetId <= 0) {
        return failWithRelease(`PostingPlan com mutation em assetId inválido (${mutation.assetId}).`);
      }
      if (!CANONICAL_DECIMAL_PATTERN.test(mutation.newAvailableBaseUnits)) {
        return failWithRelease(`PostingPlan com novo saldo em formato decimal inválido na conta #${mutation.accountId}.`);
      }
      const newBalBigInt = BigInt(mutation.newAvailableBaseUnits);
      if (newBalBigInt < 0n || newBalBigInt > MAX_UINT256) {
        return failWithRelease(`PostingPlan com novo saldo fora dos limites uint256 na conta #${mutation.accountId}.`);
      }
    }

    try {
      const execResult = await this.executor.execute(plan, session);
      if (execResult.isFailure) {
        session.releaseAcquisition?.();
      }
      return execResult;
    } catch (err) {
      session.releaseAcquisition?.();
      throw err;
    }
  }
}
