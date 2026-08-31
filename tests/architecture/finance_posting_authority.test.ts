import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

function getAllFiles(dirPath: string, arrayOfFiles: string[] = []): string[] {
  if (!fs.existsSync(dirPath)) return arrayOfFiles;
  const files = fs.readdirSync(dirPath);

  files.forEach((file) => {
    const fullPath = path.join(dirPath, file);
    if (fs.statSync(fullPath).isDirectory()) {
      getAllFiles(fullPath, arrayOfFiles);
    } else if (fullPath.endsWith('.ts') || fullPath.endsWith('.js')) {
      arrayOfFiles.push(fullPath);
    }
  });

  return arrayOfFiles;
}

describe('Static Architecture Gate: Single Financial Posting Authority & Dead Code Cleanliness', () => {
  const rootDir = path.resolve(__dirname, '../..');
  const srcDir = path.resolve(rootDir, 'src');

  it('prohibits existence of legacy DoubleEntryLedgerService.ts', () => {
    const legacyPath = path.resolve(srcDir, 'domains/finance/services/DoubleEntryLedgerService.ts');
    expect(fs.existsSync(legacyPath), `Legacy DoubleEntryLedgerService.ts must be completely removed`).toBe(false);
  });

  it('prohibits existence of legacy Money.ts entity', () => {
    const legacyMoneyPath = path.resolve(srcDir, 'domains/finance/entities/Money.ts');
    expect(fs.existsSync(legacyMoneyPath), `Legacy Money.ts must be completely removed in favor of Money256`).toBe(false);
  });

  it('prohibits existence of legacy src/domains/finance/use-cases directory', () => {
    const legacyUseCasesDir = path.resolve(srcDir, 'domains/finance/use-cases');
    expect(fs.existsSync(legacyUseCasesDir), `Legacy domain use-cases directory must be completely removed`).toBe(false);
  });

  it('prohibits direct ledger table insertion outside DrizzleFinanceRepository', () => {
    const allFiles = getAllFiles(srcDir);
    const forbiddenLedgerInsertions: string[] = [];

    allFiles.forEach((file) => {
      const relativePath = path.relative(srcDir, file);
      if (relativePath.includes('DrizzleFinanceRepository.ts')) {
        return;
      }

      const content = fs.readFileSync(file, 'utf-8');

      if (
        content.includes('insert(financialLedgerEntries)') ||
        content.includes('INSERT INTO financial_ledger_entries') ||
        content.includes('insert(financial_ledger_entries)') ||
        content.includes('sql`INSERT INTO financial_ledger_entries')
      ) {
        forbiddenLedgerInsertions.push(relativePath);
      }
    });

    expect(
      forbiddenLedgerInsertions,
      `Arquivos violando a autoridade única de posting: ${forbiddenLedgerInsertions.join(', ')}`
    ).toEqual([]);
  });

  it('prohibits Use Cases outside FinancialTransactionOrchestrator from direct repository balance mutation', () => {
    const useCasesDir = path.resolve(srcDir, 'application/finance/use-cases');
    if (!fs.existsSync(useCasesDir)) return;

    const useCaseFiles = getAllFiles(useCasesDir);
    const violatingUseCases: string[] = [];

    useCaseFiles.forEach((file) => {
      const basename = path.basename(file);
      if (
        basename === 'RecordLedgerTransactionUseCase.ts' ||
        basename === 'FinancialTransactionOrchestrator.ts'
      ) {
        return;
      }

      const content = fs.readFileSync(file, 'utf-8');
      if (content.includes('updateBalanceWithOCC(')) {
        violatingUseCases.push(basename);
      }
    });

    expect(
      violatingUseCases,
      `Use cases que tentam mutar saldos diretamente sem o Orchestrator: ${violatingUseCases.join(', ')}`
    ).toEqual([]);
  });
});
