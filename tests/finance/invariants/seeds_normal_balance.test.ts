import { describe, it, expect } from 'vitest';
import { createClient } from '@libsql/client';
import { readFileSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { runAllMigrationsLibSql } from '../../test_helpers/runMigrations';

describe('Gate Contábil: Invariantes de Partidas Dobradas e Normal Balance nos Seeds', () => {
  const rootDir = process.cwd();

  const isDebitNormal = (accountClass: string): boolean => {
    switch (accountClass) {
      case 'asset':
      case 'expense':
        return true;
      case 'liability':
      case 'equity':
      case 'revenue':
        return false;
      default:
        throw new Error(`Classe contábil desconhecida: ${accountClass}`);
    }
  };

  it('valida estritamente seed.sql: partidas dobradas por transação e normal balance por conta', async () => {
    const dbFile = 'test_seed_invariants.db';
    if (existsSync(dbFile)) {
      try { unlinkSync(dbFile); } catch (e) {}
    }

    const sqlite = createClient({ url: `file:${dbFile}` });

    try {
      // 1. Executa todas as migrations (0000 até 0009)
      await runAllMigrationsLibSql(sqlite);

      // 2. Executa o seed.sql
      const seedSql = readFileSync(join(rootDir, 'src/db/seed.sql'), 'utf-8');
      await sqlite.executeMultiple(seedSql);

      // 3. Valida partidas dobradas para todas as transações
      const txRows = (await sqlite.execute('SELECT id, type, status FROM financial_transactions')).rows;
      expect(txRows.length).toBeGreaterThan(0);

      for (const tx of txRows) {
        const txId = tx.id as number;
        const entries = (await sqlite.execute({
          sql: 'SELECT direction, amount_base_units FROM financial_ledger_entries WHERE transaction_id = ?',
          args: [txId],
        })).rows;

        let debits = 0n;
        let credits = 0n;
        for (const entry of entries) {
          const amt = BigInt(entry.amount_base_units as string);
          if (entry.direction === 'debit') {
            debits += amt;
          } else if (entry.direction === 'credit') {
            credits += amt;
          }
        }

        expect(debits).toBe(credits);
        expect(debits).toBeGreaterThan(0n);
      }

      // 4. Valida Normal Balance para todas as contas financeiras
      const accountRows = (await sqlite.execute('SELECT id, account_type, account_class FROM financial_accounts')).rows;
      expect(accountRows.length).toBeGreaterThan(0);

      for (const acc of accountRows) {
        const accId = acc.id as number;
        const accClass = acc.account_class as string;
        const debitNormal = isDebitNormal(accClass);

        const balanceRows = (await sqlite.execute({
          sql: 'SELECT available_base_units, locked_base_units FROM account_balances WHERE account_id = ?',
          args: [accId],
        })).rows;

        // Se a conta possui saldo materializado, deve bater 100% com a projeção contábil
        if (balanceRows.length > 0) {
          const balanceRow = balanceRows[0];
          const availableBaseUnits = BigInt(balanceRow.available_base_units as string);

          const entries = (await sqlite.execute({
            sql: 'SELECT direction, amount_base_units FROM financial_ledger_entries WHERE account_id = ?',
            args: [accId],
          })).rows;

          let projected = 0n;
          for (const entry of entries) {
            const amt = BigInt(entry.amount_base_units as string);
            if (debitNormal) {
              projected += (entry.direction === 'debit' ? amt : -amt);
            } else {
              projected += (entry.direction === 'credit' ? amt : -amt);
            }
          }

          expect(availableBaseUnits).toBe(projected);
          expect(availableBaseUnits).toBeGreaterThanOrEqual(0n);
        }
      }
    } finally {
      try { sqlite.close(); } catch (e) {}
      try { unlinkSync(dbFile); } catch (e) {}
    }
  }, 30000);

  it('valida estritamente seed_treasury_report.sql: 40 transações comprovadas, 5 falhas, sem desequilíbrio e normal balance', async () => {
    const dbFile = 'test_treasury_report_invariants.db';
    if (existsSync(dbFile)) {
      try { unlinkSync(dbFile); } catch (e) {}
    }

    const sqlite = createClient({ url: `file:${dbFile}` });

    try {
      // 1. Executa todas as migrations (0000 até 0009)
      await runAllMigrationsLibSql(sqlite);

      // 2. Executa o seed_treasury_report.sql
      const treasurySql = readFileSync(join(rootDir, 'src/db/seed_treasury_report.sql'), 'utf-8');
      await sqlite.executeMultiple(treasurySql);

      // 3. Valida exatamente 45 transações auditadas
      const txRows = (await sqlite.execute('SELECT id, status, category FROM financial_transactions WHERE id >= 101')).rows;
      expect(txRows.length).toBe(45);

      const completedTxs = txRows.filter(t => t.status === 'completed');
      const failedTxs = txRows.filter(t => t.status === 'failed');

      expect(completedTxs.length).toBe(40);
      expect(failedTxs.length).toBe(5);

      // As 5 transações com falha não podem conter lançamentos contábeis
      for (const failedTx of failedTxs) {
        const entries = (await sqlite.execute({
          sql: 'SELECT count(*) as count FROM financial_ledger_entries WHERE transaction_id = ?',
          args: [failedTx.id],
        })).rows;
        expect(Number(entries[0].count)).toBe(0);
      }

      // As 40 transações comprovadas devem satisfazer double-entry estrito
      let totalProvenDebits = 0n;
      let totalProvenCredits = 0n;

      for (const compTx of completedTxs) {
        const entries = (await sqlite.execute({
          sql: 'SELECT direction, amount_base_units FROM financial_ledger_entries WHERE transaction_id = ?',
          args: [compTx.id],
        })).rows;

        expect(entries.length).toBe(2); // Exatamente 1 débito e 1 crédito

        let debits = 0n;
        let credits = 0n;
        for (const entry of entries) {
          const amt = BigInt(entry.amount_base_units as string);
          if (entry.direction === 'debit') debits += amt;
          if (entry.direction === 'credit') credits += amt;
        }

        expect(debits).toBe(credits);
        totalProvenDebits += debits;
        totalProvenCredits += credits;
      }

      // Total comprovado deve ser exatamente R$ 36.623,00 (3.662.300 centavos)
      expect(totalProvenDebits).toBe(3662300n);
      expect(totalProvenCredits).toBe(3662300n);

      // 4. Validação Contábil por Conta e Normal Balance
      // Conta 10 (Andressa: user_available, liability):
      // Saldo disponível = 0, Saldo devedor = 29.177,00 (locked)
      const acc10 = (await sqlite.execute('SELECT * FROM account_balances WHERE account_id = 10')).rows[0];
      expect(acc10.available_base_units).toBe('0');
      expect(acc10.locked_base_units).toBe('2917700');

      // Conta 11 (Tesouraria: treasury, asset):
      // Saldo disponível = 36.623,00 (3.662.300)
      const acc11 = (await sqlite.execute('SELECT * FROM account_balances WHERE account_id = 11')).rows[0];
      expect(acc11.available_base_units).toBe('3662300');

      // Conta 12 (Receita Mensalidade: payment_revenue, revenue):
      // Saldo disponível = 27.389,00 (2.738.900)
      const acc12 = (await sqlite.execute('SELECT * FROM account_balances WHERE account_id = 12')).rows[0];
      expect(acc12.available_base_units).toBe('2738900');

      // Conta 13 (Clearing Operacional: clearing, liability):
      // Saldo disponível = 9.234,00 (923.400)
      const acc13 = (await sqlite.execute('SELECT * FROM account_balances WHERE account_id = 13')).rows[0];
      expect(acc13.available_base_units).toBe('923400');

      // 5. Normal Balance Invariance Verification para todas as 4 contas do report
      const reportAccounts = (await sqlite.execute('SELECT id, account_class FROM financial_accounts WHERE id IN (10, 11, 12, 13)')).rows;
      for (const acc of reportAccounts) {
        const accId = acc.id as number;
        const accClass = acc.account_class as string;
        const debitNormal = isDebitNormal(accClass);

        const balRow = (await sqlite.execute({
          sql: 'SELECT available_base_units FROM account_balances WHERE account_id = ?',
          args: [accId],
        })).rows[0];

        const entries = (await sqlite.execute({
          sql: 'SELECT direction, amount_base_units FROM financial_ledger_entries WHERE account_id = ?',
          args: [accId],
        })).rows;

        let projected = 0n;
        for (const entry of entries) {
          const amt = BigInt(entry.amount_base_units as string);
          if (debitNormal) {
            projected += (entry.direction === 'debit' ? amt : -amt);
          } else {
            projected += (entry.direction === 'credit' ? amt : -amt);
          }
        }

        expect(BigInt(balRow.available_base_units as string)).toBe(projected);
      }
    } finally {
      try { sqlite.close(); } catch (e) {}
      try { unlinkSync(dbFile); } catch (e) {}
    }
  }, 30000);
});
