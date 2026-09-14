import type { LedgerEntryDirection } from '../value-objects/BaseUnits';

/**
 * Raw persistence record de infraestrutura/transporte lido ou gravado no Cloudflare D1.
 *
 * ATENÇÃO ARQUITETURAL:
 * Este contrato NÃO representa um valor financeiro validado pelo domínio.
 * Ele reflete a representação serializada física do SQLite/D1.
 * Todo dado contábil transportado por este record DEVE ser validado através
 * dos Value Objects (BaseUnits, Money256) e Aggregate (LedgerTransaction)
 * antes de qualquer operação financeira de negócio.
 */
export interface FinancialLedgerEntryRecord {
  readonly accountId: number;
  readonly assetId: number;
  readonly direction: LedgerEntryDirection;
  readonly amountBaseUnits: string;
}
