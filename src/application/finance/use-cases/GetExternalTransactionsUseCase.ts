import { Result } from '../../../shared/kernel/Result';
import {
  IFinanceRepository,
  ExternalTransactionsFilterCriteria,
} from '../../ports/output/IFinanceRepository';
import { formatBaseUnitsToBRL } from '../utils/currencyFormatter';

export interface GetExternalTransactionsFilters {
  limit?: number;
  cursor?: number;
  providerCode?: string;
  direction?: 'credit' | 'debit';
  startDate?: number | string;
  endDate?: number | string;
  reconciliationStatus?: string;
  includePayload?: boolean;
}

export interface ExternalTransactionSummarySource {
  records: number;
  grossBaseUnits: string;
  grossAmount: string;
}

export interface ExternalTransactionSummary {
  totalRecords: number;
  totalGrossBaseUnits: string;
  totalGrossAmount: string;
  currency: string;
  reconciliationStatus: string;
  sources: Record<string, ExternalTransactionSummarySource>;
}

export interface ExternalTransactionItem {
  id: number;
  provider: {
    code: string;
    name: string;
  };
  externalTransactionId: string;
  rawAmount: string;
  amountBaseUnits: string | null;
  currency: string;
  direction: string;
  description: string | null;
  bankTimestamp: string | null;
  documentNumber: string | null;
  runningBalanceBaseUnits: string | null;
  source: {
    file: string | null;
    fileHash: string | null;
    rowFingerprint: string | null;
  };
  rawPayload?: string | null;
  status: string;
  reconciliationStatus: string;
  financialTransactionId: number | null;
}

export interface GetExternalTransactionsResponse {
  summary: ExternalTransactionSummary;
  pagination: {
    limit: number;
    nextCursor: number | null;
    hasMore: boolean;
  };
  transactions: ExternalTransactionItem[];
}

export class GetExternalTransactionsUseCase {
  constructor(private readonly financeRepo: IFinanceRepository) {}

  async execute(filters: GetExternalTransactionsFilters = {}): Promise<Result<GetExternalTransactionsResponse>> {
    try {
      const limit = Math.min(Math.max(Number(filters.limit) || 50, 1), 200);
      const cursor = filters.cursor ? Number(filters.cursor) : undefined;
      const includePayload = Boolean(filters.includePayload);

      const criteria: ExternalTransactionsFilterCriteria = {
        limit,
        cursor,
        providerCode: filters.providerCode,
        direction: filters.direction,
        startDate: filters.startDate,
        endDate: filters.endDate,
        reconciliationStatus: filters.reconciliationStatus,
      };

      // 1. Consulta de agregação do summary via repositório
      const summaryRes = await this.financeRepo.getExternalTransactionsSummary(criteria);
      if (summaryRes.isFailure) {
        const errorMsg = summaryRes.error || (summaryRes.typedError as any)?.message || 'Erro desconhecido';
        return Result.fail(`Erro ao carregar resumo de transações externas: ${errorMsg}`);
      }
      const summaryRows = summaryRes.getValue();

      let totalGrossBaseUnits = 0n;
      const sourcesMap: Record<string, { records: number; grossBaseUnits: bigint }> = {};
      const dominantReconStatus = 'unmatched';

      for (const row of summaryRows) {
        const code = row.providerCode;
        const amt = BigInt(row.amountBaseUnits || '0');
        totalGrossBaseUnits += amt;

        if (!sourcesMap[code]) {
          sourcesMap[code] = { records: 0, grossBaseUnits: 0n };
        }
        sourcesMap[code].records++;
        sourcesMap[code].grossBaseUnits += amt;
      }

      const sources: Record<string, ExternalTransactionSummarySource> = {};
      for (const [code, data] of Object.entries(sourcesMap)) {
        sources[code] = {
          records: data.records,
          grossBaseUnits: data.grossBaseUnits.toString(),
          grossAmount: formatBaseUnitsToBRL(data.grossBaseUnits),
        };
      }

      const summary: ExternalTransactionSummary = {
        totalRecords: summaryRows.length,
        totalGrossBaseUnits: totalGrossBaseUnits.toString(),
        totalGrossAmount: formatBaseUnitsToBRL(totalGrossBaseUnits),
        currency: 'BRL',
        reconciliationStatus: filters.reconciliationStatus || dominantReconStatus,
        sources,
      };

      // 2. Consulta paginada por keyset via repositório
      const paginatedRes = await this.financeRepo.getExternalTransactionsPaginated(criteria, limit, cursor);
      if (paginatedRes.isFailure) {
        const errorMsg = paginatedRes.error || (paginatedRes.typedError as any)?.message || 'Erro desconhecido';
        return Result.fail(`Erro ao consultar transações externas paginadas: ${errorMsg}`);
      }
      const rows = paginatedRes.getValue();

      const hasMore = rows.length > limit;
      const items = hasMore ? rows.slice(0, limit) : rows;
      const nextCursor = items.length > 0 ? items[items.length - 1].id : null;

      const transactions: ExternalTransactionItem[] = items.map((r) => ({
        id: r.id,
        provider: {
          code: r.providerCode,
          name: r.providerName,
        },
        externalTransactionId: r.externalTransactionId,
        rawAmount: r.rawAmount,
        amountBaseUnits: r.amountBaseUnits,
        currency: 'BRL',
        direction: r.direction,
        description: r.rawDescription,
        bankTimestamp: r.bankTimestamp ? new Date(r.bankTimestamp).toISOString() : null,
        documentNumber: r.documentNumber,
        runningBalanceBaseUnits: r.runningBalanceBaseUnits,
        source: {
          file: r.sourceFile,
          fileHash: r.sourceFileHash,
          rowFingerprint: r.rowFingerprint,
        },
        ...(includePayload ? { rawPayload: r.rawPayload } : {}),
        status: r.status,
        reconciliationStatus: r.reconciliationStatus,
        financialTransactionId: r.financialTransactionId,
      }));

      return Result.ok({
        summary,
        pagination: {
          limit,
          nextCursor: hasMore ? nextCursor : null,
          hasMore,
        },
        transactions,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return Result.fail(`Erro ao consultar transações externas: ${message}`);
    }
  }
}
