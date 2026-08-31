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
