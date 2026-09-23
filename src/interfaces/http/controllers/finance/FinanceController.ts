import { Context } from 'hono';
import { GetTreasuryBalanceUseCase } from '../../../../application/finance/use-cases/GetTreasuryBalanceUseCase';
import { RecordTreasuryTransactionUseCase } from '../../../../application/finance/use-cases/RecordTreasuryTransactionUseCase';
import { RecordTransferUseCase } from '../../../../application/finance/use-cases/RecordTransferUseCase';
import { GetExternalTransactionsUseCase } from '../../../../application/finance/use-cases/GetExternalTransactionsUseCase';
import { GetConsolidatedFinancialReportUseCase } from '../../../../application/finance/use-cases/GetConsolidatedFinancialReportUseCase';
import { IFinanceRepository } from '../../../../application/ports/output/IFinanceRepository';
import { FinancialError } from '../../../../domains/finance/errors/FinancialError';
import { mapFinancialErrorToHttpStatus } from '../../../../application/finance/errors/FinancialErrorMapper';

export class FinanceController {
  constructor(
    private readonly getTreasuryBalanceUseCase: GetTreasuryBalanceUseCase,
    private readonly recordTxUseCase: RecordTreasuryTransactionUseCase,
    private readonly financeRepo: IFinanceRepository,
    private readonly recordTransferUseCase?: RecordTransferUseCase,
    private readonly getExternalTransactionsUseCase?: GetExternalTransactionsUseCase,
    private readonly getConsolidatedReportUseCase?: GetConsolidatedFinancialReportUseCase
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
      const body = await c.req.json().catch(() => null);

      if (!body || typeof body !== 'object') {
        return c.json({ success: false, message: 'Payload JSON inválido' }, 400);
      }

      const type = forcedType || body.type;

      // 1. Validate Type
      const allowedTypes = ['deposit', 'withdrawal', 'transfer', 'payment', 'refund', 'fee', 'reward', 'yield', 'conversion', 'adjustment'];
      if (!type || !allowedTypes.includes(type)) {
        return c.json({ success: false, message: `Tipo de transação inválido. Tipos permitidos: ${allowedTypes.join(', ')}` }, 400);
      }

      // 2. Validate Direction
      const allowedDirections = ['INBOUND', 'OUTBOUND'];
      if (!body.direction || typeof body.direction !== 'string' || !allowedDirections.includes(body.direction.toUpperCase())) {
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
      const idempotencyKey = c.req.header('idempotency-key') || (typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : undefined);
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

      // For adjustments, authorizedByUserId is strictly derived from the authenticated actor (never accepted from body)
      let authorizedByUserId: number | undefined = undefined;
      if (type === 'adjustment') {
        if (!actorUserId) {
          return c.json({
            success: false,
            message: 'Operações de ajuste exigem sessão autenticada com identificação do autorizador.'
          }, 401);
        }
        authorizedByUserId = Number(actorUserId);
      }

      const permissions: string[] = c.get('permissions') || c.get('user')?.permissions || [];
      const isAdmin = permissions.includes('finance.treasury.admin') || permissions.includes('admin');

      // Operation Capability Check: Privileged / System operations require admin rights
      const privilegedTypes = new Set(['reward', 'yield', 'fee', 'adjustment']);
      if (privilegedTypes.has(type) && !isAdmin) {
        return c.json({
          success: false,
          message: `Acesso negado: A operação '${type}' é restrita a administradores e processos sistêmicos.`
        }, 403);
      }

      // Authorization check: Non-admin users cannot operate on third-party target accounts (including deposits!)
      if (
        actorUserId &&
        targetUserId !== undefined &&
        targetUserId !== Number(actorUserId)
      ) {
        if (!isAdmin) {
          return c.json({
            success: false,
            message: 'Acesso negado: Você não tem autorização para movimentar contas de terceiros.'
          }, 403);
        }
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
        description: typeof body.description === 'string' ? body.description.trim() : body.description,
        amountBaseUnits: String(body.amountBaseUnits),
        assetId: Number(body.assetId),
        idempotencyKey,
        requestHash,
        refundOfTransactionId: body.refundOfTransactionId ? Number(body.refundOfTransactionId) : undefined,
        businessReason: body.businessReason || (type === 'adjustment' ? 'administrative_adjustment' : undefined),
      });

      if (result.isFailure) {
        const errObj = result.errorObject;
        if (errObj instanceof FinancialError) {
          const httpStatus = mapFinancialErrorToHttpStatus(errObj);
          return c.json({
            success: false,
            message: errObj.message,
            code: errObj.code,
          }, httpStatus as any);
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
    if (this.recordTransferUseCase) {
      return this.recordPeerTransfer(c);
    }
    return this.recordTransactionWithType(c, 'transfer');
  }

  private async recordPeerTransfer(c: Context): Promise<Response> {
    try {
      const actorUserId = c.get('userId') || c.get('user')?.userId;
      const body = await c.req.json().catch(() => null);
      if (!body || typeof body !== 'object') {
        return c.json({ success: false, message: 'Payload JSON inválido' }, 400);
      }

      const destinationUserId = body.destinationUserId || body.targetUserId;
      if (!destinationUserId || !/^[1-9]\d*$/.test(String(destinationUserId))) {
        return c.json({
          success: false,
          message: 'destinationUserId válido (inteiro positivo) é obrigatório para transferências entre usuários'
        }, 400);
      }

      const sourceUserId = actorUserId ? Number(actorUserId) : (body.sourceUserId ? Number(body.sourceUserId) : undefined);
      if (!sourceUserId) {
        return c.json({
          success: false,
          message: 'Transferência exige identificação do usuário de origem autenticado'
        }, 401);
      }

      if (!body.amountBaseUnits || !/^[1-9]\d*$/.test(String(body.amountBaseUnits))) {
        return c.json({ success: false, message: 'amountBaseUnits válido (inteiro positivo) é obrigatório' }, 400);
      }

      if (!body.assetId || !/^[1-9]\d*$/.test(String(body.assetId))) {
        return c.json({ success: false, message: 'assetId válido (inteiro positivo) é obrigatório' }, 400);
      }

      const idempotencyKey = c.req.header('idempotency-key') || (typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : undefined);
      if (!idempotencyKey) {
        return c.json({ success: false, message: 'Idempotency-Key header ou no body é obrigatório' }, 400);
      }

      const description = typeof body.description === 'string' ? body.description.trim() : 'Transferência entre usuários';
      const requestHash = c.req.header('x-request-hash') || body.requestHash || undefined;

      const result = await this.recordTransferUseCase!.execute({
        sourceUserId,
        destinationUserId: Number(destinationUserId),
        amountBaseUnits: String(body.amountBaseUnits),
        assetId: Number(body.assetId),
        description,
        idempotencyKey,
        requestHash,
      });

      if (result.isFailure) {
        const errorMsg = typeof result.error === 'string' ? result.error : (result.error as any)?.message || String(result.error);
        if (errorMsg.includes('409 Conflict') || errorMsg.includes('Idempotency') || errorMsg.includes('idempotência')) {
          return c.json({ success: false, message: errorMsg }, 409);
        }
        return c.json({ success: false, message: errorMsg }, 400);
      }

      const data = result.getValue();
      c.header('Idempotency-Replayed', data.isReplayed ? 'true' : 'false');
      return c.json({
        success: true,
        message: 'Transferência realizada com sucesso',
        data,
      }, data.isReplayed ? 200 : 201);
    } catch (err: unknown) {
      const requestId = c.req.header('x-request-id') || crypto.randomUUID();
      console.error(`[FinanceController] recordTransfer Internal Error (requestId: ${requestId}):`, err);
      return c.json({
        success: false,
        message: 'Erro interno ao processar a transferência',
        requestId,
      }, 500);
    }
  }

  async recordAdjustment(c: Context): Promise<Response> {
    return this.recordTransactionWithType(c, 'adjustment');
  }

  async listTransactions(c: Context): Promise<Response> {
    try {
      const userId = c.get('userId') || c.get('user')?.userId;
      const permissions: string[] = c.get('permissions') || c.get('user')?.permissions || [];
      const isAdmin = permissions.includes('finance.treasury.read') || permissions.includes('admin');

      // Fail-closed against global ledger leakage: if no userId and not admin, reject with 401
      if (!userId && !isAdmin) {
        return c.json({ success: false, message: 'Usuário não autenticado para listagem de transações' }, 401);
      }

      const cursorParam = c.req.query('cursor');
      const limitParam = c.req.query('limit');
      const cursor = cursorParam && /^[1-9]\d*$/.test(cursorParam) ? Number(cursorParam) : undefined;
      const limit = limitParam && /^[1-9]\d*$/.test(limitParam) ? Math.min(Math.max(Number(limitParam), 1), 100) : 20;

      const targetUserId = userId ? Number(userId) : undefined;
      const result = await this.financeRepo.listTransactions(targetUserId, { cursor, limit });

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

  async getExternalTransactions(c: Context): Promise<Response> {
    try {
      if (!this.getExternalTransactionsUseCase) {
        return c.json({ success: false, message: 'Serviço de transações externas não configurado' }, 500);
      }

      const limitParam = c.req.query('limit');
      const cursorParam = c.req.query('cursor');
      const providerCode = c.req.query('provider');
      const directionParam = c.req.query('direction');
      const startDate = c.req.query('startDate');
      const endDate = c.req.query('endDate');
      const reconStatus = c.req.query('reconciliationStatus');
      const includePayloadParam = c.req.query('includePayload');

      const limit = limitParam && /^[1-9]\d*$/.test(limitParam) ? Number(limitParam) : 50;
      const cursor = cursorParam && /^[1-9]\d*$/.test(cursorParam) ? Number(cursorParam) : undefined;
      const direction =
        directionParam && ['credit', 'debit'].includes(directionParam.toLowerCase())
          ? (directionParam.toLowerCase() as 'credit' | 'debit')
          : undefined;
      const includePayload = includePayloadParam === 'true' || includePayloadParam === '1';

      const result = await this.getExternalTransactionsUseCase.execute({
        limit,
        cursor,
        providerCode,
        direction,
        startDate,
        endDate,
        reconciliationStatus: reconStatus,
        includePayload,
      });

      if (result.isFailure) {
        return c.json({ success: false, message: result.error }, 400);
      }

      return c.json({ success: true, data: result.getValue() });
    } catch (err: unknown) {
      const requestId = c.req.header('x-request-id') || crypto.randomUUID();
      console.error(`[FinanceController] getExternalTransactions Internal Error (requestId: ${requestId}):`, err);
      return c.json({
        success: false,
        message: 'Erro interno ao consultar transações externas',
        requestId,
      }, 500);
    }
  }

  async getConsolidatedReport(c: Context): Promise<Response> {
    try {
      if (!this.getConsolidatedReportUseCase) {
        return c.json({ success: false, message: 'Serviço de relatório financeiro não configurado' }, 500);
      }

      const result = await this.getConsolidatedReportUseCase.execute();
      if (result.isFailure) {
        return c.json({ success: false, message: result.error }, 400);
      }

      return c.json({ success: true, data: result.getValue() });
    } catch (err: unknown) {
      const requestId = c.req.header('x-request-id') || crypto.randomUUID();
      console.error(`[FinanceController] getConsolidatedReport Internal Error (requestId: ${requestId}):`, err);
      return c.json({
        success: false,
        message: 'Erro interno ao gerar relatório financeiro consolidado',
        requestId,
      }, 500);
    }
  }
}

