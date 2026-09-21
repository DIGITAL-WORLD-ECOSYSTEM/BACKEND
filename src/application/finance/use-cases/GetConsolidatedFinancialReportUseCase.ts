import { eq } from 'drizzle-orm';
import { Database } from '../../../db';
import { fiatExternalTransactions, fiatProviders } from '../../../db/finance/tables';
import { Result } from '../../../shared/kernel/Result';

export interface SourceReportItem {
  provider: string;
  sourceFile: string | null;
  sourceFileHash: string | null;
  sourceCondition: 'completa' | 'mista' | 'incompleta_nao_reconciliavel' | 'cadeia_continua';
  records: number;
  creditsBaseUnits: string;
  creditsAmount: string;
  debitsBaseUnits: string;
  debitsAmount: string;
  netBaseUnits: string;
  netAmount: string;
  breakdown?: {
    periodA?: {
      interval: string;
      condition: string;
      records: number;
      creditsAmount: string;
      debitsAmount: string;
      netAmount: string;
      statementBreaks: number;
    };
    periodB?: {
      interval: string;
      condition: string;
      records: number;
      creditsAmount: string;
      debitsAmount: string;
      netAmount: string;
      statementBreaks: number;
    };
  };
}

export interface ConsolidatedFinancialReport {
  period: {
    from: string | null;
    to: string | null;
  };
  sources: SourceReportItem[];
  totals: {
    records: number;
    grossBaseUnits: string;
    grossAmount: string;
    creditsBaseUnits: string;
    creditsAmount: string;
    debitsBaseUnits: string;
    debitsAmount: string;
    netBaseUnits: string;
    netAmount: string;
    reconciliationStatus: {
      unmatched: number;
      matched: number;
    };
  };
  metadata: {
    generatedAt: string;
    currency: string;
    accountingDisclaimer: string;
  };
}

function formatBaseUnitsToBRL(baseUnits: bigint): string {
  const isNeg = baseUnits < 0n;
  const abs = isNeg ? -baseUnits : baseUnits;
  const str = abs.toString().padStart(3, '0');
  const intPart = str.slice(0, -2);
  const decPart = str.slice(-2);
  return `${isNeg ? '-' : ''}${intPart}.${decPart}`;
}

export class GetConsolidatedFinancialReportUseCase {
  constructor(private readonly db: Database) {}

  async execute(): Promise<Result<ConsolidatedFinancialReport>> {
    try {
      // 1. Ler todas as movimentações da staging juntamente com o provedor
      const rows = await this.db
        .select({
          id: fiatExternalTransactions.id,
          providerCode: fiatProviders.code,
          direction: fiatExternalTransactions.direction,
          amountBaseUnits: fiatExternalTransactions.amountBaseUnits,
          bankTimestamp: fiatExternalTransactions.bankTimestamp,
          sourceFile: fiatExternalTransactions.sourceFile,
          sourceFileHash: fiatExternalTransactions.sourceFileHash,
          reconciliationStatus: fiatExternalTransactions.reconciliationStatus,
        })
        .from(fiatExternalTransactions)
        .innerJoin(fiatProviders, eq(fiatExternalTransactions.providerId, fiatProviders.id))
        .orderBy(fiatExternalTransactions.bankTimestamp);

      if (rows.length === 0) {
        return Result.ok({
          period: { from: null, to: null },
          sources: [],
          totals: {
            records: 0,
            grossBaseUnits: '0',
            grossAmount: '0.00',
            creditsBaseUnits: '0',
            creditsAmount: '0.00',
            debitsBaseUnits: '0',
            debitsAmount: '0.00',
            netBaseUnits: '0',
            netAmount: '0.00',
            reconciliationStatus: { unmatched: 0, matched: 0 },
          },
          metadata: {
            generatedAt: new Date().toISOString(),
            currency: 'BRL',
            accountingDisclaimer: 'A staging externa não possui movimentações registradas.',
          },
        });
      }

      // 2. Acumuladores de totais globais via BigInt
      let globalGrossBaseUnits = 0n;
      let globalCreditsBaseUnits = 0n;
      let globalDebitsBaseUnits = 0n;
      let unmatchedCount = 0;
      let matchedCount = 0;

      let minTs: number | null = null;
      let maxTs: number | null = null;

      // Agrupamento por provedor
      interface ProviderAccumulator {
        providerCode: string;
        sourceFile: string | null;
        sourceFileHash: string | null;
        records: number;
        creditsBaseUnits: bigint;
        debitsBaseUnits: bigint;
        // Caixa specific breakdown
        periodA?: { records: number; credits: bigint; debits: bigint };
        periodB?: { records: number; credits: bigint; debits: bigint };
      }

      const providerMap = new Map<string, ProviderAccumulator>();

      for (const row of rows) {
        const code = row.providerCode;
        const amt = BigInt(row.amountBaseUnits || '0');
        const isCredit = row.direction === 'credit';

        globalGrossBaseUnits += amt;
        if (isCredit) {
          globalCreditsBaseUnits += amt;
        } else {
          globalDebitsBaseUnits += amt;
        }

        if (row.reconciliationStatus === 'unmatched') {
          unmatchedCount++;
        } else if (row.reconciliationStatus === 'matched') {
          matchedCount++;
        }

        if (row.bankTimestamp) {
          const ts = new Date(row.bankTimestamp).getTime();
          if (minTs === null || ts < minTs) minTs = ts;
          if (maxTs === null || ts > maxTs) maxTs = ts;
        }

        if (!providerMap.has(code)) {
          providerMap.set(code, {
            providerCode: code,
            sourceFile: row.sourceFile,
            sourceFileHash: row.sourceFileHash,
            records: 0,
            creditsBaseUnits: 0n,
            debitsBaseUnits: 0n,
            ...(code === 'CAIXA'
              ? {
                  periodA: { records: 0, credits: 0n, debits: 0n },
                  periodB: { records: 0, credits: 0n, debits: 0n },
                }
              : {}),
          });
        }

        const acc = providerMap.get(code)!;
        acc.records++;
        if (isCredit) {
          acc.creditsBaseUnits += amt;
        } else {
          acc.debitsBaseUnits += amt;
        }

        // Segmentação forense da Caixa (Período A: 2016-2020 vs Período B: 2021-2026)
        if (code === 'CAIXA' && acc.periodA && acc.periodB) {
          const ts = row.bankTimestamp ? new Date(row.bankTimestamp).getTime() : 0;
          // Divisor: 01/09/2021 00:00:00 UTC (1630454400000)
          const CUTOFF_TS = 1630454400000;
          if (ts < CUTOFF_TS) {
            acc.periodA.records++;
            if (isCredit) acc.periodA.credits += amt;
            else acc.periodA.debits += amt;
          } else {
            acc.periodB.records++;
            if (isCredit) acc.periodB.credits += amt;
            else acc.periodB.debits += amt;
          }
        }
      }

      // 3. Montar itens de fontes com classificação
      const sources: SourceReportItem[] = [];

      for (const [code, acc] of providerMap.entries()) {
        const netBaseUnits = acc.creditsBaseUnits - acc.debitsBaseUnits;

        let sourceCondition: 'completa' | 'mista' | 'incompleta_nao_reconciliavel' | 'cadeia_continua' = 'completa';
        let breakdown = undefined;

        if (code === 'CAIXA' && acc.periodA && acc.periodB) {
          sourceCondition = 'mista';
          const periodANet = acc.periodA.credits - acc.periodA.debits;
          const periodBNet = acc.periodB.credits - acc.periodB.debits;

          breakdown = {
            periodA: {
              interval: '2016-05-30 a 2020-12-31',
              condition: 'incompleta_nao_reconciliavel',
              records: acc.periodA.records,
              creditsAmount: formatBaseUnitsToBRL(acc.periodA.credits),
              debitsAmount: formatBaseUnitsToBRL(acc.periodA.debits),
              netAmount: formatBaseUnitsToBRL(periodANet),
              statementBreaks: 33,
            },
            periodB: {
              interval: '2021-09-01 a 2026-08-11',
              condition: 'cadeia_continua',
              records: acc.periodB.records,
              creditsAmount: formatBaseUnitsToBRL(acc.periodB.credits),
              debitsAmount: formatBaseUnitsToBRL(acc.periodB.debits),
              netAmount: formatBaseUnitsToBRL(periodBNet),
              statementBreaks: 0,
            },
          };
        }

        sources.push({
          provider: code,
          sourceFile: acc.sourceFile,
          sourceFileHash: acc.sourceFileHash,
          sourceCondition,
          records: acc.records,
          creditsBaseUnits: acc.creditsBaseUnits.toString(),
          creditsAmount: formatBaseUnitsToBRL(acc.creditsBaseUnits),
          debitsBaseUnits: acc.debitsBaseUnits.toString(),
          debitsAmount: formatBaseUnitsToBRL(acc.debitsBaseUnits),
          netBaseUnits: netBaseUnits.toString(),
          netAmount: formatBaseUnitsToBRL(netBaseUnits),
          breakdown,
        });
      }

      // Ordenar fontes: Bradesco, Cora, Inter, Caixa
      const sortOrder: Record<string, number> = { BRADESCO: 1, CORA: 2, INTER: 3, CAIXA: 4 };
      sources.sort((a, b) => (sortOrder[a.provider] || 99) - (sortOrder[b.provider] || 99));

      const globalNetBaseUnits = globalCreditsBaseUnits - globalDebitsBaseUnits;

      return Result.ok({
        period: {
          from: minTs ? new Date(minTs).toISOString() : null,
          to: maxTs ? new Date(maxTs).toISOString() : null,
        },
        sources,
        totals: {
          records: rows.length,
          grossBaseUnits: globalGrossBaseUnits.toString(),
          grossAmount: formatBaseUnitsToBRL(globalGrossBaseUnits),
          creditsBaseUnits: globalCreditsBaseUnits.toString(),
          creditsAmount: formatBaseUnitsToBRL(globalCreditsBaseUnits),
          debitsBaseUnits: globalDebitsBaseUnits.toString(),
          debitsAmount: formatBaseUnitsToBRL(globalDebitsBaseUnits),
          netBaseUnits: globalNetBaseUnits.toString(),
          netAmount: formatBaseUnitsToBRL(globalNetBaseUnits),
          reconciliationStatus: {
            unmatched: unmatchedCount,
            matched: matchedCount,
          },
        },
        metadata: {
          generatedAt: new Date().toISOString(),
          currency: 'BRL',
          accountingDisclaimer:
            'AVISO CONTÁBIL: Os registros apresentados residem na staging fiat_external_transactions e possuem status unmatched. Este relatório reflete estritamente a movimentação bruta e líquida informada pelos documentos bancários externos e NÃO representa lançamentos contábeis no ledger ou saldos patrimoniais da tesouraria.',
        },
      });
    } catch (err: any) {
      return Result.fail(`Erro ao gerar relatório financeiro consolidado: ${err.message || String(err)}`);
    }
  }
}
