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

      // 1. Validate Type
      const allowedTypes = ['deposit', 'withdrawal', 'transfer', 'payment', 'refund', 'fee', 'reward', 'yield', 'conversion', 'adjustment'];
      if (!body.type || !allowedTypes.includes(body.type)) {
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

      // 5. Generate Canonical Request Hash
      const canonicalPayload = JSON.stringify({
        amountBaseUnits: String(body.amountBaseUnits),
        assetId: String(body.assetId),
        category: String(body.category || ''),
        description: String(body.description || ''),
        direction,
        type: String(body.type),
        userId: userId ? String(userId) : ''
      });
      
      const encoder = new TextEncoder();
      const data = encoder.encode(canonicalPayload);
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const requestHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

      // 6. Execute Use Case
      const result = await this.recordTxUseCase.execute({
        userId,
        type: body.type,
        direction,
        category: body.category,
        description: body.description,
        amountBaseUnits: String(body.amountBaseUnits),
        assetId: Number(body.assetId),
        idempotencyKey,
        requestHash
      });

      if (result.isFailure) {
        const errorMsg = result.error as string;
        // Map domain errors to HTTP Status Codes
        if (errorMsg.includes('409 Conflict') || errorMsg.includes('Idempotency Key Processing')) {
          return c.json({ success: false, message: errorMsg }, 409);
        }
        return c.json({ success: false, message: errorMsg }, 400);
      }

      const { transactionId, isReplayed } = result.getValue();

      // 201 Created se foi nova, ou 200 OK se foi idempotente.
      c.header('Idempotency-Replayed', isReplayed ? 'true' : 'false');
      
      return c.json({ 
        success: true, 
        message: 'Transação registrada com sucesso', 
        data: { transactionId, isReplayed } 
      }, isReplayed ? 200 : 201);
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
