import { IUnitOfWork } from '../../../application/ports/output/IUnitOfWork';
import { Result } from '../../../shared/kernel/Result';
import { DoubleEntryLedgerService } from '../services/DoubleEntryLedgerService';
import { LedgerTransaction } from '../entities/LedgerTransaction';
import { Money } from '../entities/Money';

export interface RecordTreasuryTransactionDTO {
  userId?: number | null;
  type: 'deposit' | 'withdrawal' | 'transfer' | 'payment' | 'refund' | 'fee' | 'reward' | 'yield' | 'conversion' | 'adjustment';
  direction: 'INBOUND' | 'OUTBOUND';
  category?: string;
  description: string;
  amountBaseUnits: string;
  assetId: number;
  idempotencyKey: string;
  requestHash: string;
}

export interface RecordTreasuryTransactionResult {
  transactionId?: number;
  isReplayed: boolean;
}

export class RecordTreasuryTransactionUseCase {
  constructor(
    private readonly uow: IUnitOfWork,
    private readonly ledgerService: DoubleEntryLedgerService
  ) {}

  async execute(dto: RecordTreasuryTransactionDTO): Promise<Result<RecordTreasuryTransactionResult>> {
    if (!dto.description || !dto.amountBaseUnits || !dto.idempotencyKey || !dto.requestHash || !dto.assetId || !dto.direction) {
      return Result.fail<RecordTreasuryTransactionResult>('Descrição, valor, assetId, direction, idempotencyKey e requestHash são obrigatórios.');
    }

    if (Number(dto.assetId) <= 0) {
      return Result.fail<RecordTreasuryTransactionResult>('AssetId inválido.');
    }

    // Validação estrita de Domínio: type vs direction
    const inboundOnly = ['deposit', 'yield', 'reward'];
    const outboundOnly = ['withdrawal', 'payment', 'fee'];
    
    if (dto.direction === 'INBOUND' && outboundOnly.includes(dto.type)) {
      return Result.fail<RecordTreasuryTransactionResult>(`Transação tipo '${dto.type}' não pode ser INBOUND.`);
    }
    if (dto.direction === 'OUTBOUND' && inboundOnly.includes(dto.type)) {
      return Result.fail<RecordTreasuryTransactionResult>(`Transação tipo '${dto.type}' não pode ser OUTBOUND.`);
    }

    // Materializa o Value Object
    const amountMoney = new Money(BigInt(dto.amountBaseUnits), String(dto.assetId));

    // Delegate to UoW, passing the factory to the ledger service (Clean Architecture)
    return await this.uow.execute(async (factory) => {
      const financeRepo = factory.getFinanceRepository();

      // Resolve a conta real da Tesouraria
      const treasuryRes = await financeRepo.getTreasuryAccount();
      if (treasuryRes.isFailure) return Result.fail<RecordTreasuryTransactionResult>(treasuryRes.error || 'Erro ao resolver conta de Tesouraria');
      const treasuryAccountId = treasuryRes.getValue().id;

      // Resolve a conta real do Usuário (se houver userId)
      let userAccountId: number;
      if (dto.userId) {
        const userAccRes = await financeRepo.getOrCreateUserAccount(dto.userId);
        if (userAccRes.isFailure) return Result.fail<RecordTreasuryTransactionResult>(userAccRes.error || 'Erro ao resolver conta do Usuário');
        userAccountId = userAccRes.getValue().id;
      } else {
        const sysAccRes = await financeRepo.getOrCreateOperatingAccount();
        if (sysAccRes.isFailure) return Result.fail<RecordTreasuryTransactionResult>('Erro ao resolver contrapartida do sistema');
        userAccountId = sysAccRes.getValue().id;
      }

      // Fábrica de Domínio Canônica
      const transaction = LedgerTransaction.createTreasuryMovement({
        direction: dto.direction,
        treasuryAccountId,
        userAccountId,
        amount: amountMoney,
        category: dto.category,
        type: dto.type,
        description: dto.description,
        idempotencyKey: dto.idempotencyKey,
        userId: dto.userId
      });

      // Passa a transação e o requestHash para o serviço de ledger atômico
      const result = await this.ledgerService.recordTransaction(transaction, factory, dto.requestHash);
      if (result.isFailure) return Result.fail<RecordTreasuryTransactionResult>(result.error as string);
      
      return Result.ok<RecordTreasuryTransactionResult>(result.getValue());
    });
  }
}
