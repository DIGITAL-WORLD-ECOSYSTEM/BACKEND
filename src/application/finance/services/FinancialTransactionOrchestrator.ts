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

export class FinancialTransactionOrchestrator {
  /**
   * O Orchestrator exige um repositório transacional vinculado ao Unit of Work (BEGIN IMMEDIATE).
   */
  constructor(private readonly financeRepo: IFinanceRepository) {}

  /**
   * Executa o fluxo atômico de escrita no ledger:
   * 1. Resolução do Hash Canônico de Idempotência (P0-1).
   * 2. Reclamação atômica de Idempotência.
   * 3. Inserção do registro pai da transação financeira em 'processing'.
   * 4. Inserção dos lançamentos contábeis imutáveis.
   * 5. Atualização dos saldos materializados com discriminação estrita de erro (P0-2: InsufficientBalanceError vs OptimisticConcurrencyError).
   * 6. Transição de status para 'completed'.
   * 7. Registro de evento no Outbox.
   * 8. Conclusão da Idempotência.
   */
  public async executePosting(
    transaction: LedgerTransaction,
    requestHash?: string
  ): Promise<OrchestratorResult> {
    // P0-1: O Hash de idempotência é derivado pelo servidor (do DTO canônico ou do aggregate LedgerTransaction)
    const computedHash = requestHash || CanonicalRequestHashService.calculateHash(transaction);

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

    // 4. Update materialized balances with discriminated OCC & balance checks (P0-2)
    for (const entry of transaction.entries) {
      const updateResult = await this.financeRepo.updateBalanceWithOCC(
        entry.accountId,
        String(entry.amount.assetId),
        entry.amount.amount,
        entry.type
      );

      if (updateResult === 'INSUFFICIENT_BALANCE') {
        throw new InsufficientBalanceError(
          `saldo insuficiente para a conta #${entry.accountId} e ativo #${entry.amount.assetId}.`
        );
      }

      if (updateResult === 'OCC_CONFLICT' || updateResult === false) {
        throw new OptimisticConcurrencyError(
          `Falha de concorrência otimista (OCC version mismatch) para a conta #${entry.accountId}.`
        );
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
