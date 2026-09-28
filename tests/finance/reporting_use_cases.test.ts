import { describe, it, expect, vi } from 'vitest';
import { GetConsolidatedFinancialReportUseCase } from '../../src/application/finance/use-cases/GetConsolidatedFinancialReportUseCase';
import { GetExternalTransactionsUseCase } from '../../src/application/finance/use-cases/GetExternalTransactionsUseCase';
import { IFinanceRepository } from '../../src/application/ports/output/IFinanceRepository';
import { Result } from '../../src/shared/kernel/Result';
import { RepositoryError } from '../../src/shared/kernel/RepositoryError';

describe('Reporting & External Transactions Use Cases (Layer 2 DIP Purity)', () => {
  describe('GetConsolidatedFinancialReportUseCase', () => {
    it('deve retornar relatório com totais zerados quando repositório não encontrar movimentações', async () => {
      const mockRepo: Partial<IFinanceRepository> = {
        getConsolidatedReportRawData: vi.fn().mockResolvedValue(Result.ok([])),
      };

      const useCase = new GetConsolidatedFinancialReportUseCase(mockRepo as IFinanceRepository);
      const res = await useCase.execute();

      expect(res.isSuccess).toBe(true);
      const report = res.getValue();
      expect(report.totals.records).toBe(0);
      expect(report.totals.grossAmount).toBe('0.00');
      expect(report.sources).toEqual([]);
      expect(report.period.from).toBeNull();
      expect(report.period.to).toBeNull();
    });

    it('deve agregar múltiplos provedores e segmentar períodos forenses da Caixa', async () => {
      const mockData = [
        {
          id: 1,
          providerCode: 'BRADESCO',
          direction: 'credit' as const,
          amountBaseUnits: '10000', // R$ 100,00
          bankTimestamp: new Date('2022-01-10T12:00:00Z'),
          sourceFile: 'extrato_bradesco.csv',
          sourceFileHash: 'hash1',
          reconciliationStatus: 'matched',
        },
        {
          id: 2,
          providerCode: 'BRADESCO',
          direction: 'debit' as const,
          amountBaseUnits: '3000', // R$ 30,00
          bankTimestamp: new Date('2022-01-11T12:00:00Z'),
          sourceFile: 'extrato_bradesco.csv',
          sourceFileHash: 'hash1',
          reconciliationStatus: 'unmatched',
        },
        {
          id: 3,
          providerCode: 'CAIXA',
          direction: 'credit' as const,
          amountBaseUnits: '5000', // R$ 50,00 - Period A (< 2021-09-01)
          bankTimestamp: new Date('2019-06-01T12:00:00Z'),
          sourceFile: 'caixa_2019.csv',
          sourceFileHash: 'hashcaixa',
          reconciliationStatus: 'unmatched',
        },
        {
          id: 4,
          providerCode: 'CAIXA',
          direction: 'credit' as const,
          amountBaseUnits: '7000', // R$ 70,00 - Period B (>= 2021-09-01)
          bankTimestamp: new Date('2023-05-01T12:00:00Z'),
          sourceFile: 'caixa_2023.csv',
          sourceFileHash: 'hashcaixa2',
          reconciliationStatus: 'unmatched',
        },
      ];

      const mockRepo: Partial<IFinanceRepository> = {
        getConsolidatedReportRawData: vi.fn().mockResolvedValue(Result.ok(mockData)),
      };

      const useCase = new GetConsolidatedFinancialReportUseCase(mockRepo as IFinanceRepository);
      const res = await useCase.execute();

      expect(res.isSuccess).toBe(true);
      const report = res.getValue();

      // Total records = 4
      expect(report.totals.records).toBe(4);
      // Bradesco credit 100, debit 30; Caixa credit 50 + 70 = 120. Total gross = 100 + 30 + 50 + 70 = 250.00
      expect(report.totals.grossAmount).toBe('250.00');
      expect(report.totals.creditsAmount).toBe('220.00');
      expect(report.totals.debitsAmount).toBe('30.00');
      expect(report.totals.netAmount).toBe('190.00');

      // Caixa deve ter breakdown A e B
      const caixaSource = report.sources.find((s) => s.provider === 'CAIXA');
      expect(caixaSource).toBeDefined();
      expect(caixaSource?.sourceCondition).toBe('mista');
      expect(caixaSource?.breakdown?.periodA?.records).toBe(1);
      expect(caixaSource?.breakdown?.periodA?.creditsAmount).toBe('50.00');
      expect(caixaSource?.breakdown?.periodB?.records).toBe(1);
      expect(caixaSource?.breakdown?.periodB?.creditsAmount).toBe('70.00');
    });

    it('deve retornar falha quando o repositório falhar', async () => {
      const mockRepo: Partial<IFinanceRepository> = {
        getConsolidatedReportRawData: vi
          .fn()
          .mockResolvedValue(Result.err(RepositoryError.transient('Connection refused'))),
      };

      const useCase = new GetConsolidatedFinancialReportUseCase(mockRepo as IFinanceRepository);
      const res = await useCase.execute();

      expect(res.isFailure).toBe(true);
      expect(res.error).toContain('Connection refused');
    });
  });

  describe('GetExternalTransactionsUseCase', () => {
    it('deve consultar resumo e linhas paginadas via repositório respeitando sanitização de payload', async () => {
      const mockSummaryRows = [
        { providerCode: 'BRADESCO', amountBaseUnits: '10000', reconciliationStatus: 'unmatched' },
      ];

      const mockPaginatedRows = [
        {
          id: 10,
          providerCode: 'BRADESCO',
          providerName: 'Banco Bradesco S.A.',
          externalTransactionId: 'EXT-10',
          rawAmount: '100.00',
          amountBaseUnits: '10000',
          direction: 'credit',
          rawDescription: 'TED RECEBIDA',
          bankTimestamp: new Date('2023-01-01T10:00:00Z'),
          documentNumber: '12345',
          runningBalanceBaseUnits: '50000',
          sourceFile: 'file.csv',
          sourceFileHash: 'hash',
          rowFingerprint: 'fp',
          rawPayload: '{"secret":"data"}',
          status: 'pending',
          reconciliationStatus: 'unmatched',
          financialTransactionId: null,
        },
      ];

      const mockRepo: Partial<IFinanceRepository> = {
        getExternalTransactionsSummary: vi.fn().mockResolvedValue(Result.ok(mockSummaryRows)),
        getExternalTransactionsPaginated: vi.fn().mockResolvedValue(Result.ok(mockPaginatedRows)),
      };

      const useCase = new GetExternalTransactionsUseCase(mockRepo as IFinanceRepository);

      // 1. Sem includePayload -> rawPayload deve ser undefined
      const resWithoutPayload = await useCase.execute({ limit: 10 });
      expect(resWithoutPayload.isSuccess).toBe(true);
      const data1 = resWithoutPayload.getValue();
      expect(data1.summary.totalRecords).toBe(1);
      expect(data1.summary.totalGrossAmount).toBe('100.00');
      expect(data1.transactions[0].rawPayload).toBeUndefined();

      // 2. Com includePayload = true -> rawPayload deve ser retornado
      const resWithPayload = await useCase.execute({ limit: 10, includePayload: true });
      expect(resWithPayload.isSuccess).toBe(true);
      const data2 = resWithPayload.getValue();
      expect(data2.transactions[0].rawPayload).toBe('{"secret":"data"}');
    });

    it('deve limitar parâmetros de paginação e lidar com erros de repositório', async () => {
      const mockRepo: Partial<IFinanceRepository> = {
        getExternalTransactionsSummary: vi
          .fn()
          .mockResolvedValue(Result.err(RepositoryError.transient('DB error'))),
      };

      const useCase = new GetExternalTransactionsUseCase(mockRepo as IFinanceRepository);
      const res = await useCase.execute({ limit: 1000 }); // Deve ser limitado a 200

      expect(res.isFailure).toBe(true);
      expect(res.error).toContain('DB error');
    });
  });
});
