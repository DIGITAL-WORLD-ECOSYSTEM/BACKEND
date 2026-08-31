import { IUnitOfWork } from '../../ports/output/IUnitOfWork';
import { Result } from '../../../shared/kernel/Result';
import { LedgerTransaction, LedgerEntry } from '../../../domains/finance/entities/LedgerTransaction';
import { Money256, parsePositiveSafeIntegerId } from '../../../domains/finance/value-objects/Money256';
import { AccountingEntryPolicy, RawLedgerEntrySpec } from '../../../domains/finance/policies/AccountingEntryPolicy';
import { FinancialTransactionOrchestrator, OrchestratorResult } from '../services/FinancialTransactionOrchestrator';

export interface RecordTreasuryTransactionDTO {
  userId?: number | null;
  type: 'deposit' | 'withdrawal' | 'transfer' | 'payment' | 'refund' | 'fee' | 'reward' | 'yield' | 'conversion' | 'adjustment';
  direction: 'INBOUND' | 'OUTBOUND';
  category?: string;
  description: string;
  amountBaseUnits: string;
  assetId: number;
  idempotencyKey: string;
  requestHash?: string;
}

export interface RecordTreasuryTransactionResult {
  transactionId?: number;
  isReplayed: boolean;
}

export class RecordTreasuryTransactionUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(dto: RecordTreasuryTransactionDTO): Promise<Result<RecordTreasuryTransactionResult>> {
    if (!dto.description || !dto.amountBaseUnits || !dto.idempotencyKey || !dto.assetId || !dto.direction) {
      return Result.fail<RecordTreasuryTransactionResult>('Descrição, valor, assetId, direction e idempotencyKey são obrigatórios.');
    }

    try {
      const parsedAssetId = parsePositiveSafeIntegerId(dto.assetId, 'assetId');
      const amountMoney = Money256.fromString(dto.amountBaseUnits, parsedAssetId);

      const inboundOnly = ['deposit', 'yield', 'reward'];
      const outboundOnly = ['withdrawal', 'payment', 'fee'];

      if (dto.direction === 'INBOUND' && outboundOnly.includes(dto.type)) {
        return Result.fail<RecordTreasuryTransactionResult>(`Transação tipo '${dto.type}' não pode ser INBOUND.`);
      }
      if (dto.direction === 'OUTBOUND' && inboundOnly.includes(dto.type)) {
        return Result.fail<RecordTreasuryTransactionResult>(`Transação tipo '${dto.type}' não pode ser OUTBOUND.`);
      }

      const res = await this.uow.execute(async (factory) => {
        const financeRepo = factory.getFinanceRepository();

        const treasuryRes = await financeRepo.getTreasuryAccount();
        if (treasuryRes.isFailure) return Result.fail<RecordTreasuryTransactionResult>(treasuryRes.error || 'Erro ao resolver conta de Tesouraria');
        const treasuryAccountId = treasuryRes.getValue().id;

        let sysAccountId: number;
        const sysAccRes = await financeRepo.getOrCreateOperatingAccount();
        if (sysAccRes.isFailure) return Result.fail<RecordTreasuryTransactionResult>('Erro ao resolver conta operacional do sistema');
        sysAccountId = sysAccRes.getValue().id;

        let userAccountId: number;
        if (dto.userId) {
          const userAccRes = await financeRepo.getOrCreateUserAccount(dto.userId);
          if (userAccRes.isFailure) return Result.fail<RecordTreasuryTransactionResult>(userAccRes.error || 'Erro ao resolver conta do Usuário');
          userAccountId = userAccRes.getValue().id;
        } else {
          userAccountId = sysAccountId;
        }

        let rawEntries: RawLedgerEntrySpec[];
        switch (dto.type) {
          case 'deposit':
            rawEntries = AccountingEntryPolicy.createDepositEntries({
              treasuryAccountId,
              userAccountId,
              amount: amountMoney,
              description: dto.description,
            });
            break;
          case 'withdrawal':
            rawEntries = AccountingEntryPolicy.createWithdrawalEntries({
              treasuryAccountId,
              userAccountId,
              amount: amountMoney,
              description: dto.description,
            });
            break;
          case 'payment':
            rawEntries = AccountingEntryPolicy.createPaymentEntries({
              userAccountId,
              paymentRevenueAccountId: sysAccountId,
              amount: amountMoney,
              description: dto.description,
            });
            break;
          case 'refund':
            rawEntries = AccountingEntryPolicy.createRefundEntries({
              refundExpenseAccountId: sysAccountId,
              userAccountId,
              amount: amountMoney,
              description: dto.description,
            });
            break;
          case 'fee':
            rawEntries = AccountingEntryPolicy.createFeeEntries({
              userAccountId,
              feeAccountId: sysAccountId,
              amount: amountMoney,
              description: dto.description,
            });
            break;
          case 'reward':
            rawEntries = AccountingEntryPolicy.createRewardEntries({
              rewardExpenseAccountId: sysAccountId,
              userAccountId,
              amount: amountMoney,
              description: dto.description,
            });
            break;
          case 'yield':
            rawEntries = AccountingEntryPolicy.createYieldEntries({
              yieldExpenseAccountId: sysAccountId,
              userAccountId,
              amount: amountMoney,
              description: dto.description,
            });
            break;
          case 'adjustment':
            rawEntries = AccountingEntryPolicy.createAdjustmentEntries({
              debitAccountId: dto.direction === 'INBOUND' ? treasuryAccountId : userAccountId,
              creditAccountId: dto.direction === 'INBOUND' ? userAccountId : treasuryAccountId,
              amount: amountMoney,
              reason: dto.description,
            });
            break;
          case 'transfer':
            rawEntries = AccountingEntryPolicy.createTransferEntries({
              sourceAccountId: dto.direction === 'OUTBOUND' ? userAccountId : treasuryAccountId,
              destinationAccountId: dto.direction === 'OUTBOUND' ? treasuryAccountId : userAccountId,
              amount: amountMoney,
              description: dto.description,
            });
            break;
          default:
            if (dto.direction === 'INBOUND') {
              rawEntries = AccountingEntryPolicy.createDepositEntries({
                treasuryAccountId,
                userAccountId,
                amount: amountMoney,
                description: dto.description,
              });
            } else {
              rawEntries = AccountingEntryPolicy.createWithdrawalEntries({
                treasuryAccountId,
                userAccountId,
                amount: amountMoney,
                description: dto.description,
              });
            }
            break;
        }

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
          idempotencyKey: dto.idempotencyKey,
          description: dto.description,
          entries: ledgerEntries,
          userId: dto.userId ?? null,
          transactionType: dto.type,
          category: dto.category,
        });

        const orchestrator = new FinancialTransactionOrchestrator(financeRepo);
        const orchestratorResult = await orchestrator.executePosting(transaction, dto.requestHash);
        return Result.ok<RecordTreasuryTransactionResult>(orchestratorResult);
      });

      return res;
    } catch (err: any) {
      return Result.fail<RecordTreasuryTransactionResult>(err.message || 'Falha ao registrar transação.');
    }
  }
}
