import { IUnitOfWork } from '../../ports/output/IUnitOfWork';
import { Result } from '../../../shared/kernel/Result';
import { RecordTreasuryTransactionUseCase, RecordTreasuryTransactionResult } from './RecordTreasuryTransactionUseCase';

export interface RepairFinanceCommand {
  actorUserId: number;
  targetUserId: number;
  authorizedByUserId: number;
  direction: 'INBOUND' | 'OUTBOUND';
  amountBaseUnits: string;
  assetId: number;
  reason: string;
  idempotencyKey: string;
}

export class RepairFinanceUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(command: RepairFinanceCommand): Promise<Result<RecordTreasuryTransactionResult>> {
    if (!command.actorUserId || !command.authorizedByUserId) {
      return Result.fail('Identificação de actorUserId e authorizedByUserId é obrigatória para reparo.');
    }

    if (command.targetUserId === command.authorizedByUserId) {
      return Result.fail('Invariante FIN-007 violado: Para ajustes administrativos, targetUserId deve ser distinto de authorizedByUserId.');
    }

    const recordTxUseCase = new RecordTreasuryTransactionUseCase(this.uow);

    return recordTxUseCase.execute({
      userId: command.targetUserId,
      actorUserId: command.actorUserId,
      authorizedByUserId: command.authorizedByUserId,
      type: 'adjustment',
      direction: command.direction,
      category: 'operational',
      description: `[REPAIR/CLI] ${command.reason}`,
      amountBaseUnits: command.amountBaseUnits,
      assetId: command.assetId,
      idempotencyKey: command.idempotencyKey,
    });
  }
}
