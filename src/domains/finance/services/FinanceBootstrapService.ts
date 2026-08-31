import { financialAccounts, financialAssets, accountBalances } from '../../../db/finance/tables';
import { eq, and } from 'drizzle-orm';
import { Result } from '../../../shared/kernel/Result';

export interface TreasuryBootstrapOptions {
  treasuryUserId?: number;
  currencyCode?: string;
  initialBalanceBaseUnits?: bigint;
}

export interface TreasuryBootstrapResult {
  assetId: number;
  treasuryAccountId: number;
  operatingAccountId: number;
  feeAccountId: number;
}

export class FinanceBootstrapService {
  /**
   * Provisiona a infraestrutura básica de contas do Finance Core em um novo banco de dados:
   * 1. Ativo Padrão (ex: BRL, USD, USDT)
   * 2. Conta de Tesouraria (accountType: 'treasury', accountClass: 'asset')
   * 3. Conta Operacional (accountType: 'operating', accountClass: 'liability')
   * 4. Conta de Taxas (accountType: 'fee', accountClass: 'revenue')
   */
  static async seedSystemAccounts(
    db: any,
    options: TreasuryBootstrapOptions = {}
  ): Promise<Result<TreasuryBootstrapResult>> {
    try {
      const currency = options.currencyCode || 'BRL';
      const userId = options.treasuryUserId ?? 1;

      // 1. Assegurar Ativo Financeiro
      let [asset] = await db
        .select()
        .from(financialAssets)
        .where(eq(financialAssets.code, currency))
        .limit(1);

      if (!asset) {
        await db
          .insert(financialAssets)
          .values({
            code: currency,
            symbol: currency === 'BRL' ? 'R$' : '$',
            name: `${currency} Base Currency`,
            decimals: 2,
            type: 'fiat',
            status: 'active',
            createdAt: new Date(),
            updatedAt: new Date(),
          });
        [asset] = await db
          .select()
          .from(financialAssets)
          .where(eq(financialAssets.code, currency))
          .limit(1);
      }

      const assetId = asset.id;

      // 2. Assegurar Conta de Tesouraria (Treasury)
      let [treasuryAcc] = await db
        .select()
        .from(financialAccounts)
        .where(
          and(
            eq(financialAccounts.accountType, 'treasury'),
            eq(financialAccounts.status, 'active')
          )
        )
        .limit(1);

      if (!treasuryAcc) {
        await db
          .insert(financialAccounts)
          .values({
            userId,
            accountType: 'treasury',
            accountClass: 'asset',
            status: 'active',
            name: 'Treasury Primary Vault',
            createdAt: new Date(),
            updatedAt: new Date(),
          });
        [treasuryAcc] = await db
          .select()
          .from(financialAccounts)
          .where(
            and(
              eq(financialAccounts.accountType, 'treasury'),
              eq(financialAccounts.status, 'active')
            )
          )
          .limit(1);
      }

      // 3. Assegurar Conta Operacional
      let [operatingAcc] = await db
        .select()
        .from(financialAccounts)
        .where(
          and(
            eq(financialAccounts.accountType, 'operating'),
            eq(financialAccounts.status, 'active')
          )
        )
        .limit(1);

      if (!operatingAcc) {
        await db
          .insert(financialAccounts)
          .values({
            userId,
            accountType: 'operating',
            accountClass: 'liability',
            status: 'active',
            name: 'System Operating Vault',
            createdAt: new Date(),
            updatedAt: new Date(),
          });
        [operatingAcc] = await db
          .select()
          .from(financialAccounts)
          .where(
            and(
              eq(financialAccounts.accountType, 'operating'),
              eq(financialAccounts.status, 'active')
            )
          )
          .limit(1);
      }

      // 4. Assegurar Conta de Taxas
      let [feeAcc] = await db
        .select()
        .from(financialAccounts)
        .where(
          and(
            eq(financialAccounts.accountType, 'fees'),
            eq(financialAccounts.status, 'active')
          )
        )
        .limit(1);

      if (!feeAcc) {
        await db
          .insert(financialAccounts)
          .values({
            userId,
            accountType: 'fees',
            accountClass: 'revenue',
            status: 'active',
            name: 'System Fee Collector',
            createdAt: new Date(),
            updatedAt: new Date(),
          });
        [feeAcc] = await db
          .select()
          .from(financialAccounts)
          .where(
            and(
              eq(financialAccounts.accountType, 'fees'),
              eq(financialAccounts.status, 'active')
            )
          )
          .limit(1);
      }

      // 5. Assegurar linhas de saldo zeradas ou com saldo inicial
      const initialBal = (options.initialBalanceBaseUnits ?? 0n).toString();
      
      const systemAccounts = [treasuryAcc.id, operatingAcc.id, feeAcc.id];
      for (const accId of systemAccounts) {
        const [existingBal] = await db
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
          await db.insert(accountBalances).values({
            accountId: accId,
            assetId,
            availableBaseUnits: accId === treasuryAcc.id ? initialBal : '0',
            lockedBaseUnits: '0',
            version: 1,
            updatedAt: new Date(),
          });
        }
      }

      return Result.ok({
        assetId,
        treasuryAccountId: treasuryAcc.id,
        operatingAccountId: operatingAcc.id,
        feeAccountId: feeAcc.id,
      });
    } catch (err: any) {
      return Result.fail(`Bootstrap failed: ${err.message}`);
    }
  }
}
