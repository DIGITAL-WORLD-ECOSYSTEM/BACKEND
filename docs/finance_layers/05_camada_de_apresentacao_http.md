# 5. CAMADA DE APRESENTAÇÃO HTTP / REST

Documento integrante do dossiê canônico do Finance Core (`BackEnd/`).

## Sumário dos Arquivos da Camada

- [FinanceController.ts](#srcinterfaceshttpcontrollersfinancefinancecontrollerts) — `src/interfaces/http/controllers/finance/FinanceController.ts` (163 linhas)
- [finance.routes.ts](#srcinterfaceshttproutesfinancefinanceroutests) — `src/interfaces/http/routes/finance/finance.routes.ts` (136 linhas)

---

<a id="srcinterfaceshttpcontrollersfinancefinancecontrollerts"></a>
## Arquivo: `src/interfaces/http/controllers/finance/FinanceController.ts`

- **Caminho absoluto**: `/home/sandro/Área de trabalho/BackEnd/src/interfaces/http/controllers/finance/FinanceController.ts`
- **Total de linhas**: 163
- **Linguagem**: TypeScript

```typescript
import { Context } from 'hono';
import { GetTreasuryBalanceUseCase } from '../../../../application/finance/use-cases/GetTreasuryBalanceUseCase';
import { RecordTreasuryTransactionUseCase } from '../../../../application/finance/use-cases/RecordTreasuryTransactionUseCase';
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

      // 5. Target / Authorized / Actor User ID Resolution
      const targetUserId = body.targetUserId ?? body.userId ?? actorUserId;
      const authorizedByUserId = body.authorizedByUserId;

      // 6. Generate Canonical Request Hash
      const canonicalPayload = JSON.stringify({
        amountBaseUnits: String(body.amountBaseUnits),
        assetId: String(body.assetId),
        category: String(body.category || ''),
        description: String(body.description || ''),
        direction,
        type: String(type),
        userId: targetUserId ? String(targetUserId) : ''
      });
      
      const encoder = new TextEncoder();
      const data = encoder.encode(canonicalPayload);
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const requestHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

      // 7. Execute Use Case
      const result = await this.recordTxUseCase.execute({
        userId: targetUserId,
        actorUserId: actorUserId ? Number(actorUserId) : undefined,
        authorizedByUserId: authorizedByUserId ? Number(authorizedByUserId) : undefined,
        type: type as any,
        direction,
        category: body.category,
        description: body.description,
        amountBaseUnits: String(body.amountBaseUnits),
        assetId: Number(body.assetId),
        idempotencyKey,
        requestHash
      });

      if (result.isFailure) {
        const errorMsg = typeof result.error === 'string' ? result.error : (result.error as any)?.message || String(result.error);
        if (errorMsg.includes('409 Conflict') || errorMsg.includes('Idempotency Key Processing')) {
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
      const message = err instanceof Error ? err.message : 'Erro interno';
      return c.json({ success: false, message: 'Erro no servidor', error: message }, 500);
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
      const message = err instanceof Error ? err.message : 'Erro interno';
      return c.json({ success: false, message: 'Erro no servidor', error: message }, 500);
    }
  }
}

```

---

<a id="srcinterfaceshttproutesfinancefinanceroutests"></a>
## Arquivo: `src/interfaces/http/routes/finance/finance.routes.ts`

- **Caminho absoluto**: `/home/sandro/Área de trabalho/BackEnd/src/interfaces/http/routes/finance/finance.routes.ts`
- **Total de linhas**: 136
- **Linguagem**: TypeScript

```typescript
import { Hono } from 'hono';
import { Bindings, Variables } from '../../../../types/bindings';
import { DrizzleUnitOfWork } from '../../../../infrastructure/repositories/DrizzleUnitOfWork';
import { DrizzleFinanceRepository } from '../../../../infrastructure/repositories/DrizzleFinanceRepository';
import { GetTreasuryBalanceUseCase } from '../../../../application/finance/use-cases/GetTreasuryBalanceUseCase';
import { RecordTreasuryTransactionUseCase } from '../../../../application/finance/use-cases/RecordTreasuryTransactionUseCase';
import { FinanceController } from '../../controllers/finance/FinanceController';
import { sessionGuard, requireAal } from '../../middlewares/session_guard';
import { verifyPermission } from '../../middlewares/rbac';

type AppType = {
  Bindings: Bindings;
  Variables: Variables;
};

export const financeRouter = new Hono<AppType>();

financeRouter.use('*', sessionGuard);

function buildFinanceDeps(db: any) {
  const uow = new DrizzleUnitOfWork(db);
  const financeRepo = new DrizzleFinanceRepository(db);
  const getBalanceUseCase = new GetTreasuryBalanceUseCase(uow);
  const recordTxUseCase = new RecordTreasuryTransactionUseCase(uow);
  return { uow, financeRepo, getBalanceUseCase, recordTxUseCase };
}

financeRouter.get(
  '/treasury/balance',
  requireAal(2),
  verifyPermission('finance.treasury.read'),
  async (c) => {
    const db = c.get('db');
    const { getBalanceUseCase, recordTxUseCase, financeRepo } = buildFinanceDeps(db);
    const controller = new FinanceController(getBalanceUseCase, recordTxUseCase, financeRepo);
    return controller.getBalance(c);
  }
);

// Option A: Dedicated HTTP Routes per Operation with Granular RBAC Permissions
financeRouter.post(
  '/deposits',
  requireAal(2, 15),
  verifyPermission('finance.deposit.create'),
  async (c) => {
    const db = c.get('db');
    const { getBalanceUseCase, recordTxUseCase, financeRepo } = buildFinanceDeps(db);
    const controller = new FinanceController(getBalanceUseCase, recordTxUseCase, financeRepo);
    return controller.recordDeposit(c);
  }
);

financeRouter.post(
  '/withdrawals',
  requireAal(2, 15),
  verifyPermission('finance.withdrawal.create'),
  async (c) => {
    const db = c.get('db');
    const { getBalanceUseCase, recordTxUseCase, financeRepo } = buildFinanceDeps(db);
    const controller = new FinanceController(getBalanceUseCase, recordTxUseCase, financeRepo);
    return controller.recordWithdrawal(c);
  }
);

financeRouter.post(
  '/payments',
  requireAal(2, 15),
  verifyPermission('finance.payment.create'),
  async (c) => {
    const db = c.get('db');
    const { getBalanceUseCase, recordTxUseCase, financeRepo } = buildFinanceDeps(db);
    const controller = new FinanceController(getBalanceUseCase, recordTxUseCase, financeRepo);
    return controller.recordPayment(c);
  }
);

financeRouter.post(
  '/refunds',
  requireAal(2, 15),
  verifyPermission('finance.refund.create'),
  async (c) => {
    const db = c.get('db');
    const { getBalanceUseCase, recordTxUseCase, financeRepo } = buildFinanceDeps(db);
    const controller = new FinanceController(getBalanceUseCase, recordTxUseCase, financeRepo);
    return controller.recordRefund(c);
  }
);

financeRouter.post(
  '/transfers',
  requireAal(2, 15),
  verifyPermission('finance.transfer.create'),
  async (c) => {
    const db = c.get('db');
    const { getBalanceUseCase, recordTxUseCase, financeRepo } = buildFinanceDeps(db);
    const controller = new FinanceController(getBalanceUseCase, recordTxUseCase, financeRepo);
    return controller.recordTransfer(c);
  }
);

financeRouter.post(
  '/adjustments',
  requireAal(2, 15),
  verifyPermission('finance.adjustment.create'),
  async (c) => {
    const db = c.get('db');
    const { getBalanceUseCase, recordTxUseCase, financeRepo } = buildFinanceDeps(db);
    const controller = new FinanceController(getBalanceUseCase, recordTxUseCase, financeRepo);
    return controller.recordAdjustment(c);
  }
);

// Generic Legacy Rota POST /transactions (fallback)
financeRouter.post(
  '/transactions',
  requireAal(2, 15),
  verifyPermission('finance.transaction.create'),
  async (c) => {
    const db = c.get('db');
    const { getBalanceUseCase, recordTxUseCase, financeRepo } = buildFinanceDeps(db);
    const controller = new FinanceController(getBalanceUseCase, recordTxUseCase, financeRepo);
    return controller.recordTransaction(c);
  }
);

financeRouter.get(
  '/transactions',
  requireAal(2),
  verifyPermission('finance.treasury.read'),
  async (c) => {
    const db = c.get('db');
    const { getBalanceUseCase, recordTxUseCase, financeRepo } = buildFinanceDeps(db);
    const controller = new FinanceController(getBalanceUseCase, recordTxUseCase, financeRepo);
    return controller.listTransactions(c);
  }
);

```

---

