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
  requestHash?: string;
}

export class RepairFinanceUseCase {
  private readonly recordTreasuryUseCase: RecordTreasuryTransactionUseCase;

  constructor(
    private readonly uow: IUnitOfWork,
    recordTreasuryUseCase?: RecordTreasuryTransactionUseCase
  ) {
    this.recordTreasuryUseCase = recordTreasuryUseCase || new RecordTreasuryTransactionUseCase(this.uow);
  }

  async execute(command: RepairFinanceCommand): Promise<Result<RecordTreasuryTransactionResult>> {
    if (!command.actorUserId || !command.authorizedByUserId) {
      return Result.fail('Identificação de actorUserId e authorizedByUserId é obrigatória para reparo.');
    }

    if (command.actorUserId === command.authorizedByUserId) {
      return Result.fail('Invariante de segregação de funções violado: Para reparo/ajuste emergencial (four-eyes), o operador (actorUserId) deve ser distinto do autorizador (authorizedByUserId).');
    }

    if (command.targetUserId === command.authorizedByUserId) {
      return Result.fail('Invariante FIN-007 violado: Para ajustes administrativos, targetUserId deve ser distinto de authorizedByUserId.');
    }

    if (command.targetUserId === command.actorUserId) {
      return Result.fail('Invariante FIN-007 violado: O operador do reparo não pode ser o titular da conta alvo.');
    }

    if (!command.reason || command.reason.trim().length < 10) {
      return Result.fail('Motivo do reparo deve ter no mínimo 10 caracteres explicativos.');
    }

    return this.recordTreasuryUseCase.execute({
      userId: command.targetUserId,
      actorUserId: command.actorUserId,
      authorizedByUserId: command.authorizedByUserId,
      isDualAuthorization: true,
      type: 'adjustment',
      direction: command.direction,
      category: 'operational',
      description: `[REPAIR/CLI] ${command.reason.trim()}`,
      amountBaseUnits: command.amountBaseUnits,
      assetId: command.assetId,
      idempotencyKey: command.idempotencyKey,
      requestHash: command.requestHash,
    });
  }
}
