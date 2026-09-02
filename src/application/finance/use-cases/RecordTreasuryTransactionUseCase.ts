import { IUnitOfWork } from '../../ports/output/IUnitOfWork';
import { Result } from '../../../shared/kernel/Result';
import { LedgerTransaction, LedgerEntry } from '../../../domains/finance/entities/LedgerTransaction';
import { Money256, parsePositiveSafeIntegerId } from '../../../domains/finance/value-objects/Money256';
import { AccountingEntryPolicy, RawLedgerEntrySpec } from '../../../domains/finance/policies/AccountingEntryPolicy';
import { FinancialTransactionOrchestrator, OrchestratorResult } from '../services/FinancialTransactionOrchestrator';
import { CanonicalRequestHashService } from '../services/CanonicalRequestHashService';
import {
  FinancialError,
  InvalidRefundAmountError,
  UnsupportedFinancialOperationError,
  InvalidFinancialOperationError,
  AccountOwnershipError,
  AssetInactiveError,
  AccountInactiveError,
  IdempotencyConflictError,
} from '../../../domains/finance/errors/FinancialError';
import { FinancialTransactionCategory } from '../../ports/output/IFinanceRepository';

export interface RecordTreasuryTransactionDTO {
  userId?: number | null;
  type: 'deposit' | 'withdrawal' | 'transfer' | 'payment' | 'refund' | 'fee' | 'reward' | 'yield' | 'conversion' | 'adjustment';
  direction?: 'INBOUND' | 'OUTBOUND';
  category?: FinancialTransactionCategory;
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

const USER_REQUIRED_OPERATIONS = ['payment', 'fee', 'reward', 'yield'] as const;
const INBOUND_ONLY_OPS = ['deposit', 'yield', 'reward', 'refund'] as const;
const OUTBOUND_ONLY_OPS = ['withdrawal', 'payment', 'fee'] as const;

export class RecordTreasuryTransactionUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(dto: RecordTreasuryTransactionDTO): Promise<Result<RecordTreasuryTransactionResult>> {
    // 1. Structural DTO Field Validation
    if (!dto.description || !dto.amountBaseUnits || !dto.idempotencyKey || dto.assetId === undefined || !dto.type) {
      return Result.fail<RecordTreasuryTransactionResult>(
        new InvalidFinancialOperationError('Descrição, valor, assetId, type e idempotencyKey são obrigatórios.')
      );
    }

    const description = dto.description.trim();
    if (description.length < 3 || description.length > 500) {
      return Result.fail<RecordTreasuryTransactionResult>(
        new InvalidFinancialOperationError('A descrição deve conter entre 3 e 500 caracteres.')
      );
    }

    const idempotencyKey = dto.idempotencyKey.trim();
    if (idempotencyKey.length === 0 || idempotencyKey.length > 255) {
      return Result.fail<RecordTreasuryTransactionResult>(
        new InvalidFinancialOperationError('A chave de idempotência deve ter entre 1 e 255 caracteres.')
      );
    }

    if (dto.requestHash !== undefined) {
      if (!/^[a-f0-9]{64}$/i.test(dto.requestHash)) {
        return Result.fail<RecordTreasuryTransactionResult>(
          new InvalidFinancialOperationError('Formato de requestHash inválido. Deve ser uma string SHA-256 hexadecimal de 64 caracteres.')
        );
      }
    }

    try {
      // 2. Value Object & Asset ID Parsing
      const parsedAssetId = parsePositiveSafeIntegerId(dto.assetId, 'assetId');
      const amountMoney = Money256.fromString(dto.amountBaseUnits, parsedAssetId);

      if (amountMoney.isZero()) {
        return Result.fail<RecordTreasuryTransactionResult>(
          new InvalidFinancialOperationError('O valor da transação deve ser estritamente maior que zero.')
        );
      }

      // 3. User Ownership & Required User ID Check
      let parsedUserId: number | null = null;
      if (dto.userId !== null && dto.userId !== undefined) {
        parsedUserId = parsePositiveSafeIntegerId(dto.userId, 'userId');
      }

      if ((USER_REQUIRED_OPERATIONS as readonly string[]).includes(dto.type) && parsedUserId === null) {
        return Result.fail<RecordTreasuryTransactionResult>(
          new AccountOwnershipError(`Operação do tipo '${dto.type}' exige obrigatoriamente um userId de usuário final.`)
        );
      }

      // 4. Direction Rules & Determinism per Operation
      let resolvedDirection = dto.direction;
      if ((INBOUND_ONLY_OPS as readonly string[]).includes(dto.type)) {
        if (resolvedDirection && resolvedDirection !== 'INBOUND') {
          return Result.fail<RecordTreasuryTransactionResult>(
            new InvalidFinancialOperationError(`Transação do tipo '${dto.type}' não pode ter direção OUTBOUND. Direção determinística: INBOUND.`)
          );
        }
        resolvedDirection = 'INBOUND';
      } else if ((OUTBOUND_ONLY_OPS as readonly string[]).includes(dto.type)) {
        if (resolvedDirection && resolvedDirection !== 'OUTBOUND') {
          return Result.fail<RecordTreasuryTransactionResult>(
            new InvalidFinancialOperationError(`Transação do tipo '${dto.type}' não pode ter direção INBOUND. Direção determinística: OUTBOUND.`)
          );
        }
        resolvedDirection = 'OUTBOUND';
      } else if (!resolvedDirection) {
        return Result.fail<RecordTreasuryTransactionResult>(
          new InvalidFinancialOperationError(`Operação do tipo '${dto.type}' exige declaração explícita de direção (INBOUND ou OUTBOUND).`)
        );
      }

      // 5. Category Strict Typing & Domain Validation
      const VALID_CATEGORIES: FinancialTransactionCategory[] = [
        'membership', 'rwa_yield', 'grant', 'operational', 'payment', 'trading', 'withdrawal', 'deposit', 'fee', 'other'
      ];
      let category: FinancialTransactionCategory = 'operational';
      if (dto.category !== undefined && dto.category !== null) {
        const trimmed = String(dto.category).toLowerCase().trim() as FinancialTransactionCategory;
        if (!VALID_CATEGORIES.includes(trimmed)) {
          return Result.fail<RecordTreasuryTransactionResult>(
            new InvalidFinancialOperationError(`Categoria '${dto.category}' não é uma categoria financeira válida do domínio.`)
          );
        }
        category = trimmed;
      }

      // 6. Compute Canonical Request Hash over Request DTO payload
      const canonicalPayload = {
        amountBaseUnits: dto.amountBaseUnits,
        assetId: parsedAssetId,
        category,
        description,
        direction: resolvedDirection,
        refundOfTransactionId: dto.refundOfTransactionId ?? null,
        type: dto.type,
        userId: parsedUserId,
      };
      const canonicalHash = CanonicalRequestHashService.calculateHash(canonicalPayload);

      if (dto.requestHash !== undefined && dto.requestHash !== canonicalHash) {
        return Result.fail<RecordTreasuryTransactionResult>(
          new IdempotencyConflictError('409 Conflict: O requestHash fornecido não coincide com o hash canônico do payload.')
        );
      }

      // 7. Atomic Unit of Work Execution
      return await this.uow.execute(async (factory) => {
        const financeRepo = factory.getFinanceRepository();

        // 7a. Validate Asset Existence & Active Status
        const assetRes = await financeRepo.getAssetById(parsedAssetId);
        if (assetRes.isFailure) return Result.fail<RecordTreasuryTransactionResult>(assetRes.errorObject || assetRes.error || `Ativo financeiro #${parsedAssetId} não encontrado.`);
        const asset = assetRes.getValue();
        if (asset.status !== 'active') {
          return Result.fail<RecordTreasuryTransactionResult>(
            new AssetInactiveError(`Ativo financeiro #${parsedAssetId} (${asset.code}) está inativo ou suspenso.`)
          );
        }

        // 7b. Resolve Treasury Account
        const treasuryRes = await financeRepo.getTreasuryAccount();
        if (treasuryRes.isFailure) return Result.fail<RecordTreasuryTransactionResult>(treasuryRes.errorObject || treasuryRes.error || 'Erro ao resolver conta de Tesouraria');
        const treasuryAcc = treasuryRes.getValue();
        if (treasuryAcc.status !== 'active') {
          return Result.fail<RecordTreasuryTransactionResult>(new AccountInactiveError('Conta de Tesouraria está inativa ou suspensa.'));
        }
        const treasuryAccountId = treasuryAcc.id;

        // 7c. Resolve User Account (deferred for refund to allow pre-check of ownership)
        let userAccountId: number = 0;
        if (dto.type !== 'refund') {
          if (parsedUserId !== null) {
            const userAccRes = await financeRepo.getOrCreateUserAccount(parsedUserId);
            if (userAccRes.isFailure) return Result.fail<RecordTreasuryTransactionResult>(userAccRes.errorObject || userAccRes.error || 'Erro ao resolver conta do Usuário');
            const userAcc = userAccRes.getValue();
            if (userAcc.status !== 'active') {
              return Result.fail<RecordTreasuryTransactionResult>(new AccountInactiveError('Conta do Usuário está inativa ou suspensa.'));
            }
            userAccountId = userAcc.id;
          } else {
            // If no userId, use Operating Account
            const sysOpRes = await financeRepo.getSystemAccount('operating');
            if (sysOpRes.isFailure) return Result.fail<RecordTreasuryTransactionResult>(sysOpRes.errorObject || sysOpRes.error || 'Erro ao resolver conta operacional do sistema');
            if (sysOpRes.getValue().status !== 'active') {
              return Result.fail<RecordTreasuryTransactionResult>(new AccountInactiveError('Conta operacional do sistema está inativa.'));
            }
            userAccountId = sysOpRes.getValue().id;
          }
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
            if (sysRevenueRes.isFailure) return Result.fail<RecordTreasuryTransactionResult>(sysRevenueRes.errorObject || sysRevenueRes.error || 'Erro ao obter conta sistêmica');
            if (sysRevenueRes.getValue().status !== 'active') {
              return Result.fail<RecordTreasuryTransactionResult>(new AccountInactiveError('Conta sistêmica payment_revenue está inativa.'));
            }
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
              return Result.fail<RecordTreasuryTransactionResult>(
                new InvalidFinancialOperationError('Reembolso (refund) exige o ID da transação original (refundOfTransactionId).')
              );
            }
            const origTxId = parsePositiveSafeIntegerId(dto.refundOfTransactionId, 'refundOfTransactionId');

            // Fetch original transaction within same UoW boundary
            const origTxRes = await financeRepo.getTransactionById(origTxId);
            if (origTxRes.isFailure) return Result.fail<RecordTreasuryTransactionResult>(origTxRes.errorObject || origTxRes.error || 'Erro ao buscar transação original');
            const origTx = origTxRes.getValue();

            if (origTx.status !== 'completed') {
              return Result.fail<RecordTreasuryTransactionResult>(
                new InvalidFinancialOperationError(`Reembolso rejeitado: Transação original #${origTxId} não está em estado 'completed' (status atual: '${origTx.status}').`)
              );
            }
            if (origTx.type !== 'payment') {
              return Result.fail<RecordTreasuryTransactionResult>(
                new InvalidFinancialOperationError(`Reembolso rejeitado: Apenas transações do tipo 'payment' podem ser reembolsadas.`)
              );
            }

            // P0.2: Strict Refund Ownership Verification
            if (origTx.userId === null) {
              return Result.fail<RecordTreasuryTransactionResult>(
                new AccountOwnershipError(`Reembolso rejeitado: A transação original #${origTxId} não possui usuário proprietário.`)
              );
            }
            if (parsedUserId !== null && parsedUserId !== origTx.userId) {
              return Result.fail<RecordTreasuryTransactionResult>(
                new AccountOwnershipError(`Reembolso rejeitado: O usuário solicitado (#${parsedUserId}) não coincide com o usuário proprietário da transação original (#${origTx.userId}).`)
              );
            }

            // Strictly derive user account from original payment owner
            parsedUserId = origTx.userId;
            const userAccRes = await financeRepo.getOrCreateUserAccount(parsedUserId);
            if (userAccRes.isFailure) return Result.fail<RecordTreasuryTransactionResult>(userAccRes.errorObject || userAccRes.error || 'Erro ao resolver conta de usuário');
            const userAcc = userAccRes.getValue();
            if (userAcc.status !== 'active') {
              return Result.fail<RecordTreasuryTransactionResult>(new AccountInactiveError('Conta do Usuário está inativa ou suspensa.'));
            }
            userAccountId = userAcc.id;

            // P0.3 & P0.6: Fetch original payment ledger entries & extract payment revenue amount (Clean Domain contract)
            const origEntriesRes = await financeRepo.getTransactionEntries(origTxId);
            if (origEntriesRes.isFailure) return Result.fail<RecordTreasuryTransactionResult>(origEntriesRes.errorObject || origEntriesRes.error || 'Erro ao buscar lançamentos originais');

            const origEntries = origEntriesRes.getValue();
            const originalPaymentMoney = AccountingEntryPolicy.extractRefundablePaymentAmount(origEntries, parsedAssetId);
            const originalPaymentAmount = originalPaymentMoney.toBigInt();

            // Refund cumulative limit check. Concurrency safety is guaranteed by the UoW transaction boundary (BEGIN IMMEDIATE write lock).
            const prevRefundsTotal = await financeRepo.getRefundsTotalForTransaction(origTxId, parsedAssetId);
            const requestedRefundAmount = amountMoney.toBigInt();
            if (prevRefundsTotal + requestedRefundAmount > originalPaymentAmount) {
              const remaining = originalPaymentAmount > prevRefundsTotal ? originalPaymentAmount - prevRefundsTotal : 0n;
              return Result.fail<RecordTreasuryTransactionResult>(
                new InvalidRefundAmountError(
                  `Valor do reembolso (${requestedRefundAmount.toString()}) excede o saldo reembolsável restante (${remaining.toString()}) da transação original #${origTxId}.`
                )
              );
            }

            const sysRefundExpRes = await financeRepo.getSystemAccount('refund_expense');
            if (sysRefundExpRes.isFailure) return Result.fail<RecordTreasuryTransactionResult>(sysRefundExpRes.errorObject || sysRefundExpRes.error || 'Erro ao resolver conta de reembolso');
            if (sysRefundExpRes.getValue().status !== 'active') {
              return Result.fail<RecordTreasuryTransactionResult>(new AccountInactiveError('Conta sistêmica refund_expense está inativa.'));
            }
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
            if (sysFeeRes.isFailure) return Result.fail<RecordTreasuryTransactionResult>(sysFeeRes.errorObject || sysFeeRes.error || 'Erro ao resolver conta de taxas');
            if (sysFeeRes.getValue().status !== 'active') {
              return Result.fail<RecordTreasuryTransactionResult>(new AccountInactiveError('Conta sistêmica fees está inativa.'));
            }
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
            if (sysRewardExpRes.isFailure) return Result.fail<RecordTreasuryTransactionResult>(sysRewardExpRes.errorObject || sysRewardExpRes.error || 'Erro ao resolver conta de recompensa');
            if (sysRewardExpRes.getValue().status !== 'active') {
              return Result.fail<RecordTreasuryTransactionResult>(new AccountInactiveError('Conta sistêmica reward_expense está inativa.'));
            }
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
            if (sysYieldExpRes.isFailure) return Result.fail<RecordTreasuryTransactionResult>(sysYieldExpRes.errorObject || sysYieldExpRes.error || 'Erro ao resolver conta de rendimentos');
            if (sysYieldExpRes.getValue().status !== 'active') {
              return Result.fail<RecordTreasuryTransactionResult>(new AccountInactiveError('Conta sistêmica yield_expense está inativa.'));
            }
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
              debitAccountId: resolvedDirection === 'INBOUND' ? treasuryAccountId : userAccountId,
              creditAccountId: resolvedDirection === 'INBOUND' ? userAccountId : treasuryAccountId,
              amount: amountMoney,
              reason: description,
              authorizedByUserId: dto.userId ?? 1,
            });
            break;
          }
          case 'transfer': {
            rawEntries = AccountingEntryPolicy.createTransferEntries({
              sourceAccountId: resolvedDirection === 'OUTBOUND' ? userAccountId : treasuryAccountId,
              destinationAccountId: resolvedDirection === 'OUTBOUND' ? treasuryAccountId : userAccountId,
              amount: amountMoney,
              description,
            });
            break;
          }
          case 'conversion': {
            return Result.fail<RecordTreasuryTransactionResult>(
              new UnsupportedFinancialOperationError('Operação de conversão (conversion) exige Use Case especializado de troca de ativos (Forex).')
            );
          }
          default: {
            const unhandled: never = dto.type as never;
            return Result.fail<RecordTreasuryTransactionResult>(
              new UnsupportedFinancialOperationError(`Tipo de transação '${unhandled}' não é suportado por este Use Case.`)
            );
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

        // 10. Execute Posting via Orchestrator
        const orchestrator = new FinancialTransactionOrchestrator(financeRepo);
        const orchestratorResult = await orchestrator.executePosting(transaction);
        return Result.ok<RecordTreasuryTransactionResult>(orchestratorResult);
      });
    } catch (err: unknown) {
      if (err instanceof FinancialError) {
        return Result.fail<RecordTreasuryTransactionResult>(err);
      }
      const message = err instanceof Error ? err.message : 'Falha ao registrar transação.';
      return Result.fail<RecordTreasuryTransactionResult>(message);
    }
  }
}
