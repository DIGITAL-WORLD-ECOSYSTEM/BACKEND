import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import * as cp from 'node:child_process';
import * as xlsx from 'xlsx';
import { eq } from 'drizzle-orm';
import { IFinanceRepository } from '../../application/ports/output/IFinanceRepository';
import { fiatProviders, financialAssets } from '../../db/finance/tables';
import { Result } from '../../shared/kernel/Result';

export interface ImportRowError {
  rowNumber: number;
  error: string;
  rawRow?: any;
}

export interface ImportSummary {
  sourceFile: string;
  sourceFileHash: string;
  providerCode: string;
  providerId: number;
  totalRowsRead: number;
  inserted: number;
  skippedDuplicates: number;
  invalid: number;
  totalAmountBaseUnits: string;
  errors: ImportRowError[];
}

export interface CaixaPdfSummary {
  sourceFile: string;
  sourceFileHash: string;
  providerCode: 'CAIXA';
  accountNumber: string;
  accountHolder: string;
  totalRecords: number;
  creditsCount: number;
  debitsCount: number;
  zeroCount: number;
  totalCreditBaseUnits: string;
  totalDebitBaseUnits: string;
  declaredInitialBalance: string;
  observedInitialBalance: string;
  observedFinalBalance: string;
  inserted: number;
  skippedDuplicates: number;
  invalid: number;
  errors: ImportRowError[];
  dryRun: boolean;
}

export interface BankConfig {
  sheetName: string;
  dateCol: number;
  descCol: number;
  amountCol: number;
  typeCol: number;
  docCol?: number;
}

/**
 * Converte qualquer valor monetário (string formatada ou número do Excel)
 * para a representação canônica em centavos (string de inteiros), SEM USAR
 * parseFloat(), Number() ou qualquer aritmética de ponto flutuante.
 */
export function parseToCentavosString(val: unknown): {
  rawAmount: string;
  amountBaseUnits: string;
} {
  if (val === null || val === undefined || val === '') {
    return { rawAmount: '', amountBaseUnits: '0' };
  }

  const rawStr = String(val).trim();
  let s = rawStr.replace(/[R$\s]/g, '');
  let isNegative = false;
  if (s.startsWith('-')) {
    isNegative = true;
    s = s.slice(1).trim();
  }

  let intPart = '';
  let decPart = '';
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');

  if (lastComma > -1 && lastDot > -1) {
    if (lastComma > lastDot) {
      // Formato brasileiro: 1.234,56
      intPart = s.slice(0, lastComma).replace(/\./g, '');
      decPart = s.slice(lastComma + 1);
    } else {
      // Formato americano: 1,234.56
      intPart = s.slice(0, lastDot).replace(/,/g, '');
      decPart = s.slice(lastDot + 1);
    }
  } else if (lastComma > -1) {
    // Apenas vírgula: 1234,56
    intPart = s.slice(0, lastComma);
    decPart = s.slice(lastComma + 1);
  } else if (lastDot > -1) {
    // Apenas ponto: 1234.56
    intPart = s.slice(0, lastDot);
    decPart = s.slice(lastDot + 1);
  } else {
    // Sem separador decimal: 100
    intPart = s;
    decPart = '';
  }

  intPart = intPart.replace(/\D/g, '');
  decPart = decPart.replace(/\D/g, '');

  if (decPart.length === 0) {
    decPart = '00';
  } else if (decPart.length === 1) {
    decPart = decPart + '0';
  } else if (decPart.length > 2) {
    decPart = decPart.slice(0, 2);
  }

  const combined = (intPart || '0') + decPart;
  // Normalização de zeros à esquerda via BigInt
  const canonical = BigInt(combined).toString();

  return {
    rawAmount: rawStr,
    amountBaseUnits: isNegative ? '-' + canonical : canonical,
  };
}

/**
 * Converte datas de extratos bancários para Date UTC determinístico.
 * Suporta formatos ISO (YYYY-MM-DD) e brasileiro (DD/MM/YYYY).
 */
export function parseBankDate(val: unknown): Date | null {
  if (!val) return null;
  const s = String(val).trim();

  // Formato ISO: YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const parts = s.split(/[-T\s]/);
    const y = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10) - 1;
    const d = parseInt(parts[2], 10);
    return new Date(Date.UTC(y, m, d, 12, 0, 0));
  }

  // Formato Brasileiro: DD/MM/YYYY
  if (/^\d{2}\/\d{2}\/\d{4}/.test(s)) {
    const parts = s.split(/[/:\s]/);
    const d = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10) - 1;
    const y = parseInt(parts[2], 10);
    return new Date(Date.UTC(y, m, d, 12, 0, 0));
  }

  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Serviço de Ingestão Histórica de Extratos Bancários.
 *
 * Responsável exclusivo por:
 * 1. Leitura literal das linhas de extrato (.xlsx / .csv).
 * 2. Cálculo do SHA-256 íntegro do arquivo de origem.
 * 3. Geração de row_fingerprint determinístico por linha.
 * 4. Normalização monetária canônica em centavos (sem float).
 * 5. Resolução dinâmica de provider_id por code (sem IDs fixos).
 * 6. Política Skip-on-Conflict (duplicatas existentes são puladas sem quebrar o lote).
 * 7. Inserção na staging `fiat_external_transactions` com:
 *    - financial_transaction_id = NULL
 *    - reconciliation_status = 'unmatched'
 *    - raw_payload íntegro preservado
 */
export class FinancialHistoricalImportService {
  private static readonly BANK_CONFIGS: Record<string, BankConfig> = {
    BRADESCO: {
      sheetName: 'Entradas PIX',
      dateCol: 0,
      descCol: 1,
      amountCol: 2,
      typeCol: 3,
    },
    CORA: {
      sheetName: 'Entradas (Pix e outros)',
      dateCol: 0,
      descCol: 1,
      docCol: 2,
      amountCol: 3,
      typeCol: 4,
    },
    INTER: {
      sheetName: 'Entradas Banco Inter',
      dateCol: 0,
      descCol: 1,
      amountCol: 2,
      typeCol: 3,
    },
  };

  constructor(
    private readonly db: any,
    private readonly financeRepo: IFinanceRepository,
  ) {}

  /**
   * Resolve o ID físico do provedor consultando a tabela `fiat_providers` pelo seu código de negócio.
   * NUNCA assume IDs numéricos fixos.
   */
  async resolveProviderId(code: string): Promise<Result<number>> {
    try {
      const normalizedCode = code.toUpperCase().trim();
      const [row] = await this.db
        .select({ id: fiatProviders.id, status: fiatProviders.status })
        .from(fiatProviders)
        .where(eq(fiatProviders.code, normalizedCode))
        .limit(1);

      if (!row) {
        return Result.fail(
          `Provedor com código '${code}' não foi encontrado no banco ativo. Carga bloqueada.`
        );
      }

      if (row.status !== 'active') {
        return Result.fail(
          `Provedor '${code}' está com status '${row.status}' (esperado: 'active'). Carga bloqueada.`
        );
      }

      return Result.ok(row.id);
    } catch (e: any) {
      return Result.fail(`Erro ao consultar provedor '${code}': ${e.message}`);
    }
  }

  /**
   * Resolve o ID do ativo BRL no banco ativo.
   */
  async resolveBrlAssetId(): Promise<Result<number>> {
    try {
      const [row] = await this.db
        .select({ id: financialAssets.id })
        .from(financialAssets)
        .where(eq(financialAssets.code, 'BRL'))
        .limit(1);

      if (!row) {
        return Result.fail(
          `Ativo canônico 'BRL' não encontrado no banco ativo. Carga bloqueada.`
        );
      }

      return Result.ok(row.id);
    } catch (e: any) {
      return Result.fail(`Erro ao consultar ativo BRL: ${e.message}`);
    }
  }

  /**
   * Importa um arquivo de extrato bancário XLSX para a staging fiat_external_transactions.
   */
  async importBankStatementFile(
    filePath: string,
    providerCodeInput: string,
    options: {
      maxRows?: number; // Para execução de lote piloto
      customSheetName?: string;
    } = {}
  ): Promise<Result<ImportSummary>> {
    const providerCode = providerCodeInput.toUpperCase().trim();

    // 1. Validar existência do arquivo
    if (!fs.existsSync(filePath)) {
      return Result.fail(`Arquivo de extrato não encontrado no caminho: ${filePath}`);
    }

    // 2. Calcular SHA-256 dos bytes brutos originais do arquivo
    const fileBuffer = fs.readFileSync(filePath);
    const sourceFileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

    // 3. Resolver provedor e ativo dinamicamente no banco
    const providerRes = await this.resolveProviderId(providerCode);
    if (providerRes.isFailure) {
      return Result.fail(providerRes.error || 'Falha ao resolver provedor.');
    }
    const providerId = providerRes.getValue();

    const assetRes = await this.resolveBrlAssetId();
    if (assetRes.isFailure) {
      return Result.fail(assetRes.error || 'Falha ao resolver ativo BRL.');
    }
    const brlAssetId = assetRes.getValue();

    // 4. Configuração de colunas do banco
    const config = FinancialHistoricalImportService.BANK_CONFIGS[providerCode];
    if (!config) {
      return Result.fail(
        `Configuração de colunas para o banco '${providerCode}' não encontrada.`
      );
    }

    const sheetName = options.customSheetName || config.sheetName;

    // 5. Ler planilha
    let workbook: xlsx.WorkBook;
    try {
      workbook = xlsx.read(fileBuffer, { type: 'buffer', raw: true });
    } catch (e: any) {
      return Result.fail(`Falha ao decodificar arquivo XLSX: ${e.message}`);
    }

    const worksheet = workbook.Sheets[sheetName];
    if (!worksheet) {
      return Result.fail(
        `Aba '${sheetName}' não encontrada na planilha. Abas disponíveis: ${workbook.SheetNames.join(', ')}`
      );
    }

    const rawRows: any[][] = xlsx.utils.sheet_to_json(worksheet, {
      header: 1,
      raw: true,
    });

    if (rawRows.length <= 1) {
      return Result.fail(`A planilha '${sheetName}' não possui linhas de dados.`);
    }

    const headers = rawRows[0];
    const dataRows = rawRows.slice(1);

    const summary: ImportSummary = {
      sourceFile: filePath,
      sourceFileHash,
      providerCode,
      providerId,
      totalRowsRead: 0,
      inserted: 0,
      skippedDuplicates: 0,
      invalid: 0,
      totalAmountBaseUnits: '0',
      errors: [],
    };

    let totalAmountBigInt = 0n;
    const limit = options.maxRows ? Math.min(options.maxRows, dataRows.length) : dataRows.length;

    // 6. Processar linhas
    for (let i = 0; i < limit; i++) {
      const row = dataRows[i];
      const rowNumber = i + 2; // Linha 1 é o cabeçalho no Excel (1-indexed)

      // Ignorar linhas completamente vazias
      if (!row || row.length === 0 || (!row[config.dateCol] && !row[config.amountCol] && !row[config.descCol])) {
        continue;
      }

      summary.totalRowsRead++;

      // Extrair dados das colunas configuradas
      const rawDate = row[config.dateCol];
      const rawDesc = row[config.descCol];
      const rawAmountVal = row[config.amountCol];
      const rawType = row[config.typeCol];
      const rawDoc = config.docCol !== undefined ? row[config.docCol] : null;

      // Validação e normalização de data
      const bankDate = parseBankDate(rawDate);
      if (!bankDate) {
        // Pula linhas de totalizador ("TOTAL GERAL", "TOTAL DE ENTRADAS"), notas ou notas numeradas (1), 2), etc.)
        const rowStr = JSON.stringify(row).toLowerCase();
        const rawDateStr = String(rawDate || '').trim();
        if (
          !rawDate ||
          rowStr.includes('total') ||
          rowStr.includes('observaç') ||
          rowStr.includes('resumo') ||
          rowStr.includes('extrato') ||
          /^\d+\)/.test(rawDateStr)
        ) {
          continue;
        }

        summary.invalid++;
        summary.errors.push({
          rowNumber,
          error: `Data inválida ou ausente: '${rawDate}'`,
          rawRow: row,
        });
        continue;
      }

      // Validação e normalização monetária (sem float)
      const { rawAmount, amountBaseUnits } = parseToCentavosString(rawAmountVal);
      if (amountBaseUnits === '0' && rawAmountVal !== 0 && rawAmountVal !== '0') {
        summary.invalid++;
        summary.errors.push({
          rowNumber,
          error: `Valor monetário inválido: '${rawAmountVal}'`,
          rawRow: row,
        });
        continue;
      }

      const rawDescription = rawDesc !== undefined && rawDesc !== null ? String(rawDesc).trim() : null;
      const documentNumber = rawDoc !== undefined && rawDoc !== null ? String(rawDoc).trim() : null;
      const operationType = rawType !== undefined && rawType !== null ? String(rawType).trim() : null;

      // ID de transação externa estável
      const fileBaseName = path.basename(filePath, path.extname(filePath));
      const externalTransactionId = `${providerCode}-${fileBaseName}-L${rowNumber}`;

      // 7. Cálculo do row_fingerprint determinístico
      const canonicalPayload = {
        amountBaseUnits,
        bankTimestampMs: bankDate.getTime(),
        direction: 'credit',
        documentNumber: documentNumber || '',
        operationType: operationType || '',
        providerCode,
        rawAmount,
        rawDescription: rawDescription || '',
        rowNumber,
        sourceFileName: path.basename(filePath),
      };

      const sortedKeys = Object.keys(canonicalPayload).sort() as Array<keyof typeof canonicalPayload>;
      const canonicalString = sortedKeys.map((k) => `${k}:${canonicalPayload[k]}`).join('|');
      const rowFingerprint = crypto.createHash('sha256').update(canonicalString).digest('hex');

      // 8. Checagem de duplicata prévia (Skip-on-Conflict)
      const existingRes = await this.financeRepo.getFiatExternalTransactionByFingerprint(rowFingerprint);
      if (existingRes.isOk() && existingRes.getValue() !== null) {
        summary.skippedDuplicates++;
        continue;
      }

      // 9. Montagem do payload bruto íntegro
      const rawPayload = JSON.stringify({
        rowNumber,
        headers,
        cells: row,
        importedAt: new Date().toISOString(),
      });

      // 10. Inserção na staging fiat_external_transactions
      const insertRes = await this.financeRepo.insertFiatExternalTransaction({
        providerId,
        fiatAccountId: null,
        externalTransactionId,
        rawAmount,
        amountBaseUnits,
        direction: 'credit',
        assetId: brlAssetId,
        rawDescription,
        bankTimestamp: bankDate,
        documentNumber,
        runningBalanceBaseUnits: null,
        sourceFile: filePath,
        sourceFileHash,
        rowFingerprint,
        rawPayload,
        status: 'completed',
        reconciliationStatus: 'unmatched',
        financialTransactionId: null,
      });

      if (insertRes.isOk()) {
        summary.inserted++;
        totalAmountBigInt += BigInt(amountBaseUnits);
      } else {
        const errMsg = insertRes.error || insertRes.typedError?.message || '';
        // Conflito de UNIQUE concorrente é contabilizado como duplicata
        if (errMsg.includes('UNIQUE') || errMsg.includes('constraint')) {
          summary.skippedDuplicates++;
        } else {
          summary.invalid++;
          summary.errors.push({
            rowNumber,
            error: errMsg,
            rawRow: row,
          });
        }
      }
    }

    summary.totalAmountBaseUnits = totalAmountBigInt.toString();
    return Result.ok(summary);
  }

  /**
   * Importa ou executa em dry-run o extrato bancário PDF da Caixa Econômica Federal.
   * Preserva fielmente créditos, débitos, operações de valor zero, número do documento
   * e saldo corrente após a operação.
   */
  async importCaixaPdfFile(
    filePath: string,
    options: { dryRun?: boolean } = {}
  ): Promise<Result<CaixaPdfSummary>> {
    const isDryRun = options.dryRun !== false; // Padrão seguro é dry-run

    if (!fs.existsSync(filePath)) {
      return Result.fail(`Arquivo PDF da Caixa não encontrado em: ${filePath}`);
    }

    const fileBuffer = fs.readFileSync(filePath);
    const sourceFileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

    let text = '';
    try {
      text = cp.execFileSync('pdftotext', ['-layout', filePath, '-'], {
        encoding: 'utf8',
        maxBuffer: 50 * 1024 * 1024,
      });
    } catch (e: any) {
      return Result.fail(`Falha ao executar pdftotext no PDF da Caixa: ${e.message}`);
    }

    const lines = text.split(/\r?\n/);
    const datePattern = /^\s*(\d{2}\/\d{2}\/\d{4})/;
    const timePattern = /^\s*(\d{2}:\d{2}:\d{2})/;
    const amtPattern = /([0-9\.,]+)\s+([CD])\s+([0-9\.,]+)\s+([CD])/;

    const summary: CaixaPdfSummary = {
      sourceFile: filePath,
      sourceFileHash,
      providerCode: 'CAIXA',
      accountNumber: '2207/1288/000768809478-0',
      accountHolder: 'ANA CAROLINA LEITE ANTUNES AMORIM',
      totalRecords: 0,
      creditsCount: 0,
      debitsCount: 0,
      zeroCount: 0,
      totalCreditBaseUnits: '0',
      totalDebitBaseUnits: '0',
      declaredInitialBalance: 'R$ 0,00 C (em 29/10/2012)',
      observedInitialBalance: '',
      observedFinalBalance: '',
      inserted: 0,
      skippedDuplicates: 0,
      invalid: 0,
      errors: [],
      dryRun: isDryRun,
    };

    let totalCreditBigInt = 0n;
    let totalDebitBigInt = 0n;

    let providerId = 0;
    let brlAssetId = 0;
    if (!isDryRun) {
      const pRes = await this.resolveProviderId('CAIXA');
      if (pRes.isFailure) return Result.fail(pRes.error || 'Provedor CAIXA não encontrado.');
      providerId = pRes.getValue();

      const aRes = await this.resolveBrlAssetId();
      if (aRes.isFailure) return Result.fail(aRes.error || 'Ativo BRL não encontrado.');
      brlAssetId = aRes.getValue();
    }

    let txIndex = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const mDate = line.match(datePattern);
      if (!mDate) continue;

      const block: string[] = [line];
      for (let j = i + 1; j < Math.min(lines.length, i + 6); j++) {
        if (lines[j].match(datePattern)) break;
        block.push(lines[j]);
      }

      const line0 = block[0];
      const dateStr = mDate[1];
      const descStr = line0.slice(mDate[0].length).trim();

      let docStr = '';
      let amountStr = '';
      let direction: 'credit' | 'debit' = 'credit';
      let balanceStr = '';
      let balanceDir = 'C';
      let timeStr = '00:00:00';

      for (let k = 1; k < block.length; k++) {
        const l = block[k];
        const tMatch = l.match(timePattern);
        if (tMatch) timeStr = tMatch[1];

        const aMatch = l.match(amtPattern);
        if (aMatch) {
          amountStr = aMatch[1];
          direction = aMatch[2] === 'C' ? 'credit' : 'debit';
          balanceStr = aMatch[3];
          balanceDir = aMatch[4];

          const beforeAmt = l.slice(0, aMatch.index).trim();
          if (beforeAmt) docStr = beforeAmt;
        }
      }

      if (!amountStr) {
        summary.invalid++;
        summary.errors.push({
          rowNumber: i + 1,
          error: `Bloco de data ${dateStr} sem valor/saldo identificado.`,
          rawRow: block,
        });
        continue;
      }

      txIndex++;
      summary.totalRecords++;

      const dateParts = dateStr.split('/');
      const timeParts = timeStr.split(':');
      const bankTimestamp = new Date(
        Date.UTC(
          parseInt(dateParts[2], 10),
          parseInt(dateParts[1], 10) - 1,
          parseInt(dateParts[0], 10),
          parseInt(timeParts[0], 10),
          parseInt(timeParts[1], 10),
          parseInt(timeParts[2], 10)
        )
      );

      const { amountBaseUnits } = parseToCentavosString(amountStr);
      const { amountBaseUnits: runningBalanceBaseUnits } = parseToCentavosString(balanceStr);

      const centsBigInt = BigInt(amountBaseUnits);
      if (centsBigInt === 0n) {
        summary.zeroCount++;
      }

      if (direction === 'credit') {
        summary.creditsCount++;
        totalCreditBigInt += centsBigInt;
      } else {
        summary.debitsCount++;
        totalDebitBigInt += centsBigInt;
      }

      if (txIndex === 1) {
        summary.observedInitialBalance = `R$ ${balanceStr} ${balanceDir} (após 1ª op: ${direction} R$ ${amountStr})`;
      }
      summary.observedFinalBalance = `R$ ${balanceStr} ${balanceDir} (após op ${txIndex}: ${direction} R$ ${amountStr})`;

      if (isDryRun) {
        continue;
      }

      // Execução real no banco (apenas quando dryRun = false)
      const externalTransactionId = `CAIXA-768809478-0-L${txIndex}`;
      const canonicalPayload = {
        amountBaseUnits,
        bankTimestampMs: bankTimestamp.getTime(),
        direction,
        documentNumber: docStr,
        operationType: 'caixa_statement_movement',
        providerCode: 'CAIXA',
        rawAmount: amountStr,
        rawDescription: descStr,
        rowNumber: txIndex,
        runningBalanceBaseUnits,
        sourceFileName: path.basename(filePath),
      };

      const sortedKeys = Object.keys(canonicalPayload).sort() as Array<keyof typeof canonicalPayload>;
      const canonicalString = sortedKeys.map((k) => `${k}:${canonicalPayload[k]}`).join('|');
      const rowFingerprint = crypto.createHash('sha256').update(canonicalString).digest('hex');

      const existingRes = await this.financeRepo.getFiatExternalTransactionByFingerprint(rowFingerprint);
      if (existingRes.isOk() && existingRes.getValue() !== null) {
        summary.skippedDuplicates++;
        continue;
      }

      const rawPayload = JSON.stringify({
        txIndex,
        accountNumber: summary.accountNumber,
        accountHolder: summary.accountHolder,
        date: dateStr,
        time: timeStr,
        doc: docStr,
        desc: descStr,
        amount: amountStr,
        direction,
        balance: balanceStr,
        balanceDir,
        sourcePeriodStatus: txIndex <= 141 ? 'incompleta_nao_reconciliavel' : 'cadeia_continua',
        rawBlock: block,
      });

      const insertRes = await this.financeRepo.insertFiatExternalTransaction({
        providerId,
        fiatAccountId: null,
        externalTransactionId,
        rawAmount: amountStr,
        amountBaseUnits,
        direction,
        assetId: brlAssetId,
        rawDescription: descStr,
        bankTimestamp,
        documentNumber: docStr,
        runningBalanceBaseUnits,
        sourceFile: filePath,
        sourceFileHash,
        rowFingerprint,
        rawPayload,
        status: 'completed',
        reconciliationStatus: 'unmatched',
        financialTransactionId: null,
      });

      if (insertRes.isOk()) {
        summary.inserted++;
      } else {
        const errMsg = insertRes.error || insertRes.typedError?.message || '';
        if (errMsg.includes('UNIQUE') || errMsg.includes('constraint')) {
          summary.skippedDuplicates++;
        } else {
          summary.invalid++;
          summary.errors.push({
            rowNumber: i + 1,
            error: errMsg,
            rawRow: block,
          });
        }
      }
    }

    summary.totalCreditBaseUnits = totalCreditBigInt.toString();
    summary.totalDebitBaseUnits = totalDebitBigInt.toString();

    return Result.ok(summary);
  }
}
