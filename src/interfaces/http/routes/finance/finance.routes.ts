import { Hono } from 'hono';
import { Bindings, Variables } from '../../../../types/bindings';
import { DrizzleUnitOfWork } from '../../../../infrastructure/repositories/DrizzleUnitOfWork';
import { DrizzleFinanceRepository } from '../../../../infrastructure/repositories/DrizzleFinanceRepository';
import { GetTreasuryBalanceUseCase } from '../../../../application/finance/use-cases/GetTreasuryBalanceUseCase';
import { RecordTreasuryTransactionUseCase } from '../../../../application/finance/use-cases/RecordTreasuryTransactionUseCase';
import { FinanceController } from '../../controllers/finance/FinanceController';
import { sessionGuard, requireAal } from '../../middlewares/session_guard';
import { verifyPermission } from '../../middlewares/rbac';

import { Database } from '../../../../db';

type AppType = {
  Bindings: Bindings;
  Variables: Variables;
};

export const financeRouter = new Hono<AppType>();

financeRouter.use('*', sessionGuard);

function buildFinanceDeps(db: Database) {
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
