import { and, eq, gt, gte, lte, sql } from 'drizzle-orm';
import { Database } from '../../../db';
import { fiatExternalTransactions, fiatProviders } from '../../../db/finance/tables';
import { Result } from '../../../shared/kernel/Result';

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

function formatBaseUnitsToBRL(baseUnits: bigint): string {
  const isNeg = baseUnits < 0n;
  const abs = isNeg ? -baseUnits : baseUnits;
  const str = abs.toString().padStart(3, '0');
  const intPart = str.slice(0, -2);
  const decPart = str.slice(-2);
  return `${isNeg ? '-' : ''}${intPart}.${decPart}`;
}

export class GetExternalTransactionsUseCase {
  constructor(private readonly db: Database) {}

  async execute(filters: GetExternalTransactionsFilters = {}): Promise<Result<GetExternalTransactionsResponse>> {
    try {
      const limit = Math.min(Math.max(Number(filters.limit) || 50, 1), 200);
      const cursor = filters.cursor ? Number(filters.cursor) : undefined;
      const includePayload = Boolean(filters.includePayload);

      // 1. Montar predicados de filtro comuns (sem cursor)
      const commonConditions = [];

      if (filters.providerCode) {
        commonConditions.push(eq(fiatProviders.code, filters.providerCode.toUpperCase()));
      }

      if (filters.direction) {
        commonConditions.push(eq(fiatExternalTransactions.direction, filters.direction.toLowerCase() as 'credit' | 'debit'));
      }

      if (filters.startDate) {
        const startTs = typeof filters.startDate === 'string' ? new Date(filters.startDate).getTime() : Number(filters.startDate);
        if (!isNaN(startTs)) {
          commonConditions.push(gte(fiatExternalTransactions.bankTimestamp, new Date(startTs)));
        }
      }

      if (filters.endDate) {
        const endTs = typeof filters.endDate === 'string' ? new Date(filters.endDate).getTime() : Number(filters.endDate);
        if (!isNaN(endTs)) {
          commonConditions.push(lte(fiatExternalTransactions.bankTimestamp, new Date(endTs)));
        }
      }

      if (filters.reconciliationStatus) {
        commonConditions.push(
          eq(fiatExternalTransactions.reconciliationStatus, filters.reconciliationStatus.toLowerCase() as any)
        );
      }

      const whereClause = commonConditions.length > 0 ? and(...commonConditions) : undefined;

      // 2. Consulta de agregação do summary baseada estritamente nos filtros aplicados
      const summaryRows = await this.db
        .select({
          providerCode: fiatProviders.code,
          amountBaseUnits: fiatExternalTransactions.amountBaseUnits,
          reconciliationStatus: fiatExternalTransactions.reconciliationStatus,
        })
        .from(fiatExternalTransactions)
        .innerJoin(fiatProviders, eq(fiatExternalTransactions.providerId, fiatProviders.id))
        .where(whereClause);

      let totalGrossBaseUnits = 0n;
      const sourcesMap: Record<string, { records: number; grossBaseUnits: bigint }> = {};
      let dominantReconStatus = 'unmatched';

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

      // 3. Consulta paginada por keyset (id > cursor)
      const paginatedConditions = [...commonConditions];
      if (cursor !== undefined && !isNaN(cursor)) {
        paginatedConditions.push(gt(fiatExternalTransactions.id, cursor));
      }

      const paginatedWhere = paginatedConditions.length > 0 ? and(...paginatedConditions) : undefined;

      const rows = await this.db
        .select({
          id: fiatExternalTransactions.id,
          providerCode: fiatProviders.code,
          providerName: fiatProviders.name,
          externalTransactionId: fiatExternalTransactions.externalTransactionId,
          rawAmount: fiatExternalTransactions.rawAmount,
          amountBaseUnits: fiatExternalTransactions.amountBaseUnits,
          direction: fiatExternalTransactions.direction,
          rawDescription: fiatExternalTransactions.rawDescription,
          bankTimestamp: fiatExternalTransactions.bankTimestamp,
          documentNumber: fiatExternalTransactions.documentNumber,
          runningBalanceBaseUnits: fiatExternalTransactions.runningBalanceBaseUnits,
          sourceFile: fiatExternalTransactions.sourceFile,
          sourceFileHash: fiatExternalTransactions.sourceFileHash,
          rowFingerprint: fiatExternalTransactions.rowFingerprint,
          rawPayload: fiatExternalTransactions.rawPayload,
          status: fiatExternalTransactions.status,
          reconciliationStatus: fiatExternalTransactions.reconciliationStatus,
          financialTransactionId: fiatExternalTransactions.financialTransactionId,
        })
        .from(fiatExternalTransactions)
        .innerJoin(fiatProviders, eq(fiatExternalTransactions.providerId, fiatProviders.id))
        .where(paginatedWhere)
        .orderBy(fiatExternalTransactions.id)
        .limit(limit + 1);

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
    } catch (err: any) {
      return Result.fail(`Erro ao consultar transações externas: ${err.message || String(err)}`);
    }
  }
}
