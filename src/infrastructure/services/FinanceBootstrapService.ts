import { financialAccounts, financialAssets, accountBalances } from '../../db/finance/tables';
import { eq, and } from 'drizzle-orm';
import { Result } from '../../shared/kernel/Result';

export interface TreasuryBootstrapOptions {
  currencyCode?: string;
  initialBalanceBaseUnits?: bigint;
}

export interface TreasuryBootstrapResult {
  assetId: number;
  treasuryAccountId: number;
  operatingAccountId: number;
  feeAccountId: number;
  rewardExpenseAccountId: number;
  yieldExpenseAccountId: number;
  clearingAccountId: number;
  openingEquityAccountId: number;
  paymentRevenueAccountId: number;
  refundExpenseAccountId: number;
}

export class FinanceBootstrapService {
  /**
   * Provisiona a infraestrutura básica de contas sistêmicas do Finance Core:
   * 1. Ativo Padrão (ex: BRL, USD, USDT)
   * 2. Contas Sistêmicas com userId = NULL (cumprindo ownerRuleCheck e FIN-019).
   */
  static async seedSystemAccounts(
    db: any,
    options: TreasuryBootstrapOptions = {}
  ): Promise<Result<TreasuryBootstrapResult>> {
    const runSeeding = async (tx: any): Promise<TreasuryBootstrapResult> => {
      const currency = options.currencyCode || 'BRL';

      // 1. Assegurar Ativo Financeiro
      let [asset] = await tx
        .select()
        .from(financialAssets)
        .where(eq(financialAssets.code, currency))
        .limit(1);

      if (!asset) {
        try {
          await tx.insert(financialAssets).values({
            code: currency,
            symbol: currency === 'BRL' ? 'R$' : '$',
            name: `${currency} Base Currency`,
            decimals: 2,
            type: 'fiat',
            status: 'active',
            createdAt: new Date(),
            updatedAt: new Date(),
          });
        } catch (insertErr: any) {
          // Ignora conflito de UNIQUE se já inserido concorrentemente
        }
        [asset] = await tx
          .select()
          .from(financialAssets)
          .where(eq(financialAssets.code, currency))
          .limit(1);
      }

      const assetId = asset.id;

      // Helper para buscar ou criar conta sistêmica com userId = null
      const ensureSystemAccount = async (
        accountType:
          | 'treasury'
          | 'operating'
          | 'fees'
          | 'reward_expense'
          | 'yield_expense'
          | 'clearing'
          | 'opening_balance_equity'
          | 'payment_revenue'
          | 'refund_expense',
        accountClass: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense',
        name: string
      ) => {
        let [acc] = await tx
          .select()
          .from(financialAccounts)
          .where(
            and(
              eq(financialAccounts.accountType, accountType),
              eq(financialAccounts.status, 'active')
            )
          )
          .limit(1);

        if (!acc) {
          try {
            await tx.insert(financialAccounts).values({
              userId: null, // P0 FIX: Deve ser estritamente null para não-user_available
              accountType,
              accountClass,
              status: 'active',
              name,
              createdAt: new Date(),
              updatedAt: new Date(),
            });
          } catch (insertErr: any) {
            // Re-read em caso de violação do índice UNIQUE singleton
          }
          [acc] = await tx
            .select()
            .from(financialAccounts)
            .where(
              and(
                eq(financialAccounts.accountType, accountType),
                eq(financialAccounts.status, 'active')
              )
            )
            .limit(1);
        }
        return acc;
      };

      // Provisionar todas as contas sistêmicas necessárias
      const treasuryAcc = await ensureSystemAccount('treasury', 'asset', 'Treasury Primary Vault');
      const operatingAcc = await ensureSystemAccount('operating', 'asset', 'System Operating Vault');
      const feeAcc = await ensureSystemAccount('fees', 'revenue', 'System Fee Collector');
      const rewardExpenseAcc = await ensureSystemAccount('reward_expense', 'expense', 'System Reward Expense');
      const yieldExpenseAcc = await ensureSystemAccount('yield_expense', 'expense', 'System Yield Expense');
      const clearingAcc = await ensureSystemAccount('clearing', 'asset', 'System FX Clearing Account');
      const openingEquityAcc = await ensureSystemAccount('opening_balance_equity', 'equity', 'System Opening Balance Equity');
      const paymentRevenueAcc = await ensureSystemAccount('payment_revenue', 'revenue', 'System Payment Revenue Account');
      const refundExpenseAcc = await ensureSystemAccount('refund_expense', 'expense', 'System Refund Expense Account');

      // Assegurar saldo zerado ou inicial
      const initialBal = (options.initialBalanceBaseUnits ?? 0n).toString();
      const systemAccounts = [
        treasuryAcc.id,
        operatingAcc.id,
        feeAcc.id,
        rewardExpenseAcc.id,
        yieldExpenseAcc.id,
        clearingAcc.id,
        openingEquityAcc.id,
        paymentRevenueAcc.id,
        refundExpenseAcc.id,
      ];

      for (const accId of systemAccounts) {
        const [existingBal] = await tx
          .select()
          .from(accountBalances)
          .where(
            and(
              eq(accountBalances.accountId, accId),
              eq(accountBalances.assetId, assetId)
            )
          )
          .limit(1);

        if (!existingBal) {
          try {
            await tx.insert(accountBalances).values({
              accountId: accId,
              assetId,
              availableBaseUnits: accId === treasuryAcc.id ? initialBal : '0',
              lockedBaseUnits: '0',
              version: 1,
              updatedAt: new Date(),
            });
          } catch (balErr: any) {
            // Ignora conflito
          }
        }
      }

      return {
        assetId,
        treasuryAccountId: treasuryAcc.id,
        operatingAccountId: operatingAcc.id,
        feeAccountId: feeAcc.id,
        rewardExpenseAccountId: rewardExpenseAcc.id,
        yieldExpenseAccountId: yieldExpenseAcc.id,
        clearingAccountId: clearingAcc.id,
        openingEquityAccountId: openingEquityAcc.id,
        paymentRevenueAccountId: paymentRevenueAcc.id,
        refundExpenseAccountId: refundExpenseAcc.id,
      };
    };

    try {
      const res = await runSeeding(db);
      return Result.ok(res);
    } catch (err: any) {
      return Result.fail(`Bootstrap failed: ${err.message}`);
    }
  }
}
