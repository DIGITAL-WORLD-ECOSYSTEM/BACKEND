/**
 * Metadata and forensic configuration parameters for consolidated financial reporting.
 * Extracts hardcoded values out of the application use cases to satisfy architectural purity.
 */

/**
 * Cutoff timestamp separating Caixa Period A and Period B:
 * 01/09/2021 00:00:00 UTC (1630454400000)
 */
export const CAIXA_FORENSIC_CUTOFF_TS = 1630454400000;

export const CAIXA_FORENSIC_INTERVAL_A = '2016-05-30 a 2020-12-31';
export const CAIXA_FORENSIC_CONDITION_A = 'incompleta_nao_reconciliavel';
export const CAIXA_STATEMENT_BREAKS_PERIOD_A = 33;

export const CAIXA_FORENSIC_INTERVAL_B = '2021-09-01 a 2026-08-11';
export const CAIXA_FORENSIC_CONDITION_B = 'cadeia_continua';
export const CAIXA_STATEMENT_BREAKS_PERIOD_B = 0;

/**
 * Standard provider ordering for consolidated financial reports.
 */
export const PROVIDER_SORT_ORDER: Readonly<Record<string, number>> = Object.freeze({
  BRADESCO: 1,
  CORA: 2,
  INTER: 3,
  CAIXA: 4,
});
