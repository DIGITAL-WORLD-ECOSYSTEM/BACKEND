import { IUnitOfWork } from '../../ports/output/IUnitOfWork';
import { Result } from '../../../shared/kernel/Result';
import { LedgerTransaction, LedgerEntry } from '../../../domains/finance/entities/LedgerTransaction';
import { Money256, parsePositiveSafeIntegerId } from '../../../domains/finance/value-objects/Money256';
import { AccountingEntryPolicy, RawLedgerEntrySpec } from '../../../domains/finance/policies/AccountingEntryPolicy';
import { FinancialTransactionOrchestrator, OrchestratorResult } from '../services/FinancialTransactionOrchestrator';
import { CanonicalRequestHashService } from '../services/CanonicalRequestHashService';
import { FinancialError } from '../../../domains/finance/errors/FinancialError';
import { FinancialTransactionCategory } from '../../ports/output/IFinanceRepository';

export interface RecordTreasuryTransactionDTO {
  userId?: number | null;
  type: 'deposit' | 'withdrawal' | 'transfer' | 'payment' | 'refund' | 'fee' | 'reward' | 'yield' | 'conversion' | 'adjustment';
  direction: 'INBOUND' | 'OUTBOUND';
  category?: FinancialTransactionCategory | string;
  description: string;
  amountBaseUnits: string;
  assetId: number;
  idempotencyKey: string;
  requestHash?: string;
  refundOfTransactionId?: number;
}

export interface RecordTreasuryTransactionResult {
  transactionId?: number;
  isReplayed: boolean;
}

export class UnsupportedFinancialOperationError extends FinancialError {
  constructor(message: string) {
    super(message, 'UNSUPPORTED_FINANCIAL_OPERATION', false, 400);
  }
}

export class InvalidRefundAmountError extends FinancialError {
  constructor(message: string) {
    super(message, 'INVALID_REFUND_AMOUNT', false, 422);
  }
}

const USER_REQUIRED_OPERATIONS = ['payment', 'fee', 'reward', 'yield'];

export class RecordTreasuryTransactionUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(dto: RecordTreasuryTransactionDTO): Promise<Result<RecordTreasuryTransactionResult>> {
    // 1. Structural DTO Field Validation
    if (!dto.description || !dto.amountBaseUnits || !dto.idempotencyKey || dto.assetId === undefined || !dto.direction || !dto.type) {
      return Result.fail<RecordTreasuryTransactionResult>('Descrição, valor, assetId, direction, type e idempotencyKey são obrigatórios.');
    }

    const description = dto.description.trim();
    if (description.length < 3 || description.length > 500) {
      return Result.fail<RecordTreasuryTransactionResult>('A descrição deve conter entre 3 e 500 caracteres.');
    }

    const idempotencyKey = dto.idempotencyKey.trim();
    if (idempotencyKey.length === 0 || idempotencyKey.length > 255) {
      return Result.fail<RecordTreasuryTransactionResult>('A chave de idempotência deve ter entre 1 e 255 caracteres.');
    }

    if (dto.requestHash !== undefined) {
      if (!/^[a-f0-9]{64}$/i.test(dto.requestHash)) {
        return Result.fail<RecordTreasuryTransactionResult>('Formato de requestHash inválido. Deve ser uma string SHA-256 hexadecimal de 64 caracteres.');
      }
    }

    try {
      // 2. Value Object & Asset ID Parsing
      const parsedAssetId = parsePositiveSafeIntegerId(dto.assetId, 'assetId');
      const amountMoney = Money256.fromString(dto.amountBaseUnits, parsedAssetId);

      if (amountMoney.isZero()) {
        return Result.fail<RecordTreasuryTransactionResult>('O valor da transação deve ser estritamente maior que zero.');
      }

      // 3. User Ownership & Required User ID Check
      let parsedUserId: number | null = null;
      if (dto.userId !== null && dto.userId !== undefined) {
        parsedUserId = parsePositiveSafeIntegerId(dto.userId, 'userId');
      }

      if (USER_REQUIRED_OPERATIONS.includes(dto.type) && parsedUserId === null) {
        return Result.fail<RecordTreasuryTransactionResult>(`Operação do tipo '${dto.type}' exige obrigatoriamente um userId de usuário final.`);
      }

      // 4. Direction Rules per Operation
      const inboundOnly = ['deposit', 'yield', 'reward'];
      const outboundOnly = ['withdrawal', 'payment', 'fee'];

      if (dto.direction === 'INBOUND' && outboundOnly.includes(dto.type)) {
        return Result.fail<RecordTreasuryTransactionResult>(`Transação do tipo '${dto.type}' não pode ter direção INBOUND.`);
      }
      if (dto.direction === 'OUTBOUND' && inboundOnly.includes(dto.type)) {
        return Result.fail<RecordTreasuryTransactionResult>(`Transação do tipo '${dto.type}' não pode ter direção OUTBOUND.`);
      }

      // 5. Category Validation
      const category: string = dto.category ? String(dto.category).toLowerCase().trim() : 'operational';

      // 6. Compute Canonical Request Hash over Request DTO payload
      const canonicalPayload = {
        amountBaseUnits: dto.amountBaseUnits,
        assetId: parsedAssetId,
        category,
        description,
        direction: dto.direction,
        refundOfTransactionId: dto.refundOfTransactionId ?? null,
        type: dto.type,
        userId: parsedUserId,
      };
      const canonicalHash = CanonicalRequestHashService.calculateHash(canonicalPayload);

      if (dto.requestHash !== undefined && dto.requestHash !== canonicalHash) {
        return Result.fail<RecordTreasuryTransactionResult>('409 Conflict: O requestHash fornecido não coincide com o hash canônico do payload.');
      }

      // 7. Atomic Unit of Work Execution
      return await this.uow.execute(async (factory) => {
        const financeRepo = factory.getFinanceRepository();

        // 7a. Resolve Treasury Account
        const treasuryRes = await financeRepo.getTreasuryAccount();
        if (treasuryRes.isFailure) return Result.fail<RecordTreasuryTransactionResult>(treasuryRes.error || 'Erro ao resolver conta de Tesouraria');
        const treasuryAcc = treasuryRes.getValue();
        if (treasuryAcc.status !== 'active') return Result.fail<RecordTreasuryTransactionResult>('Conta de Tesouraria está inativa ou suspensa.');
        const treasuryAccountId = treasuryAcc.id;

        // 7b. Resolve User Account
        let userAccountId: number;
        if (parsedUserId !== null) {
          const userAccRes = await financeRepo.getOrCreateUserAccount(parsedUserId);
          if (userAccRes.isFailure) return Result.fail<RecordTreasuryTransactionResult>(userAccRes.error || 'Erro ao resolver conta do Usuário');
          const userAcc = userAccRes.getValue();
          if (userAcc.status !== 'active') return Result.fail<RecordTreasuryTransactionResult>('Conta do Usuário está inativa ou suspensa.');
          userAccountId = userAcc.id;
        } else {
          // If no userId, use Operating Account
          const sysOpRes = await financeRepo.getSystemAccount('operating');
          if (sysOpRes.isFailure) return Result.fail<RecordTreasuryTransactionResult>(sysOpRes.error || 'Erro ao resolver conta operacional do sistema');
          userAccountId = sysOpRes.getValue().id;
        }

        let rawEntries: RawLedgerEntrySpec[];

        // 8. Exhaustive Switch Dispatch per Operation Type
        switch (dto.type) {
          case 'deposit': {
            rawEntries = AccountingEntryPolicy.createDepositEntries({
              treasuryAccountId,
              userAccountId,
              amount: amountMoney,
              description,
            });
            break;
          }
          case 'withdrawal': {
            rawEntries = AccountingEntryPolicy.createWithdrawalEntries({
              treasuryAccountId,
              userAccountId,
              amount: amountMoney,
              description,
            });
            break;
          }
          case 'payment': {
            const sysRevenueRes = await financeRepo.getSystemAccount('payment_revenue');
            if (sysRevenueRes.isFailure) return Result.fail<RecordTreasuryTransactionResult>(sysRevenueRes.error);
            rawEntries = AccountingEntryPolicy.createPaymentEntries({
              userAccountId,
              paymentRevenueAccountId: sysRevenueRes.getValue().id,
              amount: amountMoney,
              description,
            });
            break;
          }
          case 'refund': {
            if (!dto.refundOfTransactionId) {
              return Result.fail<RecordTreasuryTransactionResult>('Reembolso (refund) exige o ID da transação original (refundOfTransactionId).');
            }
            const origTxId = parsePositiveSafeIntegerId(dto.refundOfTransactionId, 'refundOfTransactionId');

            // Fetch original transaction within same UoW boundary
            const origTxRes = await financeRepo.getTransactionById(origTxId);
            if (origTxRes.isFailure) return Result.fail<RecordTreasuryTransactionResult>(origTxRes.error);
            const origTx = origTxRes.getValue();

            if (origTx.status !== 'completed') {
              return Result.fail<RecordTreasuryTransactionResult>(`Reembolso rejeitado: Transação original #${origTxId} não está em estado 'completed' (status atual: '${origTx.status}').`);
            }
            if (origTx.type !== 'payment') {
              return Result.fail<RecordTreasuryTransactionResult>(`Reembolso rejeitado: Apenas transações do tipo 'payment' podem ser reembolsadas.`);
            }

            // Refund Limit & Concurrency Protection Check
            const prevRefundsTotal = await financeRepo.getRefundsTotalForTransaction(origTxId);

            // Get original payment entries to verify original payment amount
            const origEntriesRes = await financeRepo.getTransactionEntries(origTxId);
            if (origEntriesRes.isFailure) return Result.fail<RecordTreasuryTransactionResult>('Erro ao buscar lançamentos da transação original para refund.');

            const paymentCreditEntry = origEntriesRes.getValue().find((e) => e.direction === 'credit');
            if (!paymentCreditEntry) return Result.fail<RecordTreasuryTransactionResult>('Lançamento original de pagamento não encontrado.');
            const originalPaymentAmount = BigInt(paymentCreditEntry.amountBaseUnits);

            const requestedRefundAmount = amountMoney.toBigInt();
            if (prevRefundsTotal + requestedRefundAmount > originalPaymentAmount) {
              const remaining = originalPaymentAmount > prevRefundsTotal ? originalPaymentAmount - prevRefundsTotal : 0n;
              return Result.fail<RecordTreasuryTransactionResult>(
                `Valor do reembolso (${requestedRefundAmount.toString()}) excede o saldo reembolsável restante (${remaining.toString()}) da transação original #${origTxId}.`
              );
            }

            const sysRefundExpRes = await financeRepo.getSystemAccount('refund_expense');
            if (sysRefundExpRes.isFailure) return Result.fail<RecordTreasuryTransactionResult>(sysRefundExpRes.error);
            rawEntries = AccountingEntryPolicy.createRefundEntries({
              refundExpenseAccountId: sysRefundExpRes.getValue().id,
              userAccountId,
              amount: amountMoney,
              description,
            });
            break;
          }
          case 'fee': {
            const sysFeeRes = await financeRepo.getSystemAccount('fees');
            if (sysFeeRes.isFailure) return Result.fail<RecordTreasuryTransactionResult>(sysFeeRes.error);
            rawEntries = AccountingEntryPolicy.createFeeEntries({
              userAccountId,
              feeAccountId: sysFeeRes.getValue().id,
              amount: amountMoney,
              description,
            });
            break;
          }
          case 'reward': {
            const sysRewardExpRes = await financeRepo.getSystemAccount('reward_expense');
            if (sysRewardExpRes.isFailure) return Result.fail<RecordTreasuryTransactionResult>(sysRewardExpRes.error);
            rawEntries = AccountingEntryPolicy.createRewardEntries({
              rewardExpenseAccountId: sysRewardExpRes.getValue().id,
              userAccountId,
              amount: amountMoney,
              description,
            });
            break;
          }
          case 'yield': {
            const sysYieldExpRes = await financeRepo.getSystemAccount('yield_expense');
            if (sysYieldExpRes.isFailure) return Result.fail<RecordTreasuryTransactionResult>(sysYieldExpRes.error);
            rawEntries = AccountingEntryPolicy.createYieldEntries({
              yieldExpenseAccountId: sysYieldExpRes.getValue().id,
              userAccountId,
              amount: amountMoney,
              description,
            });
            break;
          }
          case 'adjustment': {
            rawEntries = AccountingEntryPolicy.createAdjustmentEntries({
              debitAccountId: dto.direction === 'INBOUND' ? treasuryAccountId : userAccountId,
              creditAccountId: dto.direction === 'INBOUND' ? userAccountId : treasuryAccountId,
              amount: amountMoney,
              reason: description,
            });
            break;
          }
          case 'transfer': {
            rawEntries = AccountingEntryPolicy.createTransferEntries({
              sourceAccountId: dto.direction === 'OUTBOUND' ? userAccountId : treasuryAccountId,
              destinationAccountId: dto.direction === 'OUTBOUND' ? treasuryAccountId : userAccountId,
              amount: amountMoney,
              description,
            });
            break;
          }
          case 'conversion': {
            return Result.fail<RecordTreasuryTransactionResult>('Operação de conversão (conversion) exige Use Case especializado de troca de ativos (Forex).');
          }
          default: {
            const unhandled: never = dto.type as never;
            return Result.fail<RecordTreasuryTransactionResult>(`Tipo de transação '${unhandled}' não é suportado por este Use Case.`);
          }
        }

        // 9. Build Domain Aggregates
        const ledgerEntries = rawEntries.map(
          (spec) =>
            new LedgerEntry({
              accountId: String(spec.accountId),
              amount: spec.amount,
              type: spec.entryType,
              description: spec.description,
            })
        );

        const transaction = new LedgerTransaction({
          idempotencyKey,
          description,
          entries: ledgerEntries,
          userId: parsedUserId,
          transactionType: dto.type,
          category,
          refundOfTransactionId: dto.refundOfTransactionId ? Number(dto.refundOfTransactionId) : undefined,
        });

        // 10. Execute Posting via Orchestrator with Canonical DTO Hash
        const orchestrator = new FinancialTransactionOrchestrator(financeRepo);
        const orchestratorResult = await orchestrator.executePosting(transaction, canonicalHash);
        return Result.ok<RecordTreasuryTransactionResult>(orchestratorResult);
      });
    } catch (err: unknown) {
      if (err instanceof FinancialError) {
        return Result.fail<RecordTreasuryTransactionResult>(err.message);
      }
      const message = err instanceof Error ? err.message : 'Falha ao registrar transação.';
      return Result.fail<RecordTreasuryTransactionResult>(message);
    }
  }
}
