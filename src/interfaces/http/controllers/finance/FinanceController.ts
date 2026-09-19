import { Context } from 'hono';
import { GetTreasuryBalanceUseCase } from '../../../../application/finance/use-cases/GetTreasuryBalanceUseCase';
import { RecordTreasuryTransactionUseCase } from '../../../../application/finance/use-cases/RecordTreasuryTransactionUseCase';
import { IFinanceRepository } from '../../../../application/ports/output/IFinanceRepository';
import { FinancialError } from '../../../../domains/finance/errors/FinancialError';

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
      const requestId = c.req.header('x-request-id') || crypto.randomUUID();
      console.error(`[FinanceController] getBalance Internal Error (requestId: ${requestId}):`, err);
      return c.json({
        success: false,
        message: 'Erro interno ao consultar saldo da tesouraria',
        requestId,
      }, 500);
    }
  }

  async recordTransactionWithType(c: Context, forcedType?: string): Promise<Response> {
    try {
      const actorUserId = c.get('userId') || c.get('user')?.userId;
      const body = await c.req.json();

      const type = forcedType || body.type;

      // 1. Validate Type
      const allowedTypes = ['deposit', 'withdrawal', 'transfer', 'payment', 'refund', 'fee', 'reward', 'yield', 'conversion', 'adjustment'];
      if (!type || !allowedTypes.includes(type)) {
        return c.json({ success: false, message: `Tipo de transação inválido. Tipos permitidos: ${allowedTypes.join(', ')}` }, 400);
      }

      // 2. Validate Direction
      const allowedDirections = ['INBOUND', 'OUTBOUND'];
      if (!body.direction || !allowedDirections.includes(body.direction.toUpperCase())) {
        return c.json({ success: false, message: `Direction inválida. Permitidas: INBOUND, OUTBOUND` }, 400);
      }
      const direction = body.direction.toUpperCase() as 'INBOUND' | 'OUTBOUND';

      // 3. Validate AssetId and Amount
      if (!body.assetId || !/^[1-9]\d*$/.test(String(body.assetId))) {
        return c.json({ success: false, message: 'assetId válido (inteiro estritamente numérico e positivo) é obrigatório' }, 400);
      }
      if (!body.amountBaseUnits || !/^[1-9]\d*$/.test(String(body.amountBaseUnits))) {
        return c.json({ success: false, message: 'amountBaseUnits válido (inteiro estritamente numérico e positivo) é obrigatório' }, 400);
      }

      // 4. Extract Idempotency Key
      const idempotencyKey = c.req.header('idempotency-key') || body.idempotencyKey;
      if (!idempotencyKey) {
        return c.json({ success: false, message: 'Idempotency-Key header ou no body é obrigatório' }, 400);
      }

      // 5. Target / Authorized / Actor User ID Resolution & Real Authorization
      let targetUserId: number | undefined = undefined;
      if (body.targetUserId !== undefined && body.targetUserId !== null) {
        targetUserId = Number(body.targetUserId);
      } else if (body.userId !== undefined && body.userId !== null) {
        targetUserId = Number(body.userId);
      } else if (actorUserId) {
        targetUserId = Number(actorUserId);
      }

      // Authorization check: Non-admin users cannot operate on third-party target accounts
      if (
        actorUserId &&
        targetUserId !== undefined &&
        targetUserId !== Number(actorUserId) &&
        type !== 'adjustment' &&
        type !== 'deposit'
      ) {
        const permissions: string[] = c.get('permissions') || c.get('user')?.permissions || [];
        const isAdmin = permissions.includes('finance.treasury.admin') || permissions.includes('admin');
        if (!isAdmin) {
          return c.json({
            success: false,
            message: 'Acesso negado: Você não tem autorização para movimentar contas de terceiros.'
          }, 403);
        }
      }

      // For adjustments, authorizedByUserId is derived from the authenticated actor (or validated admin)
      let authorizedByUserId: number | undefined = undefined;
      if (type === 'adjustment') {
        authorizedByUserId = actorUserId ? Number(actorUserId) : (body.authorizedByUserId ? Number(body.authorizedByUserId) : undefined);
      }

      // 6. Request Hash: Forward client provided requestHash if present, otherwise let the use case calculate the canonical hash
      const requestHash = c.req.header('x-request-hash') || body.requestHash || undefined;

      // 7. Execute Use Case
      const result = await this.recordTxUseCase.execute({
        userId: targetUserId,
        actorUserId: actorUserId ? Number(actorUserId) : undefined,
        authorizedByUserId,
        type: type as any,
        direction,
        category: body.category,
        description: body.description,
        amountBaseUnits: String(body.amountBaseUnits),
        assetId: Number(body.assetId),
        idempotencyKey,
        requestHash,
        refundOfTransactionId: body.refundOfTransactionId ? Number(body.refundOfTransactionId) : undefined,
      });

      if (result.isFailure) {
        const errObj = result.errorObject;
        if (errObj instanceof FinancialError) {
          return c.json({
            success: false,
            message: errObj.message,
            code: errObj.code,
          }, errObj.httpStatus as any);
        }

        const errorMsg = typeof result.error === 'string' ? result.error : (result.error as any)?.message || String(result.error);
        if (
          errorMsg.includes('409 Conflict') ||
          errorMsg.includes('Idempotency') ||
          errorMsg.includes('idempotência') ||
          errorMsg.includes('Divergência de requestHash')
        ) {
          return c.json({ success: false, message: errorMsg }, 409);
        }
        return c.json({ success: false, message: errorMsg }, 400);
      }

      const { transactionId, isReplayed } = result.getValue();

      c.header('Idempotency-Replayed', isReplayed ? 'true' : 'false');
      
      return c.json({ 
        success: true, 
        message: 'Transação registrada com sucesso', 
        data: { transactionId, isReplayed } 
      }, isReplayed ? 200 : 201);
    } catch (err: unknown) {
      const requestId = c.req.header('x-request-id') || crypto.randomUUID();
      console.error(`[FinanceController] Internal Error (requestId: ${requestId}):`, err);
      return c.json({
        success: false,
        message: 'Erro interno ao processar a operação financeira',
        requestId,
      }, 500);
    }
  }

  async recordTransaction(c: Context): Promise<Response> {
    return this.recordTransactionWithType(c);
  }

  async recordDeposit(c: Context): Promise<Response> {
    return this.recordTransactionWithType(c, 'deposit');
  }

  async recordWithdrawal(c: Context): Promise<Response> {
    return this.recordTransactionWithType(c, 'withdrawal');
  }

  async recordPayment(c: Context): Promise<Response> {
    return this.recordTransactionWithType(c, 'payment');
  }

  async recordRefund(c: Context): Promise<Response> {
    return this.recordTransactionWithType(c, 'refund');
  }

  async recordTransfer(c: Context): Promise<Response> {
    return this.recordTransactionWithType(c, 'transfer');
  }

  async recordAdjustment(c: Context): Promise<Response> {
    return this.recordTransactionWithType(c, 'adjustment');
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
      const requestId = c.req.header('x-request-id') || crypto.randomUUID();
      console.error(`[FinanceController] listTransactions Internal Error (requestId: ${requestId}):`, err);
      return c.json({
        success: false,
        message: 'Erro interno ao listar transações financeiras',
        requestId,
      }, 500);
    }
  }
}
