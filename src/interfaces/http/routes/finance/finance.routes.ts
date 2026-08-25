import { Hono } from 'hono';
import { Bindings, Variables } from '../../../../types/bindings';
import { DrizzleUnitOfWork } from '../../../../infrastructure/repositories/DrizzleUnitOfWork';
import { DrizzleFinanceRepository } from '../../../../infrastructure/repositories/DrizzleFinanceRepository';
import { GetTreasuryBalanceUseCase } from '../../../../domains/finance/use-cases/GetTreasuryBalanceUseCase';
import { RecordTreasuryTransactionUseCase } from '../../../../domains/finance/use-cases/RecordTreasuryTransactionUseCase';
import { FinanceController } from '../../controllers/finance/FinanceController';
import { sessionGuard } from '../../middlewares/session_guard';

type AppType = {
  Bindings: Bindings;
  Variables: Variables;
};

export const financeRouter = new Hono<AppType>();

financeRouter.use('*', sessionGuard);

financeRouter.get('/treasury/balance', async (c) => {
  const db = c.get('db');
  const uow = new DrizzleUnitOfWork(db);
  const financeRepo = new DrizzleFinanceRepository(db);
  const getBalanceUseCase = new GetTreasuryBalanceUseCase(uow);
  const recordTxUseCase = new RecordTreasuryTransactionUseCase(uow);

  const controller = new FinanceController(getBalanceUseCase, recordTxUseCase, financeRepo);
  return controller.getBalance(c);
});

financeRouter.post('/transactions', async (c) => {
  const db = c.get('db');
  const uow = new DrizzleUnitOfWork(db);
  const financeRepo = new DrizzleFinanceRepository(db);
  const getBalanceUseCase = new GetTreasuryBalanceUseCase(uow);
  const recordTxUseCase = new RecordTreasuryTransactionUseCase(uow);

  const controller = new FinanceController(getBalanceUseCase, recordTxUseCase, financeRepo);
  return controller.recordTransaction(c);
});

financeRouter.get('/transactions', async (c) => {
  const db = c.get('db');
  const uow = new DrizzleUnitOfWork(db);
  const financeRepo = new DrizzleFinanceRepository(db);
  const getBalanceUseCase = new GetTreasuryBalanceUseCase(uow);
  const recordTxUseCase = new RecordTreasuryTransactionUseCase(uow);

  const controller = new FinanceController(getBalanceUseCase, recordTxUseCase, financeRepo);
  return controller.listTransactions(c);
});
