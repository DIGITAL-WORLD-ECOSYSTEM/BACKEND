export interface FinancialLedgerEntryRecord {
  accountId: number;
  assetId: number;
  direction: 'debit' | 'credit';
  amountBaseUnits: string;
}
