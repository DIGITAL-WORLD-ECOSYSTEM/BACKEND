import { Context } from 'hono';
import { GetTreasuryBalanceUseCase } from '../../../../domains/finance/use-cases/GetTreasuryBalanceUseCase';
import { RecordTreasuryTransactionUseCase } from '../../../../domains/finance/use-cases/RecordTreasuryTransactionUseCase';
import { IFinanceRepository } from '../../../../application/ports/output/IFinanceRepository';

export class FinanceController {
  constructor(
    private readonly getTreasuryBalanceUseCase: GetTreasuryBalanceUseCase,
    private readonly recordTxUseCase: RecordTreasuryTransactionUseCase,
    private readonly financeRepo: IFinanceRepository
  ) {}

  async getBalance(c: Context): Promise<Response> {
    try {
      const result = await this.getTreasuryBalanceUseCase.execute();
      if (result.isFailure) {
        return c.json({ success: false, message: result.error }, 400);
      }

      return c.json({ success: true, data: result.getValue() });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erro interno';
      return c.json({ success: false, message: 'Erro no servidor', error: message }, 500);
    }
  }

  async recordTransaction(c: Context): Promise<Response> {
    try {
      const userId = c.get('userId') || c.get('user')?.userId;
      const body = await c.req.json();

      const result = await this.recordTxUseCase.execute({
        userId,
        type: body.type || 'deposit',
        category: body.category,
        description: body.description,
        amountBaseUnits: body.amountBaseUnits,
        assetId: body.assetId,
      });

      if (result.isFailure) {
        return c.json({ success: false, message: result.error }, 400);
      }

      return c.json({ success: true, message: 'Transação registrada com sucesso', data: result.getValue() }, 201);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erro interno';
      return c.json({ success: false, message: 'Erro no servidor', error: message }, 500);
    }
  }

  async listTransactions(c: Context): Promise<Response> {
    try {
      const userId = c.get('userId') || c.get('user')?.userId;
      const result = await this.financeRepo.listTransactions(userId);

      if (result.isFailure) {
        return c.json({ success: false, message: result.error }, 400);
      }

      return c.json({ success: true, data: result.getValue() });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erro interno';
      return c.json({ success: false, message: 'Erro no servidor', error: message }, 500);
    }
  }
}
