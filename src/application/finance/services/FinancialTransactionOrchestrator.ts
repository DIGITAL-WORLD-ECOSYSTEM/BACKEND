import { IFinanceRepository } from '../../ports/output/IFinanceRepository';
import { LedgerTransaction } from '../../../domains/finance/entities/LedgerTransaction';
import {
  IdempotencyConflictError,
  IdempotencyInProgressError,
  OptimisticConcurrencyError,
  InsufficientBalanceError,
} from '../../../domains/finance/errors/FinancialError';
import { CanonicalRequestHashService } from './CanonicalRequestHashService';

export interface OrchestratorResult {
  transactionId: number;
  isReplayed: boolean;
}

function assertNever(value: never): never {
  throw new Error(`Unhandled BalanceUpdateResult case: ${value}`);
}

export class FinancialTransactionOrchestrator {
  /**
   * O Orchestrator exige um repositório transacional vinculado ao Unit of Work (BEGIN IMMEDIATE).
   */
  constructor(private readonly financeRepo: IFinanceRepository) {}

  /**
   * Executa o fluxo atômico de escrita no ledger:
   * 1. Cálculo servidor obrigatório do Hash Canônico do LedgerTransaction (P0-1).
   * 2. Validação do invariante do Ledger (mínimo de 2 lançamentos contábeis - partidas dobradas).
   * 3. Reclamação atômica de Idempotência.
   * 4. Inserção do registro pai da transação financeira em 'processing'.
   * 5. Inserção dos lançamentos contábeis imutáveis.
   * 6. Atualização dos saldos materializados via OCC delegando direção ao repositório/domínio com switch exaustivo (P0-2).
   * 7. Transição de status para 'completed'.
   * 8. Registro de evento no Outbox.
   * 9. Conclusão da Idempotência.
   */
  public async executePosting(
    transaction: LedgerTransaction
  ): Promise<OrchestratorResult> {
    // Invariante FIN-001: Uma transação financeira válida exige no mínimo 2 lançamentos contábeis (partidas dobradas)
    if (!transaction.entries || transaction.entries.length < 2) {
      throw new Error('Invariante do Ledger violado: Uma transação financeira deve conter no mínimo 2 lançamentos contábeis.');
    }

    // P0-1: O Hash de idempotência é obrigatoriamente derivado pelo servidor a partir do aggregate
    const computedHash = CanonicalRequestHashService.calculateHash(transaction);

    // 1. Claim Idempotency Key
    const claimed = await this.financeRepo.claimIdempotency(
      transaction.idempotencyKey,
      transaction.userId,
      'finance',
      computedHash
    );

    if (!claimed) {
      const existing = await this.financeRepo.getIdempotencyRecord(transaction.idempotencyKey, 'finance');
      if (!existing) {
        throw new IdempotencyInProgressError('Conflito de concorrência ao verificar chave de idempotência.');
      }

      if (existing.requestHash === computedHash) {
        if (existing.status === 'completed' && existing.transactionId) {
          return { transactionId: existing.transactionId, isReplayed: true };
        }
        throw new IdempotencyInProgressError();
      } else {
        throw new IdempotencyConflictError();
      }
    }

    // 2. Insert transaction record (status = 'processing')
    const transactionId = await this.financeRepo.insertTransaction({
      userId: transaction.userId ?? null,
      type: transaction.transactionType ?? 'adjustment',
      category: transaction.category || 'operational',
      description: transaction.description,
      status: 'processing',
      reversalOfTransactionId: transaction.reversalOfTransactionId,
      refundOfTransactionId: transaction.refundOfTransactionId,
    });

    // 3. Insert immutable ledger entries
    await this.financeRepo.insertLedgerEntries(transaction.entries, transactionId);

    // 4. Atualização de saldo materializado via OCC para cada lançamento contábil.
    // A direção (debit/credit) e regra da classe contábil são delegadas 100% à camada de domínio/repositório.
    for (const entry of transaction.entries) {
      const updateResult = await this.financeRepo.updateBalanceWithOCC(
        entry.accountId,
        entry.amount.assetId,
        entry.amount.amount,
        entry.type
      );

      switch (updateResult) {
        case 'UPDATED':
          break;
        case 'INSUFFICIENT_BALANCE':
          throw new InsufficientBalanceError(
            `saldo insuficiente para a conta #${entry.accountId} e ativo #${entry.amount.assetId}.`
          );
        case 'OCC_CONFLICT':
          throw new OptimisticConcurrencyError(
            `Falha de concorrência otimista (OCC version mismatch) para a conta #${entry.accountId}.`
          );
        default:
          assertNever(updateResult);
      }
    }

    // 5. Update transaction status to 'completed'
    await this.financeRepo.updateTransactionStatus(transactionId, 'completed');

    // 6. Persist Outbox Event
    await this.financeRepo.persistOutboxEvent('LedgerTransactionCommitted', {
      transactionId,
      idempotencyKey: transaction.idempotencyKey,
      requestHash: computedHash,
    });

    // 7. Complete Idempotency record
    await this.financeRepo.completeIdempotency(transaction.idempotencyKey, 'finance', transactionId);

    return { transactionId, isReplayed: false };
  }
}
