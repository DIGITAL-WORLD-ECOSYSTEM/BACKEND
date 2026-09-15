# 2. CAMADA DE APLICAÇÃO (Casos de Uso e Orquestração)

Documento integrante do dossiê canônico do Finance Core (`BackEnd/`).

## Sumário dos Arquivos da Camada

- [CanonicalRequestHashService.ts](#srcapplicationfinanceservicescanonicalrequesthashservicets) — `src/application/finance/services/CanonicalRequestHashService.ts` (189 linhas)
- [FinancialTransactionOrchestrator.ts](#srcapplicationfinanceservicesfinancialtransactionorchestratorts) — `src/application/finance/services/FinancialTransactionOrchestrator.ts` (341 linhas)
- [GetTreasuryBalanceUseCase.ts](#srcapplicationfinanceusecasesgettreasurybalanceusecasets) — `src/application/finance/use-cases/GetTreasuryBalanceUseCase.ts` (14 linhas)
- [RecordDepositUseCase.ts](#srcapplicationfinanceusecasesrecorddepositusecasets) — `src/application/finance/use-cases/RecordDepositUseCase.ts` (83 linhas)
- [RecordLedgerTransactionUseCase.ts](#srcapplicationfinanceusecasesrecordledgertransactionusecasets) — `src/application/finance/use-cases/RecordLedgerTransactionUseCase.ts` (37 linhas)
- [RecordTransferUseCase.ts](#srcapplicationfinanceusecasesrecordtransferusecasets) — `src/application/finance/use-cases/RecordTransferUseCase.ts` (98 linhas)
- [RecordTreasuryTransactionUseCase.ts](#srcapplicationfinanceusecasesrecordtreasurytransactionusecasets) — `src/application/finance/use-cases/RecordTreasuryTransactionUseCase.ts` (445 linhas)
- [RepairFinanceUseCase.ts](#srcapplicationfinanceusecasesrepairfinanceusecasets) — `src/application/finance/use-cases/RepairFinanceUseCase.ts` (43 linhas)
- [ReverseTransactionUseCase.ts](#srcapplicationfinanceusecasesreversetransactionusecasets) — `src/application/finance/use-cases/ReverseTransactionUseCase.ts` (110 linhas)
- [IFinanceRepository.ts](#srcapplicationportsoutputifinancerepositoryts) — `src/application/ports/output/IFinanceRepository.ts` (146 linhas)

---

<a id="srcapplicationfinanceservicescanonicalrequesthashservicets"></a>
## Arquivo: `src/application/finance/services/CanonicalRequestHashService.ts`

- **Caminho absoluto**: `/home/sandro/Área de trabalho/BackEnd/src/application/finance/services/CanonicalRequestHashService.ts`
- **Total de linhas**: 189
- **Linguagem**: TypeScript

```typescript
import { createHash } from 'crypto';

export type CanonicalPrimitive = string | number | boolean | null;
export type CanonicalValue =
  | CanonicalPrimitive
  | CanonicalValue[]
  | { [key: string]: CanonicalValue };

export interface CanonicalEntryInput {
  accountId: string | number;
  amount: { amount: bigint | string | number; assetId: number | string } | bigint | string | number;
  assetId?: number | string;
  type: 'debit' | 'credit' | string;
}

export interface CanonicalTransactionInput {
  userId?: number | null;
  transactionType?: string | null;
  category?: string | null;
  description?: string | null;
  refundOfTransactionId?: number | null;
  reversalOfTransactionId?: number | null;
  entries: ReadonlyArray<CanonicalEntryInput>;
}

export class CanonicalRequestHashService {
  /**
   * Converte recursivamente um objeto/payload para formato JSON canônico:
   * 1. Ordena chaves de objetos alfabeticamente com ordenação binária pura.
   * 2. Rejeita `undefined`, arrays esparsos e objetos não-planos (Map, Set, etc).
   * 3. Rejeita tipos não determinísticos (Date, Function, Symbol).
   * 4. Valida inteiros seguros em números (Number.isSafeInteger) ou BigInt.
   * 5. Garante representação determinística sem dependência de locale.
   */
  public static canonicalize(obj: unknown): string {
    if (obj === null) {
      return 'null';
    }

    if (typeof obj === 'boolean') {
      return obj ? 'true' : 'false';
    }

    if (typeof obj === 'number') {
      if (!Number.isFinite(obj)) {
        throw new Error(`Erro de canonicalização: Número não-finito (${obj}) é proibido.`);
      }
      if (!Number.isSafeInteger(obj)) {
        throw new Error(`Erro de canonicalização: Número fora do limite de precisão inteira segura (${obj}). Utilize BigInt ou decimal string.`);
      }
      return JSON.stringify(obj);
    }

    if (typeof obj === 'string') {
      return JSON.stringify(obj);
    }

    if (typeof obj === 'bigint') {
      return JSON.stringify(obj.toString(10));
    }

    if (typeof obj === 'symbol' || typeof obj === 'function') {
      throw new Error(`Erro de canonicalização: Tipo não suportado (${typeof obj}).`);
    }

    if (obj instanceof Date) {
      throw new Error('Erro de canonicalização: Objetos Date não são determinísticos para payloads financeiros.');
    }

    if (Array.isArray(obj)) {
      // Rejeição estrita de arrays esparsos (sparse arrays)
      for (let i = 0; i < obj.length; i++) {
        if (!Object.prototype.hasOwnProperty.call(obj, i)) {
          throw new Error('Erro de canonicalização: Arrays esparsos (sparse arrays com lacunas) são estritamente proibidos.');
        }
      }
      const items = obj.map((item) => CanonicalRequestHashService.canonicalize(item));
      return `[${items.join(',')}]`;
    }

    if (typeof obj === 'object') {
      // Rejeição de objetos customizados / não-planos (Map, Set, etc.)
      const proto = Object.getPrototypeOf(obj);
      if (proto !== null && proto !== Object.prototype) {
        throw new Error(`Erro de canonicalização: Instância de objeto não-plano (${obj.constructor?.name ?? 'custom'}) é proibida.`);
      }

      const record = obj as Record<string, unknown>;
      // Ordenação binária/lexicográfica pura (sem localeCompare)
      const sortedKeys = Object.keys(record).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      const pairs: string[] = [];

      for (const key of sortedKeys) {
        const val = record[key];
        if (val === undefined) {
          throw new Error(`Erro de canonicalização: undefined não é permitido na chave "${key}".`);
        }
        const canonicalVal = CanonicalRequestHashService.canonicalize(val);
        pairs.push(`${JSON.stringify(key)}:${canonicalVal}`);
      }

      return `{${pairs.join(',')}}`;
    }

    throw new Error(`Erro de canonicalização: Tipo primitivo não suportado (${typeof obj}).`);
  }

  /**
   * Extrai e valida a estrutura runtime do DTO/Aggregate de transação canônica.
   */
  private static isCanonicalTransactionInput(payload: unknown): payload is CanonicalTransactionInput {
    if (payload === null || typeof payload !== 'object' || !('entries' in payload)) {
      return false;
    }
    const p = payload as any;
    if (!Array.isArray(p.entries)) {
      return false;
    }
    for (const e of p.entries) {
      if (e === null || typeof e !== 'object') return false;
      if (e.accountId === undefined || e.accountId === null) return false;
      if (e.amount === undefined || e.amount === null) return false;
      if (typeof e.type !== 'string' || (e.type !== 'debit' && e.type !== 'credit')) return false;
    }
    return true;
  }

  /**
   * Gera o hash SHA-256 hexadecimal a partir do payload canônico do negócio.
   * Se receber um aggregate LedgerTransaction ou DTO com entries, filtra exclusivamente
   * os atributos financeiros determinísticos (removendo IDs aleatórios, UUIDs e timestamps)
   * e ordena os lançamentos por ordenação estrutural por tupla (accountId, assetId, type, amount).
   */
  public static calculateHash(payload: unknown): string {
    let targetPayload = payload;

    if (CanonicalRequestHashService.isCanonicalTransactionInput(payload)) {
      const p = payload;
      const rawEntries = p.entries.map((e) => {
        const amountObj = typeof e.amount === 'object' && e.amount !== null ? e.amount : null;
        const amountVal = amountObj ? String(amountObj.amount) : String(e.amount);
        const assetVal = amountObj ? String(amountObj.assetId) : String(e.assetId ?? '0');

        // Validação runtime estrita de valores positivos
        try {
          const parsedBigInt = BigInt(amountVal);
          if (parsedBigInt <= 0n) {
            throw new Error(`Erro de canonicalização: Quantia de lançamento deve ser maior que zero (recebido: ${amountVal}).`);
          }
        } catch (err: any) {
          if (err.message?.includes('Quantia de lançamento')) throw err;
          throw new Error(`Erro de canonicalização: Valor numérico de quantia inválido ("${amountVal}").`);
        }

        return {
          accountId: String(e.accountId),
          amount: amountVal,
          assetId: assetVal,
          type: String(e.type),
        };
      });

      // Ordenação determinística estrita por tupla (accountId -> assetId -> type -> amount)
      rawEntries.sort((a, b) => {
        if (a.accountId !== b.accountId) return a.accountId < b.accountId ? -1 : 1;
        if (a.assetId !== b.assetId) return a.assetId < b.assetId ? -1 : 1;
        if (a.type !== b.type) return a.type < b.type ? -1 : 1;
        if (a.amount !== b.amount) return a.amount < b.amount ? -1 : 1;
        return 0;
      });

      targetPayload = {
        userId: p.userId ?? null,
        transactionType: p.transactionType ?? null,
        category: p.category ?? null,
        description: p.description ?? null,
        refundOfTransactionId: p.refundOfTransactionId ?? null,
        reversalOfTransactionId: p.reversalOfTransactionId ?? null,
        entries: rawEntries,
      };
    }

    const canonicalString = CanonicalRequestHashService.canonicalize(targetPayload);
    return createHash('sha256').update(canonicalString, 'utf8').digest('hex');
  }
}




```

---

<a id="srcapplicationfinanceservicesfinancialtransactionorchestratorts"></a>
## Arquivo: `src/application/finance/services/FinancialTransactionOrchestrator.ts`

- **Caminho absoluto**: `/home/sandro/Área de trabalho/BackEnd/src/application/finance/services/FinancialTransactionOrchestrator.ts`
- **Total de linhas**: 341
- **Linguagem**: TypeScript

```typescript
import { IFinanceRepository } from '../../ports/output/IFinanceRepository';
import { IOutboxRepository } from '../../ports/output/IOutboxRepository';
import { IDomainEvent } from '../../../shared/kernel/DomainEvent';
import { LedgerTransaction } from '../../../domains/finance/entities/LedgerTransaction';
import {
  IdempotencyConflictError,
  IdempotencyInProgressError,
  OptimisticConcurrencyError,
  InsufficientBalanceError,
  InvalidLedgerTransactionError,
  InvalidStateTransitionError,
} from '../../../domains/finance/errors/FinancialError';
import { LedgerImbalanceError } from '../../../domains/finance/errors/LedgerImbalanceError';
import { CanonicalRequestHashService } from './CanonicalRequestHashService';
import { AccountStatusPolicy } from '../../../domains/finance/policies/AccountStatusPolicy';
import { AssetStatusPolicy } from '../../../domains/finance/policies/AssetStatusPolicy';
import { AccountClassPolicy } from '../../../domains/finance/policies/AccountClassPolicy';
import { FinancialTransactionStateMachine } from '../../../domains/finance/services/FinancialTransactionStateMachine';
import { parsePositiveSafeIntegerId } from '../../../domains/finance/value-objects/Money256';

export interface OrchestratorResult {
  transactionId: number;
  isReplayed: boolean;
}

function assertNever(value: never): never {
  throw new Error(`Unhandled BalanceUpdateResult case: ${value}`);
}

export class FinancialTransactionOrchestrator {
  /**
   * O Orchestrator exige um repositório transacional vinculado ao Unit of Work (BEGIN IMMEDIATE).
   * Ele atua como a Autoridade Física Central de escrita no ledger financeiro.
   *
   * Todas as etapas de persistência (Claim Idempotency, Insert Transaction, Insert Entries, OCC Balance Updates,
   * Outbox Event e Complete Idempotency) ocorrem obrigatoriamente dentro do mesmo boundary transacional do banco.
   */
  constructor(
    private readonly financeRepo: IFinanceRepository,
    private readonly outboxRepo?: IOutboxRepository
  ) { }

  /**
   * Valida rigorosamente o invariante FIN-001 de partidas dobradas antes da persistência:
   * Para cada ativo: SUM(débitos) === SUM(créditos)
   */
  private validateDoubleEntry(transaction: LedgerTransaction): void {
    const assetBalances = new Map<number, bigint>();

    for (const entry of transaction.entries) {
      const assetId = entry.amount.assetId;
      const current = assetBalances.get(assetId) ?? 0n;
      const delta = entry.type === 'debit' ? entry.amount.amount : -entry.amount.amount;
      assetBalances.set(assetId, current + delta);
    }

    for (const [assetId, netBalance] of assetBalances.entries()) {
      if (netBalance !== 0n) {
        throw new LedgerImbalanceError(
          `Desbalanceamento contábil no ativo #${assetId}: soma dos débitos difere dos créditos (diferença: ${netBalance.toString()}).`
        );
      }
    }
  }

  /**
   * Pré-validação obrigatória de todas as entidades participantes (contas e ativos).
   * Executada ANTES da reivindicação de idempotência e de qualquer escrita no banco de dados.
   *
   * Garante que:
   * 1. Todos os ativos únicos existem e estão 'active' (AssetStatusPolicy).
   * 2. Todas as contas únicas existem e estão 'active' (AccountStatusPolicy).
   * 3. Todas as contas possuem classificação contábil compatível com seu tipo (AccountClassPolicy).
   *
   * Como é executada sobre o conjunto de IDs únicos da transação, elimina a brecha
   * do delta zero (onde debitSum === creditSum fazia o OCC pular a validação da conta).
   */
  private async preValidateEntities(transaction: LedgerTransaction): Promise<void> {
    const accountIds = new Set<number>();
    const assetIds = new Set<number>();

    for (const entry of transaction.entries) {
      const parsedAccId = parsePositiveSafeIntegerId(entry.accountId, 'entry.accountId');
      accountIds.add(parsedAccId);
      assetIds.add(entry.amount.assetId);
    }

    // 1. Validar todos os ativos participantes
    for (const assetId of assetIds) {
      const assetRes = await this.financeRepo.getAssetById(assetId);
      if (assetRes.isFailure) {
        throw new Error(
          assetRes.error || `Ativo financeiro #${assetId} não encontrado.`
        );
      }
      const asset = assetRes.getValue();
      AssetStatusPolicy.validateActive({
        id: asset.id,
        status: asset.status,
        code: asset.code,
      });
    }

    // 2. Validar todas as contas participantes
    for (const accountId of accountIds) {
      const accountRes = await this.financeRepo.getAccountById(accountId);
      if (accountRes.isFailure) {
        throw new Error(
          accountRes.error || `Conta financeira #${accountId} não encontrada.`
        );
      }
      const account = accountRes.getValue();

      // Validação de status operacional: pode movimentar?
      AccountStatusPolicy.validateActive({
        id: account.id,
        status: account.status,
        name: account.name,
      });

      // Validação de classe contábil: classificação compatível?
      if (account.accountClass) {
        AccountClassPolicy.validate(account.accountType, account.accountClass);
      }
    }
  }

  /**
   * Executa o fluxo atômico de escrita no ledger:
   * 0. Validação estrita do invariante do Ledger (mínimo 2 lançamentos, ao menos 1 débito e 1 crédito, e balanço nulo).
   * 1. PRE-POSTING GATE: Pré-validação de todas as contas e ativos participantes (elimina bypass de delta-zero).
   * 2. Validação da transição de estado da transação: pending -> processing via State Machine.
   * 3. Cálculo do Hash Canônico do payload financeiro.
   * 4. Reclamação atômica de Idempotência.
   * 5. Inserção do registro da transação financeira em 'processing'.
   * 6. Inserção dos lançamentos contábeis imutáveis.
   * 7. Atualização dos saldos materializados via OCC com ordenação determinística por (accountId, assetId).
   * 8. Transição de status para 'completed' via State Machine.
   * 9. Registro de evento no Outbox.
   * 10. Conclusão da Idempotência.
   */
  public async executePosting(
    transaction: LedgerTransaction,
    requestHashOverride?: string
  ): Promise<OrchestratorResult> {
    // Invariante FIN-001: Validação do número mínimo de lançamentos
    if (!transaction.entries || transaction.entries.length < 2) {
      throw new InvalidLedgerTransactionError(
        'Invariante do Ledger violado: Uma transação financeira deve conter no mínimo 2 lançamentos contábeis.'
      );
    }

    const hasDebit = transaction.entries.some((e) => e.type === 'debit');
    const hasCredit = transaction.entries.some((e) => e.type === 'credit');
    if (!hasDebit || !hasCredit) {
      throw new InvalidLedgerTransactionError(
        'Invariante do Ledger violado: Uma transação financeira exige no mínimo 1 lançamento de débito e 1 de crédito.'
      );
    }

    // Invariante: Todas as quantias de lançamentos contábeis devem ser estritamente maiores que zero (> 0)
    for (const entry of transaction.entries) {
      if (entry.amount.amount <= 0n) {
        throw new InvalidLedgerTransactionError(
          `Invariante do Ledger violado: Quantia de lançamento contábil inválida (${entry.amount.amount.toString()}). O valor deve ser estritamente positivo.`
        );
      }
    }

    this.validateDoubleEntry(transaction);

    // 1. PRE-POSTING GATE: Pré-validação obrigatória de entidades (elimina brecha do delta zero)
    await this.preValidateEntities(transaction);

    // 2. State Machine: validação da transição inicial para 'processing'
    const processingTransition = FinancialTransactionStateMachine.transition(
      transaction.status,
      'processing'
    );
    if (processingTransition.isFailure) {
      throw new InvalidStateTransitionError(
        processingTransition.error || 'Transição de estado para processing inválida.'
      );
    }
    const processingStatus = processingTransition.getValue();

    // 3. Hash canônico calculado pelo servidor (ou override fornecido para testes)
    const computedHash = requestHashOverride || CanonicalRequestHashService.calculateHash(transaction);

    // 4. Claim Idempotency Key
    const claimed = await this.financeRepo.claimIdempotency(
      transaction.idempotencyKey,
      transaction.userId,
      'finance',
      computedHash
    );

    if (!claimed) {
      const existing = await this.financeRepo.getIdempotencyRecord(transaction.idempotencyKey, 'finance');
      if (!existing) {
        throw new IdempotencyInProgressError('Conflito de concorrência ao verificar chave de idempotência.');
      }

      if (existing.requestHash === computedHash) {
        if (existing.status === 'completed' && existing.transactionId) {
          return { transactionId: existing.transactionId, isReplayed: true };
        }
        throw new IdempotencyInProgressError();
      } else {
        throw new IdempotencyConflictError();
      }
    }

    // 5. Inserção do registro pai da transação com o status derivado da State Machine
    const txResult = await this.financeRepo.insertTransaction({
      userId: transaction.userId ?? null,
      type: transaction.transactionType ?? 'adjustment',
      category: transaction.category || 'operational',
      description: transaction.description,
      status: processingStatus,
      reversalOfTransactionId: transaction.reversalOfTransactionId,
      refundOfTransactionId: transaction.refundOfTransactionId,
    });
    if (txResult.isFailure) {
      throw new Error(txResult.typedError?.message || txResult.error || 'Falha ao inserir registro de transação financeira.');
    }
    const transactionId = txResult.getValue();

    // 6. Inserção dos lançamentos contábeis imutáveis
    const entriesResult = await this.financeRepo.insertLedgerEntries(transaction.entries, transactionId);
    if (entriesResult.isFailure) {
      throw new Error(entriesResult.typedError?.message || entriesResult.error || 'Falha ao inserir lançamentos contábeis.');
    }

    // 7. Consolidação e agregação de saldos por (accountId, assetId) para evitar falhas de saldo intermediário (intra-transaction) e otimizar I/O.
    interface AccountAssetKey {
      accountId: string;
      assetId: number;
      debitSum: bigint;
      creditSum: bigint;
    }

    const aggregatedMap = new Map<string, AccountAssetKey>();

    for (const entry of transaction.entries) {
      const key = `${entry.accountId}:${entry.amount.assetId}`;
      const existing = aggregatedMap.get(key) || {
        accountId: entry.accountId,
        assetId: entry.amount.assetId,
        debitSum: 0n,
        creditSum: 0n,
      };

      if (entry.type === 'debit') {
        existing.debitSum += entry.amount.amount;
      } else {
        existing.creditSum += entry.amount.amount;
      }
      aggregatedMap.set(key, existing);
    }

    // Ordenação determinística de execução por (accountId, assetId) para prevenção de lock contention / deadlock em operações concorrentes.
    const sortedDeltas = Array.from(aggregatedMap.values()).sort((a, b) => {
      if (a.accountId !== b.accountId) {
        return a.accountId < b.accountId ? -1 : 1;
      }
      return a.assetId < b.assetId ? -1 : a.assetId > b.assetId ? 1 : 0;
    });

    // 8. Execução do OCC de saldos apenas para deltas líquidos não-nulos (contas já pré-validadas na etapa 1)
    for (const delta of sortedDeltas) {
      if (delta.debitSum === delta.creditSum) {
        continue; // Débitos e créditos idênticos na mesma conta cancelam-se com variação nula de saldo
      }

      const isNetDebit = delta.debitSum > delta.creditSum;
      const netAmount = isNetDebit
        ? delta.debitSum - delta.creditSum
        : delta.creditSum - delta.debitSum;
      const netType: 'debit' | 'credit' = isNetDebit ? 'debit' : 'credit';

      const updateResult = await this.financeRepo.updateBalanceWithOCC(
        delta.accountId,
        delta.assetId,
        netAmount,
        netType
      );

      switch (updateResult) {
        case 'UPDATED':
          break;
        case 'INSUFFICIENT_BALANCE':
          throw new InsufficientBalanceError(
            `saldo insuficiente para a conta #${delta.accountId} e ativo #${delta.assetId}.`
          );
        case 'OCC_CONFLICT':
          throw new OptimisticConcurrencyError(
            `Falha de concorrência otimista (OCC version mismatch) para a conta #${delta.accountId}.`
          );
        default:
          assertNever(updateResult);
      }
    }

    // 9. State Machine: validação da transição para 'completed'
    const completedTransition = FinancialTransactionStateMachine.transition(
      processingStatus,
      'completed'
    );
    if (completedTransition.isFailure) {
      throw new InvalidStateTransitionError(
        completedTransition.error || 'Transição de estado para completed inválida.'
      );
    }
    const completedStatus = completedTransition.getValue();

    // 10. Atualização do status da transação para 'completed'
    await this.financeRepo.updateTransactionStatus(transactionId, completedStatus);

    // 11. Persistência de Evento no Outbox
    if (this.outboxRepo) {
      await this.outboxRepo.saveEvent(
        {
          dateTimeOccurred: new Date(),
          getAggregateId: () => String(transactionId),
          transactionId,
          idempotencyKey: transaction.idempotencyKey,
          requestHash: computedHash,
        } as IDomainEvent,
        transactionId,
        'LedgerTransaction',
        1
      );
    }

    // 12. Conclusão do registro de Idempotência
    await this.financeRepo.completeIdempotency(transaction.idempotencyKey, 'finance', transactionId);

    return { transactionId, isReplayed: false };
  }
}

```

---

<a id="srcapplicationfinanceusecasesgettreasurybalanceusecasets"></a>
## Arquivo: `src/application/finance/use-cases/GetTreasuryBalanceUseCase.ts`

- **Caminho absoluto**: `/home/sandro/Área de trabalho/BackEnd/src/application/finance/use-cases/GetTreasuryBalanceUseCase.ts`
- **Total de linhas**: 14
- **Linguagem**: TypeScript

```typescript
import { IUnitOfWork } from '../../ports/output/IUnitOfWork';
import { Result } from '../../../shared/kernel/Result';
import { AccountBalanceRecord } from '../../ports/output/IFinanceRepository';

export class GetTreasuryBalanceUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(): Promise<Result<AccountBalanceRecord[]>> {
    return await this.uow.execute(async (factory) => {
      const financeRepo = factory.getFinanceRepository();
      return await financeRepo.getTreasuryBalance();
    });
  }
}

```

---

<a id="srcapplicationfinanceusecasesrecorddepositusecasets"></a>
## Arquivo: `src/application/finance/use-cases/RecordDepositUseCase.ts`

- **Caminho absoluto**: `/home/sandro/Área de trabalho/BackEnd/src/application/finance/use-cases/RecordDepositUseCase.ts`
- **Total de linhas**: 83
- **Linguagem**: TypeScript

```typescript
import { IUnitOfWork } from '../../ports/output/IUnitOfWork';
import { Result } from '../../../shared/kernel/Result';
import { LedgerTransaction, LedgerEntry } from '../../../domains/finance/entities/LedgerTransaction';
import { Money256 } from '../../../domains/finance/value-objects/Money256';
import { AccountingEntryPolicy } from '../../../domains/finance/policies/AccountingEntryPolicy';
import { FinancialTransactionOrchestrator, OrchestratorResult } from '../services/FinancialTransactionOrchestrator';
import { CanonicalRequestHashService } from '../services/CanonicalRequestHashService';
import { AccountInactiveError } from '../../../domains/finance/errors/FinancialError';

export interface DepositCommand {
  userId: number;
  amountBaseUnits: string;
  assetId: number;
  description: string;
  idempotencyKey: string;
  requestHash?: string;
}

export class RecordDepositUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(command: DepositCommand): Promise<Result<OrchestratorResult>> {
    try {
      const amount = Money256.fromString(command.amountBaseUnits, command.assetId);

      return await this.uow.execute(async (factory) => {
        const repo = factory.getFinanceRepository();

        const treasuryRes = await repo.getTreasuryAccount();
        if (treasuryRes.isFailure) throw new Error(treasuryRes.error || 'Conta de tesouraria não encontrada');
        const treasuryAccountId = treasuryRes.getValue().id;

        const userAccRes = await repo.getOrCreateUserAccount(command.userId);
        if (userAccRes.isFailure) throw new Error(userAccRes.error || 'Conta do usuário não encontrada');
        const userAcc = userAccRes.getValue();
        if (userAcc.status !== 'active') {
          throw new AccountInactiveError('Conta do Usuário está inativa ou suspensa.');
        }
        const userAccountId = userAcc.id;

        const rawEntries = AccountingEntryPolicy.createDepositEntries({
          treasuryAccountId,
          userAccountId,
          amount,
          description: command.description,
        });

        const ledgerEntries = rawEntries.map(
          (r) =>
            new LedgerEntry({
              accountId: String(r.accountId),
              amount: r.amount,
              type: r.entryType,
              description: r.description,
            })
        );

        const transaction = LedgerTransaction.create({
          idempotencyKey: command.idempotencyKey,
          description: command.description,
          entries: ledgerEntries,
          transactionType: 'deposit',
          category: 'deposit',
          userId: command.userId,
        });

        if (command.requestHash !== undefined) {
          const canonicalHash = CanonicalRequestHashService.calculateHash(transaction);
          if (command.requestHash !== canonicalHash) {
            throw new Error('409 Conflict: O requestHash fornecido não coincide com o hash canônico do payload de depósito.');
          }
        }

        const orchestrator = new FinancialTransactionOrchestrator(repo, factory.getOutboxRepository());
        const orchestratorResult = await orchestrator.executePosting(transaction);
        return Result.ok(orchestratorResult);
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Falha ao realizar depósito.';
      return Result.fail(message);
    }
  }
}

```

---

<a id="srcapplicationfinanceusecasesrecordledgertransactionusecasets"></a>
## Arquivo: `src/application/finance/use-cases/RecordLedgerTransactionUseCase.ts`

- **Caminho absoluto**: `/home/sandro/Área de trabalho/BackEnd/src/application/finance/use-cases/RecordLedgerTransactionUseCase.ts`
- **Total de linhas**: 37
- **Linguagem**: TypeScript

```typescript
import { IUnitOfWork } from '../../ports/output/IUnitOfWork';
import { LedgerTransaction } from '../../../domains/finance/entities/LedgerTransaction';
import { Result } from '../../../shared/kernel/Result';
import { FinancialTransactionOrchestrator, OrchestratorResult } from '../services/FinancialTransactionOrchestrator';
import { CanonicalRequestHashService } from '../services/CanonicalRequestHashService';

export class RecordLedgerTransactionUseCase {
  constructor(private readonly unitOfWork: IUnitOfWork) {}

  /**
   * Application entry point for generic ledger posting.
   * Valida a integridade do hash do cliente (se fornecido) e delega a execução
   * transacional para a Autoridade Física Central (FinancialTransactionOrchestrator).
   */
  async execute(
    transaction: LedgerTransaction,
    providedRequestHash?: string
  ): Promise<Result<OrchestratorResult>> {
    try {
      const canonicalHash = CanonicalRequestHashService.calculateHash(transaction);
      // Se um hash do cliente for fornecido, deve coincidir com o hash canônico calculado para evitar payload falsificado
      if (providedRequestHash && providedRequestHash !== canonicalHash) {
        return Result.fail('409 Conflict: O requestHash fornecido não coincide com o hash canônico do payload (FIN-008).');
      }

      return await this.unitOfWork.execute(async (factory) => {
        const repo = factory.getFinanceRepository();
        const orchestrator = new FinancialTransactionOrchestrator(repo, factory.getOutboxRepository());
        const orchestratorResult = await orchestrator.executePosting(transaction);
        return Result.ok(orchestratorResult);
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Falha ao processar lançamento no ledger financeiro.';
      return Result.fail(message);
    }
  }
}

```

---

<a id="srcapplicationfinanceusecasesrecordtransferusecasets"></a>
## Arquivo: `src/application/finance/use-cases/RecordTransferUseCase.ts`

- **Caminho absoluto**: `/home/sandro/Área de trabalho/BackEnd/src/application/finance/use-cases/RecordTransferUseCase.ts`
- **Total de linhas**: 98
- **Linguagem**: TypeScript

```typescript
import { IUnitOfWork } from '../../ports/output/IUnitOfWork';
import { Result } from '../../../shared/kernel/Result';
import { LedgerTransaction, LedgerEntry } from '../../../domains/finance/entities/LedgerTransaction';
import { Money256 } from '../../../domains/finance/value-objects/Money256';
import { AccountingEntryPolicy } from '../../../domains/finance/policies/AccountingEntryPolicy';
import { FinancialTransactionOrchestrator, OrchestratorResult } from '../services/FinancialTransactionOrchestrator';
import { CanonicalRequestHashService } from '../services/CanonicalRequestHashService';

export interface TransferCommand {
  sourceUserId: number;
  destinationUserId: number;
  amountBaseUnits: string;
  assetId: number;
  description: string;
  idempotencyKey: string;
  requestHash?: string;
}

export class RecordTransferUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(command: TransferCommand): Promise<Result<OrchestratorResult>> {
    try {
      if (command.sourceUserId === command.destinationUserId) {
        return Result.fail('Transferência exige usuários de origem e destino distintos.');
      }

      const amount = Money256.fromString(command.amountBaseUnits, command.assetId);

      return await this.uow.execute(async (factory) => {
        const repo = factory.getFinanceRepository();

        const sourceAccRes = await repo.getOrCreateUserAccount(command.sourceUserId);
        if (sourceAccRes.isFailure) throw new Error(sourceAccRes.error || 'Conta de origem não encontrada');

        const destAccRes = await repo.getOrCreateUserAccount(command.destinationUserId);
        if (destAccRes.isFailure) throw new Error(destAccRes.error || 'Conta de destino não encontrada');

        const sourceAcc = sourceAccRes.getValue();
        if (sourceAcc.status !== 'active') {
          throw new Error('Conta de origem está inativa ou suspensa.');
        }

        const destAcc = destAccRes.getValue();
        if (destAcc.status !== 'active') {
          throw new Error('Conta de destino está inativa ou suspensa.');
        }

        const sourceAccountId = sourceAcc.id;
        const destinationAccountId = destAcc.id;

        if (sourceAccountId === destinationAccountId) {
          throw new Error('Auto-transferência para a mesma conta é proibida.');
        }

        const rawEntries = AccountingEntryPolicy.createTransferEntries({
          sourceAccountId,
          destinationAccountId,
          amount,
          description: command.description,
        });

        const ledgerEntries: LedgerEntry[] = rawEntries.map(
          (r) =>
            new LedgerEntry({
              accountId: String(r.accountId),
              amount: r.amount,
              type: r.entryType,
              description: r.description,
            })
        );

        const transaction = LedgerTransaction.create({
          idempotencyKey: command.idempotencyKey,
          description: command.description,
          entries: ledgerEntries,
          transactionType: 'transfer',
          category: 'operational',
          userId: command.sourceUserId,
        });

        if (command.requestHash !== undefined) {
          const canonicalHash = CanonicalRequestHashService.calculateHash(transaction);
          if (command.requestHash !== canonicalHash) {
            throw new Error('409 Conflict: O requestHash fornecido não coincide com o hash canônico do payload de transferência.');
          }
        }

        const orchestrator = new FinancialTransactionOrchestrator(repo, factory.getOutboxRepository());
        const orchestratorResult = await orchestrator.executePosting(transaction);
        return Result.ok(orchestratorResult);
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Falha ao realizar transferência.';
      return Result.fail(message);
    }
  }
}

```

---

<a id="srcapplicationfinanceusecasesrecordtreasurytransactionusecasets"></a>
## Arquivo: `src/application/finance/use-cases/RecordTreasuryTransactionUseCase.ts`

- **Caminho absoluto**: `/home/sandro/Área de trabalho/BackEnd/src/application/finance/use-cases/RecordTreasuryTransactionUseCase.ts`
- **Total de linhas**: 445
- **Linguagem**: TypeScript

```typescript
import { IUnitOfWork } from '../../ports/output/IUnitOfWork';
import { Result } from '../../../shared/kernel/Result';
import { LedgerTransaction, LedgerEntry } from '../../../domains/finance/entities/LedgerTransaction';
import { Money256, parsePositiveSafeIntegerId } from '../../../domains/finance/value-objects/Money256';
import { AccountingEntryPolicy, RawLedgerEntrySpec } from '../../../domains/finance/policies/AccountingEntryPolicy';
import { FinancialTransactionOrchestrator, OrchestratorResult } from '../services/FinancialTransactionOrchestrator';
import { CanonicalRequestHashService } from '../services/CanonicalRequestHashService';
import {
  FinancialError,
  InvalidRefundAmountError,
  UnsupportedFinancialOperationError,
  InvalidFinancialOperationError,
  AccountOwnershipError,
  AssetInactiveError,
  AccountInactiveError,
  IdempotencyConflictError,
} from '../../../domains/finance/errors/FinancialError';
import { FinancialTransactionCategory } from '../../ports/output/IFinanceRepository';

export interface RecordTreasuryTransactionDTO {
  userId?: number | null; // targetUserId
  actorUserId?: number | null;
  authorizedByUserId?: number | null;
  type: 'deposit' | 'withdrawal' | 'transfer' | 'payment' | 'refund' | 'fee' | 'reward' | 'yield' | 'conversion' | 'adjustment';
  direction?: 'INBOUND' | 'OUTBOUND';
  category?: FinancialTransactionCategory;
  description: string;
  amountBaseUnits: string;
  assetId: number;
  idempotencyKey: string;
  requestHash?: string;
  refundOfTransactionId?: number;
}

export interface RecordTreasuryTransactionResult {
  transactionId?: number;
  isReplayed: boolean;
}

const USER_REQUIRED_OPERATIONS = ['payment', 'fee', 'reward', 'yield'] as const;
const INBOUND_ONLY_OPS = ['deposit', 'yield', 'reward', 'refund'] as const;
const OUTBOUND_ONLY_OPS = ['withdrawal', 'payment', 'fee'] as const;

export class RecordTreasuryTransactionUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(dto: RecordTreasuryTransactionDTO): Promise<Result<RecordTreasuryTransactionResult>> {
    // 1. Structural DTO Field Validation
    if (!dto.description || !dto.amountBaseUnits || !dto.idempotencyKey || dto.assetId === undefined || !dto.type) {
      return Result.fail<RecordTreasuryTransactionResult>(
        new InvalidFinancialOperationError('Descrição, valor, assetId, type e idempotencyKey são obrigatórios.')
      );
    }

    const description = dto.description.trim();
    if (description.length < 3 || description.length > 500) {
      return Result.fail<RecordTreasuryTransactionResult>(
        new InvalidFinancialOperationError('A descrição deve conter entre 3 e 500 caracteres.')
      );
    }

    const idempotencyKey = dto.idempotencyKey.trim();
    if (idempotencyKey.length === 0 || idempotencyKey.length > 255) {
      return Result.fail<RecordTreasuryTransactionResult>(
        new InvalidFinancialOperationError('A chave de idempotência deve ter entre 1 e 255 caracteres.')
      );
    }

    if (dto.requestHash !== undefined) {
      if (!/^[a-f0-9]{64}$/i.test(dto.requestHash)) {
        return Result.fail<RecordTreasuryTransactionResult>(
          new InvalidFinancialOperationError('Formato de requestHash inválido. Deve ser uma string SHA-256 hexadecimal de 64 caracteres.')
        );
      }
    }

    try {
      // 2. Value Object & Asset ID Parsing
      const parsedAssetId = parsePositiveSafeIntegerId(dto.assetId, 'assetId');
      const amountMoney = Money256.fromString(dto.amountBaseUnits, parsedAssetId);

      if (amountMoney.isZero()) {
        return Result.fail<RecordTreasuryTransactionResult>(
          new InvalidFinancialOperationError('O valor da transação deve ser estritamente maior que zero.')
        );
      }

      // 3. User Ownership & Required User ID Check
      let parsedUserId: number | null = null;
      if (dto.userId !== null && dto.userId !== undefined) {
        parsedUserId = parsePositiveSafeIntegerId(dto.userId, 'userId');
      }

      if ((USER_REQUIRED_OPERATIONS as readonly string[]).includes(dto.type) && parsedUserId === null) {
        return Result.fail<RecordTreasuryTransactionResult>(
          new AccountOwnershipError(`Operação do tipo '${dto.type}' exige obrigatoriamente um userId de usuário final.`)
        );
      }

      // 4. Direction Rules & Determinism per Operation
      let resolvedDirection = dto.direction;
      if ((INBOUND_ONLY_OPS as readonly string[]).includes(dto.type)) {
        if (resolvedDirection && resolvedDirection !== 'INBOUND') {
          return Result.fail<RecordTreasuryTransactionResult>(
            new InvalidFinancialOperationError(`Transação do tipo '${dto.type}' não pode ter direção OUTBOUND. Direção determinística: INBOUND.`)
          );
        }
        resolvedDirection = 'INBOUND';
      } else if ((OUTBOUND_ONLY_OPS as readonly string[]).includes(dto.type)) {
        if (resolvedDirection && resolvedDirection !== 'OUTBOUND') {
          return Result.fail<RecordTreasuryTransactionResult>(
            new InvalidFinancialOperationError(`Transação do tipo '${dto.type}' não pode ter direção INBOUND. Direção determinística: OUTBOUND.`)
          );
        }
        resolvedDirection = 'OUTBOUND';
      } else if (!resolvedDirection) {
        return Result.fail<RecordTreasuryTransactionResult>(
          new InvalidFinancialOperationError(`Operação do tipo '${dto.type}' exige declaração explícita de direção (INBOUND ou OUTBOUND).`)
        );
      }

      // 5. Category Strict Typing & Domain Validation
      const VALID_CATEGORIES: FinancialTransactionCategory[] = [
        'membership', 'rwa_yield', 'grant', 'operational', 'payment', 'trading', 'withdrawal', 'deposit', 'fee', 'other'
      ];
      let category: FinancialTransactionCategory = 'operational';
      if (dto.category !== undefined && dto.category !== null) {
        const trimmed = String(dto.category).toLowerCase().trim() as FinancialTransactionCategory;
        if (!VALID_CATEGORIES.includes(trimmed)) {
          return Result.fail<RecordTreasuryTransactionResult>(
            new InvalidFinancialOperationError(`Categoria '${dto.category}' não é uma categoria financeira válida do domínio.`)
          );
        }
        category = trimmed;
      }

      // 6. Compute Canonical Request Hash over Request DTO payload
      const canonicalPayload = {
        amountBaseUnits: dto.amountBaseUnits,
        assetId: parsedAssetId,
        category,
        description,
        direction: resolvedDirection,
        refundOfTransactionId: dto.refundOfTransactionId ?? null,
        type: dto.type,
        userId: parsedUserId,
      };
      const canonicalHash = CanonicalRequestHashService.calculateHash(canonicalPayload);

      if (dto.requestHash !== undefined && dto.requestHash !== canonicalHash) {
        return Result.fail<RecordTreasuryTransactionResult>(
          new IdempotencyConflictError('409 Conflict: O requestHash fornecido não coincide com o hash canônico do payload.')
        );
      }

      // 7. Atomic Unit of Work Execution
      return await this.uow.execute(async (factory) => {
        const financeRepo = factory.getFinanceRepository();

        // 7a. Validate Asset Existence & Active Status
        const assetRes = await financeRepo.getAssetById(parsedAssetId);
        if (assetRes.isFailure) return Result.fail<RecordTreasuryTransactionResult>(assetRes.errorObject || assetRes.error || `Ativo financeiro #${parsedAssetId} não encontrado.`);
        const asset = assetRes.getValue();
        if (asset.status !== 'active') {
          return Result.fail<RecordTreasuryTransactionResult>(
            new AssetInactiveError(`Ativo financeiro #${parsedAssetId} (${asset.code}) está inativo ou suspenso.`)
          );
        }

        // 7b. Resolve Treasury Account
        const treasuryRes = await financeRepo.getTreasuryAccount();
        if (treasuryRes.isFailure) return Result.fail<RecordTreasuryTransactionResult>(treasuryRes.errorObject || treasuryRes.error || 'Erro ao resolver conta de Tesouraria');
        const treasuryAcc = treasuryRes.getValue();
        if (treasuryAcc.status !== 'active') {
          return Result.fail<RecordTreasuryTransactionResult>(new AccountInactiveError('Conta de Tesouraria está inativa ou suspensa.'));
        }
        const treasuryAccountId = treasuryAcc.id;

        // 7c. Resolve User Account (deferred for refund to allow pre-check of ownership)
        let userAccountId: number = 0;
        if (dto.type !== 'refund') {
          if (parsedUserId !== null) {
            const userAccRes = await financeRepo.getOrCreateUserAccount(parsedUserId);
            if (userAccRes.isFailure) return Result.fail<RecordTreasuryTransactionResult>(userAccRes.errorObject || userAccRes.error || 'Erro ao resolver conta do Usuário');
            const userAcc = userAccRes.getValue();
            if (userAcc.status !== 'active') {
              return Result.fail<RecordTreasuryTransactionResult>(new AccountInactiveError('Conta do Usuário está inativa ou suspensa.'));
            }
            userAccountId = userAcc.id;
          } else {
            // If no userId, use Operating Account
            const sysOpRes = await financeRepo.getSystemAccount('operating');
            if (sysOpRes.isFailure) return Result.fail<RecordTreasuryTransactionResult>(sysOpRes.errorObject || sysOpRes.error || 'Erro ao resolver conta operacional do sistema');
            if (sysOpRes.getValue().status !== 'active') {
              return Result.fail<RecordTreasuryTransactionResult>(new AccountInactiveError('Conta operacional do sistema está inativa.'));
            }
            userAccountId = sysOpRes.getValue().id;
          }
        }

        let rawEntries: RawLedgerEntrySpec[];

        // 8. Exhaustive Switch Dispatch per Operation Type
        switch (dto.type) {
          case 'deposit': {
            rawEntries = AccountingEntryPolicy.createDepositEntries({
              treasuryAccountId,
              userAccountId,
              amount: amountMoney,
              description,
            });
            break;
          }
          case 'withdrawal': {
            rawEntries = AccountingEntryPolicy.createWithdrawalEntries({
              treasuryAccountId,
              userAccountId,
              amount: amountMoney,
              description,
            });
            break;
          }
          case 'payment': {
            const sysRevenueRes = await financeRepo.getSystemAccount('payment_revenue');
            if (sysRevenueRes.isFailure) return Result.fail<RecordTreasuryTransactionResult>(sysRevenueRes.errorObject || sysRevenueRes.error || 'Erro ao obter conta sistêmica');
            if (sysRevenueRes.getValue().status !== 'active') {
              return Result.fail<RecordTreasuryTransactionResult>(new AccountInactiveError('Conta sistêmica payment_revenue está inativa.'));
            }
            rawEntries = AccountingEntryPolicy.createPaymentEntries({
              userAccountId,
              paymentRevenueAccountId: sysRevenueRes.getValue().id,
              amount: amountMoney,
              description,
            });
            break;
          }
          case 'refund': {
            if (!dto.refundOfTransactionId) {
              return Result.fail<RecordTreasuryTransactionResult>(
                new InvalidFinancialOperationError('Reembolso (refund) exige o ID da transação original (refundOfTransactionId).')
              );
            }
            const origTxId = parsePositiveSafeIntegerId(dto.refundOfTransactionId, 'refundOfTransactionId');

            // Fetch original transaction within same UoW boundary
            const origTxRes = await financeRepo.getTransactionById(origTxId);
            if (origTxRes.isFailure) return Result.fail<RecordTreasuryTransactionResult>(origTxRes.errorObject || origTxRes.error || 'Erro ao buscar transação original');
            const origTx = origTxRes.getValue();

            if (origTx.status !== 'completed') {
              return Result.fail<RecordTreasuryTransactionResult>(
                new InvalidFinancialOperationError(`Reembolso rejeitado: Transação original #${origTxId} não está em estado 'completed' (status atual: '${origTx.status}').`)
              );
            }
            if (origTx.type !== 'payment') {
              return Result.fail<RecordTreasuryTransactionResult>(
                new InvalidFinancialOperationError(`Reembolso rejeitado: Apenas transações do tipo 'payment' podem ser reembolsadas.`)
              );
            }

            // P0.2: Strict Refund Ownership Verification
            if (origTx.userId === null) {
              return Result.fail<RecordTreasuryTransactionResult>(
                new AccountOwnershipError(`Reembolso rejeitado: A transação original #${origTxId} não possui usuário proprietário.`)
              );
            }
            if (parsedUserId !== null && parsedUserId !== origTx.userId) {
              return Result.fail<RecordTreasuryTransactionResult>(
                new AccountOwnershipError(`Reembolso rejeitado: O usuário solicitado (#${parsedUserId}) não coincide com o usuário proprietário da transação original (#${origTx.userId}).`)
              );
            }

            // Strictly derive user account from original payment owner
            parsedUserId = origTx.userId;
            const userAccRes = await financeRepo.getOrCreateUserAccount(parsedUserId);
            if (userAccRes.isFailure) return Result.fail<RecordTreasuryTransactionResult>(userAccRes.errorObject || userAccRes.error || 'Erro ao resolver conta de usuário');
            const userAcc = userAccRes.getValue();
            if (userAcc.status !== 'active') {
              return Result.fail<RecordTreasuryTransactionResult>(new AccountInactiveError('Conta do Usuário está inativa ou suspensa.'));
            }
            userAccountId = userAcc.id;

            // P0.3 & P0.6: Fetch original payment ledger entries & extract payment revenue amount (Clean Domain contract)
            const origEntriesRes = await financeRepo.getTransactionEntries(origTxId);
            if (origEntriesRes.isFailure) return Result.fail<RecordTreasuryTransactionResult>(origEntriesRes.errorObject || origEntriesRes.error || 'Erro ao buscar lançamentos originais');

            const sysPaymentRevRes = await financeRepo.getSystemAccount('payment_revenue');
            if (sysPaymentRevRes.isFailure) return Result.fail<RecordTreasuryTransactionResult>(sysPaymentRevRes.errorObject || sysPaymentRevRes.error || 'Erro ao resolver conta de receita de pagamento');
            const paymentRevenueAccountId = sysPaymentRevRes.getValue().id;

            const origEntries = origEntriesRes.getValue();
            const originalPaymentMoney = AccountingEntryPolicy.extractRefundablePaymentAmount(origEntries, parsedAssetId, paymentRevenueAccountId);
            const originalPaymentAmount = originalPaymentMoney.toBigInt();

            // Refund cumulative limit check. Concurrency safety is guaranteed by the UoW transaction boundary (BEGIN IMMEDIATE write lock).
            const prevRefundsTotal = await financeRepo.getRefundsTotalForTransaction(origTxId, parsedAssetId);
            const requestedRefundAmount = amountMoney.toBigInt();
            if (prevRefundsTotal + requestedRefundAmount > originalPaymentAmount) {
              const remaining = originalPaymentAmount > prevRefundsTotal ? originalPaymentAmount - prevRefundsTotal : 0n;
              return Result.fail<RecordTreasuryTransactionResult>(
                new InvalidRefundAmountError(
                  `Valor do reembolso (${requestedRefundAmount.toString()}) excede o saldo reembolsável restante (${remaining.toString()}) da transação original #${origTxId}.`
                )
              );
            }

            const sysRefundExpRes = await financeRepo.getSystemAccount('refund_expense');
            if (sysRefundExpRes.isFailure) return Result.fail<RecordTreasuryTransactionResult>(sysRefundExpRes.errorObject || sysRefundExpRes.error || 'Erro ao resolver conta de reembolso');
            if (sysRefundExpRes.getValue().status !== 'active') {
              return Result.fail<RecordTreasuryTransactionResult>(new AccountInactiveError('Conta sistêmica refund_expense está inativa.'));
            }
            rawEntries = AccountingEntryPolicy.createRefundEntries({
              refundExpenseAccountId: sysRefundExpRes.getValue().id,
              userAccountId,
              amount: amountMoney,
              description,
            });
            break;
          }
          case 'fee': {
            const sysFeeRes = await financeRepo.getSystemAccount('fees');
            if (sysFeeRes.isFailure) return Result.fail<RecordTreasuryTransactionResult>(sysFeeRes.errorObject || sysFeeRes.error || 'Erro ao resolver conta de taxas');
            if (sysFeeRes.getValue().status !== 'active') {
              return Result.fail<RecordTreasuryTransactionResult>(new AccountInactiveError('Conta sistêmica fees está inativa.'));
            }
            rawEntries = AccountingEntryPolicy.createFeeEntries({
              userAccountId,
              feeAccountId: sysFeeRes.getValue().id,
              amount: amountMoney,
              description,
            });
            break;
          }
          case 'reward': {
            const sysRewardExpRes = await financeRepo.getSystemAccount('reward_expense');
            if (sysRewardExpRes.isFailure) return Result.fail<RecordTreasuryTransactionResult>(sysRewardExpRes.errorObject || sysRewardExpRes.error || 'Erro ao resolver conta de recompensa');
            if (sysRewardExpRes.getValue().status !== 'active') {
              return Result.fail<RecordTreasuryTransactionResult>(new AccountInactiveError('Conta sistêmica reward_expense está inativa.'));
            }
            rawEntries = AccountingEntryPolicy.createRewardEntries({
              rewardExpenseAccountId: sysRewardExpRes.getValue().id,
              userAccountId,
              amount: amountMoney,
              description,
            });
            break;
          }
          case 'yield': {
            const sysYieldExpRes = await financeRepo.getSystemAccount('yield_expense');
            if (sysYieldExpRes.isFailure) return Result.fail<RecordTreasuryTransactionResult>(sysYieldExpRes.errorObject || sysYieldExpRes.error || 'Erro ao resolver conta de rendimentos');
            if (sysYieldExpRes.getValue().status !== 'active') {
              return Result.fail<RecordTreasuryTransactionResult>(new AccountInactiveError('Conta sistêmica yield_expense está inativa.'));
            }
            rawEntries = AccountingEntryPolicy.createYieldEntries({
              yieldExpenseAccountId: sysYieldExpRes.getValue().id,
              userAccountId,
              amount: amountMoney,
              description,
            });
            break;
          }
          case 'adjustment': {
            let parsedAuthUserId: number | null = null;
            if (dto.authorizedByUserId !== null && dto.authorizedByUserId !== undefined) {
              parsedAuthUserId = parsePositiveSafeIntegerId(dto.authorizedByUserId, 'authorizedByUserId');
            }

            if (parsedAuthUserId === null) {
              return Result.fail<RecordTreasuryTransactionResult>(
                new AccountOwnershipError("Operação de ajuste (adjustment) exige obrigatoriamente a identificação do usuário autorizador (authorizedByUserId).")
              );
            }

            if (parsedUserId !== null && parsedUserId === parsedAuthUserId) {
              return Result.fail<RecordTreasuryTransactionResult>(
                new InvalidFinancialOperationError("Invariante FIN-007 violado: Para ajustes administrativos, o usuário titular (targetUserId) deve ser distinto do autorizador (authorizedByUserId).")
              );
            }

            rawEntries = AccountingEntryPolicy.createAdjustmentEntries({
              debitAccountId: resolvedDirection === 'INBOUND' ? treasuryAccountId : userAccountId,
              creditAccountId: resolvedDirection === 'INBOUND' ? userAccountId : treasuryAccountId,
              amount: amountMoney,
              reason: description,
              authorizedByUserId: parsedAuthUserId,
            });
            break;
          }
          case 'transfer': {
            rawEntries = AccountingEntryPolicy.createTransferEntries({
              sourceAccountId: resolvedDirection === 'OUTBOUND' ? userAccountId : treasuryAccountId,
              destinationAccountId: resolvedDirection === 'OUTBOUND' ? treasuryAccountId : userAccountId,
              amount: amountMoney,
              description,
            });
            break;
          }
          case 'conversion': {
            return Result.fail<RecordTreasuryTransactionResult>(
              new UnsupportedFinancialOperationError('Operação de conversão (conversion) exige Use Case especializado de troca de ativos (Forex).')
            );
          }
          default: {
            const unhandled: never = dto.type as never;
            return Result.fail<RecordTreasuryTransactionResult>(
              new UnsupportedFinancialOperationError(`Tipo de transação '${unhandled}' não é suportado por este Use Case.`)
            );
          }
        }

        // 9. Build Domain Aggregates
        const ledgerEntries = rawEntries.map(
          (spec) =>
            new LedgerEntry({
              accountId: String(spec.accountId),
              amount: spec.amount,
              type: spec.entryType,
              description: spec.description,
            })
        );

        const transaction = LedgerTransaction.create({
          idempotencyKey,
          description,
          entries: ledgerEntries,
          userId: parsedUserId,
          transactionType: dto.type,
          category,
          refundOfTransactionId: dto.refundOfTransactionId ? Number(dto.refundOfTransactionId) : undefined,
        });

        // 10. Execute Posting via Orchestrator
        const orchestrator = new FinancialTransactionOrchestrator(financeRepo, factory.getOutboxRepository());
        const orchestratorResult = await orchestrator.executePosting(transaction);
        return Result.ok<RecordTreasuryTransactionResult>(orchestratorResult);
      });
    } catch (err: unknown) {
      if (err instanceof FinancialError) {
        return Result.fail<RecordTreasuryTransactionResult>(err);
      }
      const message = err instanceof Error ? err.message : 'Falha ao registrar transação.';
      return Result.fail<RecordTreasuryTransactionResult>(message);
    }
  }
}

```

---

<a id="srcapplicationfinanceusecasesrepairfinanceusecasets"></a>
## Arquivo: `src/application/finance/use-cases/RepairFinanceUseCase.ts`

- **Caminho absoluto**: `/home/sandro/Área de trabalho/BackEnd/src/application/finance/use-cases/RepairFinanceUseCase.ts`
- **Total de linhas**: 43
- **Linguagem**: TypeScript

```typescript
import { IUnitOfWork } from '../../ports/output/IUnitOfWork';
import { Result } from '../../../shared/kernel/Result';
import { RecordTreasuryTransactionUseCase, RecordTreasuryTransactionResult } from './RecordTreasuryTransactionUseCase';

export interface RepairFinanceCommand {
  actorUserId: number;
  targetUserId: number;
  authorizedByUserId: number;
  direction: 'INBOUND' | 'OUTBOUND';
  amountBaseUnits: string;
  assetId: number;
  reason: string;
  idempotencyKey: string;
}

export class RepairFinanceUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(command: RepairFinanceCommand): Promise<Result<RecordTreasuryTransactionResult>> {
    if (!command.actorUserId || !command.authorizedByUserId) {
      return Result.fail('Identificação de actorUserId e authorizedByUserId é obrigatória para reparo.');
    }

    if (command.targetUserId === command.authorizedByUserId) {
      return Result.fail('Invariante FIN-007 violado: Para ajustes administrativos, targetUserId deve ser distinto de authorizedByUserId.');
    }

    const recordTxUseCase = new RecordTreasuryTransactionUseCase(this.uow);

    return recordTxUseCase.execute({
      userId: command.targetUserId,
      actorUserId: command.actorUserId,
      authorizedByUserId: command.authorizedByUserId,
      type: 'adjustment',
      direction: command.direction,
      category: 'operational',
      description: `[REPAIR/CLI] ${command.reason}`,
      amountBaseUnits: command.amountBaseUnits,
      assetId: command.assetId,
      idempotencyKey: command.idempotencyKey,
    });
  }
}

```

---

<a id="srcapplicationfinanceusecasesreversetransactionusecasets"></a>
## Arquivo: `src/application/finance/use-cases/ReverseTransactionUseCase.ts`

- **Caminho absoluto**: `/home/sandro/Área de trabalho/BackEnd/src/application/finance/use-cases/ReverseTransactionUseCase.ts`
- **Total de linhas**: 110
- **Linguagem**: TypeScript

```typescript
import { IUnitOfWork } from '../../ports/output/IUnitOfWork';
import { Result } from '../../../shared/kernel/Result';
import { LedgerTransaction, LedgerEntry } from '../../../domains/finance/entities/LedgerTransaction';
import { Money256 } from '../../../domains/finance/value-objects/Money256';
import { AccountingEntryPolicy } from '../../../domains/finance/policies/AccountingEntryPolicy';
import { FinancialTransactionOrchestrator, OrchestratorResult } from '../services/FinancialTransactionOrchestrator';
import { CanonicalRequestHashService } from '../services/CanonicalRequestHashService';
import { InvalidStateTransitionError } from '../../../domains/finance/errors/FinancialError';

export interface ReverseTransactionInput {
  originalTransactionId: number;
  actorUserId: number;
  idempotencyKey: string;
  reason: string;
  requestHash?: string;
}

export class ReverseTransactionUseCase {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(input: ReverseTransactionInput): Promise<Result<OrchestratorResult>> {
    try {
      if (!input.actorUserId) {
        throw new Error('Identificação de actorUserId é obrigatória para efetuar o estorno.');
      }

      return await this.uow.execute(async (factory) => {
        const repo = factory.getFinanceRepository();

        // 1. Obter lançamentos da transação original
        const originalEntriesRes = await repo.getTransactionEntries(input.originalTransactionId);
        if (originalEntriesRes.isFailure) {
          throw new Error(`Transação original #${input.originalTransactionId} não encontrada: ${originalEntriesRes.error}`);
        }

        const rawEntries = originalEntriesRes.getValue();
        if (!rawEntries || rawEntries.length === 0) {
          throw new Error(`Transação original #${input.originalTransactionId} não possui lançamentos contábeis.`);
        }

        // 2. Obter registro original por ID direto O(1) para validar estado e tipo
        const txRes = await repo.getTransactionById(input.originalTransactionId);
        if (txRes.isFailure) {
          throw new Error(`Registro de transação #${input.originalTransactionId} não encontrado: ${txRes.error}`);
        }
        const originalTx = txRes.getValue();

        if (originalTx.status !== 'completed') {
          throw new InvalidStateTransitionError(
            `Apenas transações no status "completed" podem ser estornadas. Status atual: "${originalTx.status}".`
          );
        }

        // FIN-017: Proibir estorno de estorno (reversal of reversal)
        if (originalTx.type === 'reversal') {
          throw new InvalidStateTransitionError('Estorno de transação do tipo "reversal" é estritamente proibido (FIN-017).');
        }

        // 3. Gerar lançamentos inversos via AccountingEntryPolicy
        const domainEntries = rawEntries.map((e) => ({
          accountId: e.accountId,
          assetId: e.assetId,
          entryType: e.direction,
          amount: Money256.fromString(e.amountBaseUnits, e.assetId),
          description: `Original Entry #${e.accountId}`,
        }));

        const reversedRaw = AccountingEntryPolicy.createReversalEntries(domainEntries, input.reason);

        const reverseLedgerEntries: LedgerEntry[] = reversedRaw.map(
          (r) =>
            new LedgerEntry({
              accountId: String(r.accountId),
              amount: r.amount,
              type: r.entryType,
              description: r.description,
            })
        );

        const reversalTx = LedgerTransaction.create({
          idempotencyKey: input.idempotencyKey,
          description: `Estorno da Transação #${input.originalTransactionId}: ${input.reason}`,
          entries: reverseLedgerEntries,
          transactionType: 'reversal',
          category: 'operational',
          userId: originalTx.userId,
          reversalOfTransactionId: input.originalTransactionId,
        });

        if (input.requestHash !== undefined) {
          const canonicalHash = CanonicalRequestHashService.calculateHash(reversalTx);
          if (input.requestHash !== canonicalHash) {
            throw new Error('409 Conflict: O requestHash fornecido não coincide com o hash canônico do estorno.');
          }
        }

        const orchestrator = new FinancialTransactionOrchestrator(repo, factory.getOutboxRepository());
        const orchestratorResult = await orchestrator.executePosting(reversalTx);

        // Atualizar transação original para 'reversed' dentro da mesma UoW
        await repo.updateTransactionStatus(input.originalTransactionId, 'reversed', originalTx.version);

        return Result.ok(orchestratorResult);
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Falha ao estornar transação financeira.';
      return Result.fail(message);
    }
  }
}

```

---

<a id="srcapplicationportsoutputifinancerepositoryts"></a>
## Arquivo: `src/application/ports/output/IFinanceRepository.ts`

- **Caminho absoluto**: `/home/sandro/Área de trabalho/BackEnd/src/application/ports/output/IFinanceRepository.ts`
- **Total de linhas**: 146
- **Linguagem**: TypeScript

```typescript
import { Result } from '../../../shared/kernel/Result';
import { RepositoryError } from '../../../shared/kernel/RepositoryError';
import { LedgerEntry } from '../../../domains/finance/entities/LedgerTransaction';
import { FinancialLedgerEntryRecord } from '../../../domains/finance/contracts/FinancialLedgerEntryRecord';
import type { FinancialAccountClass } from '../../../domains/finance/policies/AccountClassPolicy';

export type SystemAccountType =
  | 'treasury'
  | 'operating'
  | 'reserve'
  | 'fees'
  | 'escrow'
  | 'reward_expense'
  | 'yield_expense'
  | 'clearing'
  | 'opening_balance_equity'
  | 'payment_revenue'
  | 'refund_expense';

export type FinancialTransactionType =
  | 'deposit'
  | 'withdrawal'
  | 'transfer'
  | 'payment'
  | 'refund'
  | 'fee'
  | 'reward'
  | 'yield'
  | 'conversion'
  | 'adjustment'
  | 'reversal'
  | 'inbound'
  | 'outbound';

export type FinancialTransactionStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'reversed'
  | 'refunded';

export type FinancialTransactionCategory =
  | 'membership'
  | 'rwa_yield'
  | 'grant'
  | 'operational'
  | 'payment'
  | 'trading'
  | 'withdrawal'
  | 'deposit'
  | 'fee'
  | 'other';

export type FinancialAccountStatus = 'active' | 'inactive' | 'suspended';
export type FinancialAssetStatus = 'active' | 'inactive' | 'suspended';

export type BalanceUpdateResult = 'UPDATED' | 'INSUFFICIENT_BALANCE' | 'OCC_CONFLICT';

export type IdempotencyRecord =
  | { status: 'processing'; transactionId: null; requestHash: string }
  | { status: 'completed'; transactionId: number; requestHash: string }
  | { status: 'failed'; transactionId: null; requestHash: string };

export type IdempotencyClaimResult =
  | { status: 'CLAIMED' }
  | { status: 'COMPLETED'; transactionId: number; requestHash: string }
  | { status: 'PROCESSING'; requestHash: string }
  | { status: 'CONFLICT'; requestHash: string };

export interface LedgerTransactionCommittedEvent {
  transactionId: number;
  idempotencyKey: string;
  requestHash: string;
  [key: string]: unknown;
}

export interface FinancialAccountRecord {
  id: number;
  userId: number | null;
  accountType: SystemAccountType | 'user_available';
  accountClass: FinancialAccountClass;
  status: FinancialAccountStatus;
  name: string;
  version: number;
}

export interface AccountBalanceRecord {
  id: number;
  accountId: number;
  assetId: number;
  availableBaseUnits: string;
  lockedBaseUnits: string;
  version: number;
}

export interface FinancialTransactionRecord {
  id: number;
  userId: number | null;
  type: FinancialTransactionType;
  category: FinancialTransactionCategory;
  status: FinancialTransactionStatus;
  description: string;
  version: number;
  createdAt: Date;
  completedAt?: Date | null;
}

export interface IFinanceRepository {
  getAccountById(accountId: number): Promise<Result<FinancialAccountRecord>>;
  getTreasuryAccount(): Promise<Result<FinancialAccountRecord>>;
  getOrCreateUserAccount(userId: number): Promise<Result<FinancialAccountRecord>>;
  getOrCreateOperatingAccount(): Promise<Result<FinancialAccountRecord>>;
  getSystemAccount(accountType: SystemAccountType): Promise<Result<FinancialAccountRecord>>;
  getTreasuryBalance(): Promise<Result<AccountBalanceRecord[]>>;
  getAssetById(assetId: number): Promise<Result<{ id: number; code: string; status: FinancialAssetStatus }>>;

  getTransactionById(transactionId: number): Promise<Result<FinancialTransactionRecord>>;
  getRefundsTotalForTransaction(originalTransactionId: number, assetId: number): Promise<bigint>;

  listTransactions(userId?: number): Promise<Result<FinancialTransactionRecord[]>>;
  getTransactionEntries(transactionId: number): Promise<Result<FinancialLedgerEntryRecord[]>>;

  getIdempotencyRecord(key: string, scope: string): Promise<IdempotencyRecord | null>;
  claimIdempotency(idempotencyKey: string, userId: number | null | undefined, scope: string, requestHash: string): Promise<boolean | IdempotencyClaimResult>;
  completeIdempotency(key: string, scope: string, transactionId: number): Promise<void>;
  insertTransaction(data: {
    userId?: number | null;
    type: FinancialTransactionType;
    category: FinancialTransactionCategory;
    description: string;
    status: FinancialTransactionStatus;
    reversalOfTransactionId?: number;
    refundOfTransactionId?: number;
  }): Promise<Result<number, RepositoryError>>;
  insertLedgerEntries(entries: ReadonlyArray<LedgerEntry>, transactionId: number): Promise<Result<void, RepositoryError>>;
  updateBalanceWithOCC(
    accountId: number | string,
    assetId: number | string,
    amount: bigint,
    type: 'debit' | 'credit'
  ): Promise<BalanceUpdateResult>;
  updateTransactionStatus(transactionId: number, status: FinancialTransactionStatus, expectedVersion?: number): Promise<void>;
  // NOTE: persistOutboxEvent removed — use IOutboxRepository.saveEvent() within the same UoW transaction.
}

```

---

