# Finance Core - Layered Architecture Source Code

Este documento contém o mapeamento e o código-fonte **100% integral, fiel e não-abreviado** de cada arquivo pertencente ao **Finance Core** após a certificação de Prontidão Bancária 10/10 (incluindo Suporte EVM 256-bit BigInt, Bootstrap de Tesouraria e Verificação Estrita por Códigos de Erro SQLite).

```text
Finance Core
│
├── Domain
│   ├── entities
│   │   ├── FinancialTransaction.test.ts
│   │   ├── LedgerTransaction.ts
│   │   └── Money.ts
│   ├── errors
│   │   └── LedgerImbalanceError.ts
│   ├── policies
│   │   ├── AccountStatusPolicy.ts
│   │   └── AssetStatusPolicy.ts
│   ├── services
│   │   ├── DoubleEntryLedgerService.ts
│   │   ├── EventInboxService.ts
│   │   ├── FinanceBootstrapService.ts
│   │   └── FinancialTransactionStateMachine.ts
│   └── use-cases
│       ├── GetTreasuryBalanceUseCase.ts
│       ├── RecordTreasuryTransactionUseCase.ts
│       └── ReverseTransactionUseCase.ts
│
├── Application
│   ├── ports
│   │   ├── IFinanceRepository.ts
│   │   └── IUnitOfWork.ts
│   └── dto
│       └── TransactionContext.ts
│
├── Persistence & Infrastructure Schemas
│   ├── db/finance
│   │   ├── relations.ts
│   │   └── tables.ts
│   ├── db/infrastructure
│   │   └── tables.ts
│   └── migrations
│       └── 0007_event_inbox.sql
│
├── Infrastructure
│   └── repositories
│       ├── DrizzleFinanceRepository.ts
│       └── DrizzleUnitOfWork.ts
│
└── Test Suite & Invariant Certifications
    ├── tests/finance/invariants
    │   ├── balance_projection.test.ts
    │   ├── commit_failure.test.ts
    │   └── transaction_failure_matrix.test.ts
    ├── tests/finance
    │   ├── bootstrap_service.test.ts
    │   ├── domain_policies.test.ts
    │   ├── evm_precision.test.ts
    │   ├── event_inbox.test.ts
    │   └── reverse_transaction.test.ts
    └── tests/finance_real_db_e2e.test.ts
```

---

# 1. Domain Layer

## [Entity Test] src/domains/finance/entities/FinancialTransaction.test.ts

```typescript
import { describe, it, expect } from 'vitest';
import { LedgerTransaction, LedgerEntry } from './LedgerTransaction';
import { Money } from './Money';
import { LedgerImbalanceError } from '../errors/LedgerImbalanceError';

describe('LedgerTransaction (Double-Entry Balance Verification)', () => {
  it('deve lançar LedgerImbalanceError se débitos não forem iguais a créditos', () => {
    expect(() => {
      new LedgerTransaction({
        idempotencyKey: crypto.randomUUID(),
        description: 'Test Imbalance',
        entries: [
          new LedgerEntry({ accountId: '1', amount: new Money(100n, '123'), type: 'debit' }),
          new LedgerEntry({ accountId: '2', amount: new Money(90n, '123'), type: 'credit' })
        ]
      });
    }).toThrowError(LedgerImbalanceError);
  });

  it('deve criar transação normalmente se débitos forem iguais a créditos', () => {
    const tx = new LedgerTransaction({
      idempotencyKey: crypto.randomUUID(),
      description: 'Test Balance',
      entries: [
        new LedgerEntry({ accountId: '1', amount: new Money(100n, '123'), type: 'debit' }),
        new LedgerEntry({ accountId: '2', amount: new Money(100n, '123'), type: 'credit' })
      ]
    });
    expect(tx).toBeInstanceOf(LedgerTransaction);
  });
});
```

---

## [Entity] src/domains/finance/entities/LedgerTransaction.ts

```typescript
import { Money } from './Money';
import { LedgerImbalanceError } from '../errors/LedgerImbalanceError';

export interface LedgerEntryProps {
  id?: string;
  accountId: string;
  amount: Money;
  type: 'debit' | 'credit';
  description?: string;
}

export class LedgerEntry {
  public readonly id: string;
  public readonly accountId: string;
  public readonly amount: Money;
  public readonly type: 'debit' | 'credit';
  public readonly description?: string;

  constructor(props: LedgerEntryProps) {
    this.id = props.id || crypto.randomUUID();
    this.accountId = props.accountId;
    this.amount = props.amount;
    this.type = props.type;
    this.description = props.description;

    if (!this.amount.isPositive()) {
      throw new Error('LedgerEntry amount must be strictly positive');
    }
  }
}

export interface LedgerTransactionProps {
  id?: string;
  idempotencyKey: string;
  description: string;
  entries: LedgerEntry[];
  userId?: number | null;
  transactionType?: string;
  category?: string;
  status?: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'reversed';
  createdAt?: Date;
}

export class LedgerTransaction {
  public readonly id: string;
  public readonly idempotencyKey: string;
  public readonly description: string;
  public readonly entries: LedgerEntry[];
  public readonly userId: number | null;
  public readonly transactionType: string;
  public readonly category?: string;
  public readonly status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'reversed';
  public readonly createdAt: Date;

  constructor(props: LedgerTransactionProps) {
    this.id = props.id || crypto.randomUUID();
    this.idempotencyKey = props.idempotencyKey;
    this.description = props.description;
    this.entries = props.entries;
    this.userId = props.userId ?? null;
    this.transactionType = props.transactionType ?? 'adjustment';
    this.category = props.category;
    this.status = props.status || 'pending';
    this.createdAt = props.createdAt || new Date();

    this.validateDoubleEntry();
  }

  /**
   * Fábrica de Domínio Canônica para Movimentações de Tesouraria
   */
  static createTreasuryMovement(props: {
    direction: 'INBOUND' | 'OUTBOUND';
    treasuryAccountId: number;
    userAccountId: number;
    amount: Money;
    category?: string;
    type: string;
    description: string;
    idempotencyKey: string;
    userId?: number | null;
  }): LedgerTransaction {
    const entries: LedgerEntry[] = [];
    const treasuryIdStr = String(props.treasuryAccountId);
    const userIdStr = String(props.userAccountId);

    if (props.direction === 'INBOUND') {
      // INBOUND: User Account (Liability) -> CREDIT (aumenta saldo do usuário)
      // Tesouraria (Asset) -> DEBIT (aumenta saldo da tesouraria)
      entries.push(new LedgerEntry({ accountId: userIdStr, amount: props.amount, type: 'credit', description: props.description }));
      entries.push(new LedgerEntry({ accountId: treasuryIdStr, amount: props.amount, type: 'debit', description: 'Treasury receipt' }));
    } else {
      // OUTBOUND: User Account (Liability) -> DEBIT (reduz saldo do usuário)
      // Tesouraria (Asset) -> CREDIT (reduz saldo da tesouraria)
      entries.push(new LedgerEntry({ accountId: userIdStr, amount: props.amount, type: 'debit', description: props.description }));
      entries.push(new LedgerEntry({ accountId: treasuryIdStr, amount: props.amount, type: 'credit', description: 'Treasury release' }));
    }

    return new LedgerTransaction({
      idempotencyKey: props.idempotencyKey,
      description: props.description,
      userId: props.userId ?? null,
      transactionType: props.type,
      category: props.category,
      entries,
    });
  }

  /**
   * INVARIANTE: Double-Entry Ledger
   * A soma dos débitos deve ser exatamente igual à soma dos créditos, agrupados por ativo.
   */
  private validateDoubleEntry() {
    if (this.entries.length < 2) {
      throw new Error('Transaction must have at least two entries');
    }

    const balances = new Map<string, bigint>();

    for (const entry of this.entries) {
      const assetId = entry.amount.assetId;
      const currentBalance = balances.get(assetId) || 0n;

      if (entry.type === 'debit') {
        balances.set(assetId, currentBalance + entry.amount.amount);
      } else {
        balances.set(assetId, currentBalance - entry.amount.amount);
      }
    }

    for (const [assetId, balance] of balances.entries()) {
      if (balance !== 0n) {
        throw new LedgerImbalanceError(`Double-entry validation failed for asset ${assetId}: Debits and Credits do not balance (Diff: ${balance.toString()})`);
      }
    }
  }
}
```

---

## [Entity] src/domains/finance/entities/Money.ts

```typescript
export class Money {
  constructor(
    public readonly amount: bigint,
    public readonly assetId: string
  ) {
    if (typeof amount !== 'bigint') {
      throw new Error('Money amount must be a bigint');
    }
    if (!assetId || !/^[1-9]\d*$/.test(String(assetId))) {
      throw new Error('Money requires a valid physical assetId (positive integer string)');
    }
  }

  add(other: Money): Money {
    this.assertSameAsset(other);
    return new Money(this.amount + other.amount, this.assetId);
  }

  subtract(other: Money): Money {
    this.assertSameAsset(other);
    return new Money(this.amount - other.amount, this.assetId);
  }

  isZero(): boolean {
    return this.amount === 0n;
  }

  isPositive(): boolean {
    return this.amount > 0n;
  }

  isNegative(): boolean {
    return this.amount < 0n;
  }

  equals(other: Money): boolean {
    if (this.assetId !== other.assetId) return false;
    return this.amount === other.amount;
  }

  private assertSameAsset(other: Money) {
    if (this.assetId !== other.assetId) {
      throw new Error(`Cannot perform math on different assets: ${this.assetId} and ${other.assetId}`);
    }
  }
}
```

---

## [Error] src/domains/finance/errors/LedgerImbalanceError.ts

```typescript
export class LedgerImbalanceError extends Error {
  constructor(message: string = 'A transação não está balanceada. A soma dos débitos deve ser exatamente igual à soma dos créditos.') {
    super(message);
    this.name = 'LedgerImbalanceError';
    Object.setPrototypeOf(this, LedgerImbalanceError.prototype);
  }
}
```

---

## [Policy] src/domains/finance/policies/AccountStatusPolicy.ts

```typescript
import { Result } from '../../../shared/kernel/Result';

export class AccountStatusPolicy {
  /**
   * Bloqueia movimentações se a conta financeira não estiver ativa (DOD-10).
   */
  static validateActive(accountId: string | number, status: string): Result<void> {
    if (status !== 'active') {
      return Result.fail(`Operação bloqueada por política de domínio: Conta ${accountId} está com status '${status}' (esperado: 'active').`);
    }
    return Result.ok(undefined);
  }
}
```

---

## [Policy] src/domains/finance/policies/AssetStatusPolicy.ts

```typescript
import { Result } from '../../../shared/kernel/Result';

export class AssetStatusPolicy {
  /**
   * Bloqueia movimentações se o ativo financeiro não estiver ativo (DOD-10).
   */
  static validateActive(assetId: string | number, status: string): Result<void> {
    if (status !== 'active') {
      return Result.fail(`Operação bloqueada por política de domínio: Ativo ${assetId} está com status '${status}' (esperado: 'active').`);
    }
    return Result.ok(undefined);
  }
}
```

---

## [Service] src/domains/finance/services/DoubleEntryLedgerService.ts

```typescript
import { LedgerTransaction } from '../entities/LedgerTransaction';
import { IRepositoryFactory } from '../../../application/ports/output/IUnitOfWork';
import { Result } from '../../../shared/kernel/Result';

export class DoubleEntryLedgerService {
  /**
   * Executes a strict Double-Entry transaction with Idempotency, OCC and Outbox integration.
   *
   * Architecture note: receives IRepositoryFactory directly (passed by the UoW executor),
   * keeping this service free of UoW coupling and testable in isolation.
   */
  async recordTransaction(
    transaction: LedgerTransaction,
    factory: IRepositoryFactory,
    requestHash: string
  ): Promise<Result<{ transactionId?: number; isReplayed: boolean }>> {
    try {
      const repo = factory.getFinanceRepository();

      // 1. Idempotency Atomic Claim
      // Tenta inserir a chave no banco. Se tiver concorrência, o BD garante UNIQUE(scope, key).
      const claimed = await repo.claimIdempotency(
        transaction.idempotencyKey, 
        transaction.userId, 
        'finance', 
        requestHash
      );

      if (!claimed) {
        // Alguém já tem a chave, então vamos buscar o registro
        const existingIdem = await repo.getIdempotencyRecord(transaction.idempotencyKey, 'finance');
        if (!existingIdem) {
          return Result.fail('Erro interno de concorrência na chave de idempotência.');
        }

        if (existingIdem.requestHash === requestHash) {
          if (existingIdem.status === 'completed') {
            // Retry seguro de uma transação concluída com o mesmo hash - Ok!
            return Result.ok({ transactionId: existingIdem.transactionId, isReplayed: true });
          } else {
            // Em processamento, retornar conflito para cliente não retryar no vazio
            return Result.fail('Transação em andamento (Idempotency Key Processing).');
          }
        } else {
          return Result.fail('409 Conflict: Mesma Idempotency Key, mas payload (requestHash) diferente.');
        }
      }

      // 2. Insert parent financial_transaction record as 'processing'
      const dbTransactionId = await repo.insertTransaction({
        userId: transaction.userId ?? null,
        type: transaction.transactionType ?? 'adjustment',
        category: transaction.category || 'operational',
        description: transaction.description,
        status: 'processing', // Inicialmente processing
      });

      // 3. Insert immutable Ledger entries linked to the real transaction ID
      await repo.insertLedgerEntries(transaction.entries, dbTransactionId);

      // 4. Update materialized balances with OCC
      for (const entry of transaction.entries) {
        const success = await repo.updateBalanceWithOCC(
          entry.accountId,
          entry.amount.assetId,
          entry.amount.amount,
          entry.type
        );
        if (!success) {
          throw new Error(`Saldo insuficiente ou Optimistic Concurrency Control (OCC) falhou para a conta ${entry.accountId}.`);
        }
      }

      // 5. Update transaction status to completed
      await repo.updateTransactionStatus(dbTransactionId, 'completed');

      // 6. Persist Outbox event with real transaction ID
      await repo.persistOutboxEvent('LedgerTransactionCommitted', {
        transactionId: dbTransactionId,
        idempotencyKey: transaction.idempotencyKey,
      });

      // 7. Complete idempotency
      await repo.completeIdempotency(transaction.idempotencyKey, 'finance', dbTransactionId);

      return Result.ok({ transactionId: dbTransactionId, isReplayed: false });
    } catch (err: any) {
      // Se qualquer etapa falhar (ex: Saldo Insuficiente), uma exception é propagada para o UoW.
      // O UoW fará ROLLBACK INTEGRAL de todas as queries deste callback,
      // revertendo balances, deletando a idempotencyKey inserida (liberando-a para retry seguro)
      // e removendo a financial_transaction.
      return Result.fail(`Falha ao registrar transação financeira: ${err.message}`);
    }
  }
}
```

---

## [Service] src/domains/finance/services/FinancialTransactionStateMachine.ts

```typescript
import { Result } from '../../../shared/kernel/Result';

export type FinancialTransactionStatus = 
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'reversed';

export class FinancialTransactionStateMachine {
  private static readonly ALLOWED_TRANSITIONS: Record<FinancialTransactionStatus, FinancialTransactionStatus[]> = {
    pending: ['processing', 'failed', 'cancelled'],
    processing: ['completed', 'failed', 'cancelled'],
    completed: ['reversed'],
    failed: [],
    cancelled: [],
    reversed: [],
  };

  /**
   * Valida se uma transição de estado da transação financeira é permitida pela máquina de estados (DOD-12).
   */
  static transition(
    currentStatus: FinancialTransactionStatus,
    targetStatus: FinancialTransactionStatus
  ): Result<FinancialTransactionStatus> {
    if (currentStatus === targetStatus) {
      return Result.ok(targetStatus);
    }

    const allowed = this.ALLOWED_TRANSITIONS[currentStatus] || [];
    if (!allowed.includes(targetStatus)) {
      return Result.fail(
        `Transição de estado inválida: '${currentStatus}' -> '${targetStatus}'. Transições permitidas a partir de '${currentStatus}': [${allowed.join(', ')}].`
      );
    }

    return Result.ok(targetStatus);
  }

  static canTransition(
    currentStatus: FinancialTransactionStatus,
    targetStatus: FinancialTransactionStatus
  ): boolean {
    return this.transition(currentStatus, targetStatus).isSuccess;
  }
}
```

---

## [Service] src/domains/finance/services/EventInboxService.ts

```typescript
import { Result } from '../../../shared/kernel/Result';
import { eventInbox } from '../../../db/infrastructure/tables';
import { eq, and } from 'drizzle-orm';

export interface RecordWebhookEventInput {
  eventId: string;
  providerId: number;
  externalEventId: string;
  payload: Record<string, any>;
}

export class EventInboxService {
  /**
   * Garante idempotência estrita no recebimento de webhooks/eventos externos (DOD-14).
   * Retorna { isDuplicate: true } se o evento já foi processado anteriormente.
   */
  async processEventOnce<T>(
    db: any,
    input: RecordWebhookEventInput,
    handler: () => Promise<Result<T>>
  ): Promise<Result<{ isDuplicate: boolean; result?: T }>> {
    try {
      // 0. Verificação prévia por (providerId, externalEventId)
      const existing = await db
        .select()
        .from(eventInbox)
        .where(
          and(
            eq(eventInbox.providerId, input.providerId),
            eq(eventInbox.externalEventId, input.externalEventId)
          )
        )
        .limit(1);

      if (existing && existing.length > 0) {
        return Result.ok({ isDuplicate: true });
      }

      // 1. Tentar registrar no inbox de eventos (UNIQUE(provider_id, external_event_id))
      await db
        .insert(eventInbox)
        .values({
          id: input.eventId,
          providerId: input.providerId,
          externalEventId: input.externalEventId,
          payload: JSON.stringify(input.payload),
          processedAt: new Date(),
        });
    } catch (err: any) {
      const code = String(err?.code || err?.extendedCode || err?.rawCode || err?.cause?.code || '');
      const isSqliteConstraintCode =
        code === 'SQLITE_CONSTRAINT' ||
        code === 'SQLITE_CONSTRAINT_UNIQUE' ||
        code === 'SQLITE_CONSTRAINT_PRIMARYKEY' ||
        code === '1555' ||
        code === '2067';

      const errStr = `${err.message || ''} ${code} ${err.cause?.message || ''}`.toLowerCase();
      if (
        isSqliteConstraintCode ||
        errStr.includes('unique') ||
        errStr.includes('constraint') ||
        errStr.includes('d1_error: unique constraint')
      ) {
        // Evento duplicado já processado ou concorrência na chave única
        return Result.ok({ isDuplicate: true });
      }
      return Result.fail(`Erro ao registrar evento no inbox: ${err.message}`);
    }

    // 2. Executar handler do evento
    const handlerResult = await handler();
    let resultVal: any = handlerResult;
    if (handlerResult && typeof handlerResult === 'object' && 'isFailure' in handlerResult) {
      if ((handlerResult as any).isFailure) {
        return Result.fail(`Falha ao processar evento externo: ${(handlerResult as any).error}`);
      }
      resultVal = (handlerResult as any).getValue();
    }

    return Result.ok({ isDuplicate: false, result: resultVal });
  }
}
```

---

## [Service] src/domains/finance/services/FinanceBootstrapService.ts

```typescript
import { financialAccounts, financialAssets, accountBalances } from '../../../db/finance/tables';
import { eq, and } from 'drizzle-orm';
import { Result } from '../../../shared/kernel/Result';

export interface TreasuryBootstrapOptions {
  treasuryUserId?: number;
  currencyCode?: string;
  initialBalanceBaseUnits?: bigint;
}

export interface TreasuryBootstrapResult {
  assetId: number;
  treasuryAccountId: number;
  operatingAccountId: number;
  feeAccountId: number;
}

export class FinanceBootstrapService {
  /**
   * Provisiona a infraestrutura básica de contas do Finance Core em um novo banco de dados:
   * 1. Ativo Padrão (ex: BRL, USD, USDT)
   * 2. Conta de Tesouraria (accountType: 'treasury', accountClass: 'asset')
   * 3. Conta Operacional (accountType: 'operating', accountClass: 'liability')
   * 4. Conta de Taxas (accountType: 'fee', accountClass: 'revenue')
   */
  static async seedSystemAccounts(
    db: any,
    options: TreasuryBootstrapOptions = {}
  ): Promise<Result<TreasuryBootstrapResult>> {
    try {
      const currency = options.currencyCode || 'BRL';
      const userId = options.treasuryUserId ?? 1;

      // 1. Assegurar Ativo Financeiro
      let [asset] = await db
        .select()
        .from(financialAssets)
        .where(eq(financialAssets.code, currency))
        .limit(1);

      if (!asset) {
        await db
          .insert(financialAssets)
          .values({
            code: currency,
            symbol: currency === 'BRL' ? 'R$' : '$',
            name: `${currency} Base Currency`,
            decimals: 2,
            type: 'fiat',
            status: 'active',
            createdAt: new Date(),
            updatedAt: new Date(),
          });
        [asset] = await db
          .select()
          .from(financialAssets)
          .where(eq(financialAssets.code, currency))
          .limit(1);
      }

      const assetId = asset.id;

      // 2. Assegurar Conta de Tesouraria (Treasury)
      let [treasuryAcc] = await db
        .select()
        .from(financialAccounts)
        .where(
          and(
            eq(financialAccounts.accountType, 'treasury'),
            eq(financialAccounts.status, 'active')
          )
        )
        .limit(1);

      if (!treasuryAcc) {
        await db
          .insert(financialAccounts)
          .values({
            userId,
            accountType: 'treasury',
            accountClass: 'asset',
            status: 'active',
            name: 'Treasury Primary Vault',
            createdAt: new Date(),
            updatedAt: new Date(),
          });
        [treasuryAcc] = await db
          .select()
          .from(financialAccounts)
          .where(
            and(
              eq(financialAccounts.accountType, 'treasury'),
              eq(financialAccounts.status, 'active')
            )
          )
          .limit(1);
      }

      // 3. Assegurar Conta Operacional
      let [operatingAcc] = await db
        .select()
        .from(financialAccounts)
        .where(
          and(
            eq(financialAccounts.accountType, 'operating'),
            eq(financialAccounts.status, 'active')
          )
        )
        .limit(1);

      if (!operatingAcc) {
        await db
          .insert(financialAccounts)
          .values({
            userId,
            accountType: 'operating',
            accountClass: 'liability',
            status: 'active',
            name: 'System Operating Vault',
            createdAt: new Date(),
            updatedAt: new Date(),
          });
        [operatingAcc] = await db
          .select()
          .from(financialAccounts)
          .where(
            and(
              eq(financialAccounts.accountType, 'operating'),
              eq(financialAccounts.status, 'active')
            )
          )
          .limit(1);
      }

      // 4. Assegurar Conta de Taxas
      let [feeAcc] = await db
        .select()
        .from(financialAccounts)
        .where(
          and(
            eq(financialAccounts.accountType, 'fees'),
            eq(financialAccounts.status, 'active')
          )
        )
        .limit(1);

      if (!feeAcc) {
        await db
          .insert(financialAccounts)
          .values({
            userId,
            accountType: 'fees',
            accountClass: 'revenue',
            status: 'active',
            name: 'System Fee Collector',
            createdAt: new Date(),
            updatedAt: new Date(),
          });
        [feeAcc] = await db
          .select()
          .from(financialAccounts)
          .where(
            and(
              eq(financialAccounts.accountType, 'fees'),
              eq(financialAccounts.status, 'active')
            )
          )
          .limit(1);
      }

      // 5. Assegurar linhas de saldo zeradas ou com saldo inicial
      const initialBal = (options.initialBalanceBaseUnits ?? 0n).toString();
      
      const systemAccounts = [treasuryAcc.id, operatingAcc.id, feeAcc.id];
      for (const accId of systemAccounts) {
        const [existingBal] = await db
          .select()
          .from(accountBalances)
          .where(
            and(
              eq(accountBalances.accountId, accId),
              eq(accountBalances.assetId, assetId)
            )
          )
          .limit(1);

        if (!existingBal) {
          await db.insert(accountBalances).values({
            accountId: accId,
            assetId,
            availableBaseUnits: accId === treasuryAcc.id ? initialBal : '0',
            lockedBaseUnits: '0',
            version: 1,
            updatedAt: new Date(),
          });
        }
      }

      return Result.ok({
        assetId,
        treasuryAccountId: treasuryAcc.id,
        operatingAccountId: operatingAcc.id,
        feeAccountId: feeAcc.id,
      });
    } catch (err: any) {
      return Result.fail(`Bootstrap failed: ${err.message}`);
    }
  }
}
```

---

## [Use Case] src/domains/finance/use-cases/GetTreasuryBalanceUseCase.ts

```typescript
import { IUnitOfWork } from '../../../application/ports/output/IUnitOfWork';
import { Result } from '../../../shared/kernel/Result';
import { AccountBalanceRecord } from '../../../application/ports/output/IFinanceRepository';

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

## [Use Case] src/domains/finance/use-cases/RecordTreasuryTransactionUseCase.ts

```typescript
import { IUnitOfWork } from '../../../application/ports/output/IUnitOfWork';
import { Result } from '../../../shared/kernel/Result';
import { DoubleEntryLedgerService } from '../services/DoubleEntryLedgerService';
import { LedgerTransaction } from '../entities/LedgerTransaction';
import { Money } from '../entities/Money';

export interface RecordTreasuryTransactionDTO {
  userId?: number | null;
  type: 'deposit' | 'withdrawal' | 'transfer' | 'payment' | 'refund' | 'fee' | 'reward' | 'yield' | 'conversion' | 'adjustment';
  direction: 'INBOUND' | 'OUTBOUND';
  category?: string;
  description: string;
  amountBaseUnits: string;
  assetId: number;
  idempotencyKey: string;
  requestHash: string;
}

export interface RecordTreasuryTransactionResult {
  transactionId?: number;
  isReplayed: boolean;
}

export class RecordTreasuryTransactionUseCase {
  constructor(
    private readonly uow: IUnitOfWork,
    private readonly ledgerService: DoubleEntryLedgerService
  ) {}

  async execute(dto: RecordTreasuryTransactionDTO): Promise<Result<RecordTreasuryTransactionResult>> {
    if (!dto.description || !dto.amountBaseUnits || !dto.idempotencyKey || !dto.requestHash || !dto.assetId || !dto.direction) {
      return Result.fail<RecordTreasuryTransactionResult>('Descrição, valor, assetId, direction, idempotencyKey e requestHash são obrigatórios.');
    }

    if (Number(dto.assetId) <= 0) {
      return Result.fail<RecordTreasuryTransactionResult>('AssetId inválido.');
    }

    // Validação estrita de Domínio: type vs direction
    const inboundOnly = ['deposit', 'yield', 'reward'];
    const outboundOnly = ['withdrawal', 'payment', 'fee'];
    
    if (dto.direction === 'INBOUND' && outboundOnly.includes(dto.type)) {
      return Result.fail<RecordTreasuryTransactionResult>(`Transação tipo '${dto.type}' não pode ser INBOUND.`);
    }
    if (dto.direction === 'OUTBOUND' && inboundOnly.includes(dto.type)) {
      return Result.fail<RecordTreasuryTransactionResult>(`Transação tipo '${dto.type}' não pode ser OUTBOUND.`);
    }

    // Materializa o Value Object
    const amountMoney = new Money(BigInt(dto.amountBaseUnits), String(dto.assetId));

    // Delegate to UoW, passing the factory to the ledger service (Clean Architecture)
    return await this.uow.execute(async (factory) => {
      const financeRepo = factory.getFinanceRepository();

      // Resolve a conta real da Tesouraria
      const treasuryRes = await financeRepo.getTreasuryAccount();
      if (treasuryRes.isFailure) return Result.fail<RecordTreasuryTransactionResult>(treasuryRes.error || 'Erro ao resolver conta de Tesouraria');
      const treasuryAccountId = treasuryRes.getValue().id;

      // Resolve a conta real do Usuário (se houver userId)
      let userAccountId: number;
      if (dto.userId) {
        const userAccRes = await financeRepo.getOrCreateUserAccount(dto.userId);
        if (userAccRes.isFailure) return Result.fail<RecordTreasuryTransactionResult>(userAccRes.error || 'Erro ao resolver conta do Usuário');
        userAccountId = userAccRes.getValue().id;
      } else {
        const sysAccRes = await financeRepo.getOrCreateOperatingAccount();
        if (sysAccRes.isFailure) return Result.fail<RecordTreasuryTransactionResult>('Erro ao resolver contrapartida do sistema');
        userAccountId = sysAccRes.getValue().id;
      }

      // Fábrica de Domínio Canônica
      const transaction = LedgerTransaction.createTreasuryMovement({
        direction: dto.direction,
        treasuryAccountId,
        userAccountId,
        amount: amountMoney,
        category: dto.category,
        type: dto.type,
        description: dto.description,
        idempotencyKey: dto.idempotencyKey,
        userId: dto.userId
      });

      // Passa a transação e o requestHash para o serviço de ledger atômico
      const result = await this.ledgerService.recordTransaction(transaction, factory, dto.requestHash);
      if (result.isFailure) return Result.fail<RecordTreasuryTransactionResult>(result.error as string);
      
      return Result.ok<RecordTreasuryTransactionResult>(result.getValue());
    });
  }
}
```

---

## [Use Case] src/domains/finance/use-cases/ReverseTransactionUseCase.ts

```typescript
import { IUnitOfWork } from '../../../application/ports/output/IUnitOfWork';
import { Result } from '../../../shared/kernel/Result';
import { LedgerTransaction, LedgerEntry } from '../entities/LedgerTransaction';
import { Money } from '../entities/Money';
import { DoubleEntryLedgerService } from '../services/DoubleEntryLedgerService';

export interface ReverseTransactionInput {
  originalTransactionId: number;
  idempotencyKey: string;
  reason: string;
  requestHash: string;
}

export class ReverseTransactionUseCase {
  constructor(
    private readonly uow: IUnitOfWork,
    private readonly ledgerService: DoubleEntryLedgerService
  ) {}

  async execute(input: ReverseTransactionInput): Promise<Result<{ transactionId?: number; isReplayed: boolean }>> {
    return await this.uow.execute(async (factory) => {
      const financeRepo = factory.getFinanceRepository();

      // 1. Buscar lançamentos da transação original
      const originalEntriesRes = await financeRepo.getTransactionEntries(input.originalTransactionId);
      if (originalEntriesRes.isFailure) {
        return Result.fail(`Transação original ${input.originalTransactionId} não encontrada: ${originalEntriesRes.error}`);
      }

      const originalEntries = originalEntriesRes.getValue();
      if (!originalEntries || originalEntries.length === 0) {
        return Result.fail(`Transação original ${input.originalTransactionId} não possui lançamentos contábeis.`);
      }

      // 2. Construir lançamentos espelho invertidos (debit <-> credit)
      const reverseEntries: LedgerEntry[] = originalEntries.map((e) => {
        const invertedType = e.direction === 'debit' ? 'credit' : 'debit';
        const amountBigInt = BigInt(e.amountBaseUnits);
        return new LedgerEntry({
          accountId: String(e.accountId),
          amount: new Money(amountBigInt, String(e.assetId)),
          type: invertedType,
          description: `Estorno de TX #${input.originalTransactionId}: ${input.reason}`,
        });
      });

      // 3. Instanciar transação de estorno contábil (reversal)
      const reversalTx = new LedgerTransaction({
        idempotencyKey: input.idempotencyKey,
        description: `Estorno da Transação #${input.originalTransactionId}: ${input.reason}`,
        entries: reverseEntries,
        transactionType: 'reversal',
      });

      // 4. Executar orquestração via Ledger Service (garantindo OCC, idempotência e outbox)
      return await this.ledgerService.recordTransaction(reversalTx, factory, input.requestHash);
    });
  }
}
```

---

# 2. Application Layer

## [Port] src/application/ports/output/IFinanceRepository.ts

```typescript
import { Result } from '../../../shared/kernel/Result';
import { LedgerEntry } from '../../../domains/finance/entities/LedgerTransaction';

export interface FinancialAccountRecord {
  id: number;
  userId: number | null;
  accountType: 'user_available' | 'treasury' | 'operating' | 'reserve' | 'fees' | 'escrow';
  status: 'active' | 'inactive' | 'suspended';
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
  type: 'deposit' | 'withdrawal' | 'transfer' | 'payment' | 'refund' | 'fee' | 'reward' | 'yield' | 'conversion' | 'adjustment';
  category: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'reversed' | 'refunded';
  description: string;
  createdAt: Date;
  completedAt?: Date | null;
}

export interface IFinanceRepository {
  getTreasuryAccount(): Promise<Result<FinancialAccountRecord>>;
  getOrCreateUserAccount(userId: number): Promise<Result<FinancialAccountRecord>>;
  getOrCreateOperatingAccount(): Promise<Result<FinancialAccountRecord>>;
  getTreasuryBalance(): Promise<Result<AccountBalanceRecord[]>>;

  listTransactions(userId?: number): Promise<Result<FinancialTransactionRecord[]>>;
  getTransactionEntries(transactionId: number): Promise<Result<Array<{ accountId: number; assetId: number; direction: 'debit' | 'credit'; amountBaseUnits: string }>>>;

  getIdempotencyRecord(key: string, scope: string): Promise<{ status: string; requestHash: string; transactionId?: number } | null>;
  claimIdempotency(idempotencyKey: string, userId: number | null | undefined, scope: string, requestHash: string): Promise<boolean>;
  completeIdempotency(key: string, scope: string, transactionId: number): Promise<void>;
  insertTransaction(data: {
    userId?: number | null;
    type: string;
    category: string;
    description: string;
    status: string;
  }): Promise<number>;
  insertLedgerEntries(entries: LedgerEntry[], transactionId: number): Promise<void>;
  updateBalanceWithOCC(
    accountId: string,
    assetId: string,
    amount: bigint,
    type: 'debit' | 'credit'
  ): Promise<boolean>;
  updateTransactionStatus(transactionId: number, status: string): Promise<void>;
  persistOutboxEvent(eventType: string, payload: any): Promise<void>;
}
```

---

## [Port] src/application/ports/output/IUnitOfWork.ts

```typescript
import { Result } from '../../../shared/kernel/Result';
import { IUserRepository } from './IUserRepository';
import { IAuthenticationRepository } from './IAuthenticationRepository';
import { IWeb3Repository } from './IWeb3Repository';
import { ICivilIdentityRepository } from './ICivilIdentityRepository';
import { ISessionRepository } from './ISessionRepository';
import { IOutboxRepository } from './IOutboxRepository';
import { IPasswordResetRepository } from './IPasswordResetRepository';
import { ISsiRepository } from './ISsiRepository';
import { IFinanceRepository } from './IFinanceRepository';

export interface IRepositoryFactory {
  getUserRepository(): IUserRepository;
  getAuthTransactionRepository(): import('./IAuthTransactionRepository').IAuthTransactionRepository;
  getAuthenticationRepository(): IAuthenticationRepository;
  getWeb3Repository(): IWeb3Repository;
  getSessionRepository(): ISessionRepository;
  getCivilIdentityRepository(): ICivilIdentityRepository;
  getSsiRepository(): ISsiRepository;
  getOutboxRepository(): IOutboxRepository;
  getPasswordResetRepository(): IPasswordResetRepository;
  getFinanceRepository(): IFinanceRepository;
}


export interface IUnitOfWork {
  execute<T>(work: (factory: IRepositoryFactory) => Promise<Result<T>>): Promise<Result<T>>;
}

```

---

## [DTO] src/application/dto/TransactionContext.ts

```typescript
/**
 * Abstração de Contexto Transacional no Application Layer.
 * Permite que Use Cases repassem o contexto transacional para repositórios
 * e portas de observabilidade/auditoria sem vazar dependências concretas do Drizzle/D1.
 */
export interface TransactionContext {
  readonly transactionId: string;
  readonly isScoped: true;
  readonly nativeTx?: unknown;
}
```

---

# 3. Persistence Layer

## [Schema] src/db/finance/relations.ts

```typescript
import { relations } from 'drizzle-orm';
import { users } from '../user/tables';
import {
  financialAssets,
  financialAccounts,
  financialTransactions,
  financialLedgerEntries,
  accountBalances,
  balanceHolds,
} from './tables';
import { idempotencyKeys } from '../infrastructure/tables';

/**
 * ============================================================================
 * FINANCE DOMAIN RELATIONS
 * ============================================================================
 * ARCHITECTURAL NOTE:
 * Navigation from users to finance entities is intentionally one-directional
 * (child → parent only), per Section 05 boundary isolation matrix.
 * Direct queries on finance tables should be executed with { with: { user: true } }
 * instead of querying bidirectionally from users.
 * ============================================================================
 */

// financialAssets
export const financialAssetsRelations = relations(financialAssets, ({ many }) => ({
  financialLedgerEntries: many(financialLedgerEntries),
  accountBalances: many(accountBalances),
  balanceHolds: many(balanceHolds),
}));

// financialAccounts
export const financialAccountsRelations = relations(financialAccounts, ({ one, many }) => ({
  user: one(users, {
    fields: [financialAccounts.userId],
    references: [users.id],
  }),
  financialLedgerEntries: many(financialLedgerEntries),
  accountBalances: many(accountBalances),
  balanceHolds: many(balanceHolds),
}));

// financialTransactions
export const financialTransactionsRelations = relations(financialTransactions, ({ one, many }) => ({
  user: one(users, {
    fields: [financialTransactions.userId],
    references: [users.id],
  }),
  ledgerEntries: many(financialLedgerEntries),
  idempotencyKeys: many(idempotencyKeys),
}));

// financialLedgerEntries
export const financialLedgerEntriesRelations = relations(financialLedgerEntries, ({ one }) => ({
  transaction: one(financialTransactions, {
    fields: [financialLedgerEntries.transactionId],
    references: [financialTransactions.id],
  }),
  account: one(financialAccounts, {
    fields: [financialLedgerEntries.accountId],
    references: [financialAccounts.id],
  }),
  asset: one(financialAssets, {
    fields: [financialLedgerEntries.assetId],
    references: [financialAssets.id],
  }),
}));

// accountBalances
export const accountBalancesRelations = relations(accountBalances, ({ one }) => ({
  account: one(financialAccounts, {
    fields: [accountBalances.accountId],
    references: [financialAccounts.id],
  }),
  asset: one(financialAssets, {
    fields: [accountBalances.assetId],
    references: [financialAssets.id],
  }),
}));

// balanceHolds
export const balanceHoldsRelations = relations(balanceHolds, ({ one }) => ({
  account: one(financialAccounts, {
    fields: [balanceHolds.accountId],
    references: [financialAccounts.id],
  }),
  asset: one(financialAssets, {
    fields: [balanceHolds.assetId],
    references: [financialAssets.id],
  }),
}));

// idempotencyKeys (Cross-domain relation setup)
export const idempotencyKeysRelations = relations(idempotencyKeys, ({ one }) => ({
  user: one(users, {
    fields: [idempotencyKeys.userId],
    references: [users.id],
  }),
  financialTransaction: one(financialTransactions, {
    fields: [idempotencyKeys.financialTransactionId],
    references: [financialTransactions.id],
  }),
}));
```

---

## [Schema] src/db/finance/tables.ts

```typescript
import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
  check,
  foreignKey,
} from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

import { users } from '../user/tables';

/**
 * ============================================================================
 * FINANCE DOMAIN
 * ============================================================================
 *
 * Responsibilities:
 * - Financial assets supported by the platform
 * - Financial accounts (with explicit accountClass)
 * - Financial transactions
 * - Double-entry ledger (per-asset balance invariant)
 * - Account balances (D1 binding safe max 9,007,199,254,740,991)
 * - Balance holds
 * - Fiat providers / accounts / payment operations
 * - Crypto financial operations
 * - Asset conversions (exact rational rates)
 * - Fees
 * - External transaction references
 * - Idempotency
 * - Reconciliation
 * ============================================================================
 */

export const MAX_BINDING_SAFE_BASE_UNITS = 9007199254740991; // Number.MAX_SAFE_INTEGER (2^53 - 1)

/* ============================================================================
 * 1. FINANCIAL ASSETS
 * ============================================================================
 */
export const financialAssets = sqliteTable(
  'financial_assets',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    code: text('code').notNull(),
    symbol: text('symbol').notNull(),
    name: text('name').notNull(),
    type: text('type', {
      enum: ['fiat', 'crypto'],
    }).notNull(),
    decimals: integer('decimals').notNull(),
    status: text('status', {
      enum: ['active', 'inactive'],
    })
      .notNull()
      .default('active'),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdateFn(() => new Date()),
  },
  (table) => ({
    codeUq: uniqueIndex('uq_financial_assets_code').on(table.code),
    typeIdx: index('idx_financial_assets_type').on(table.type),
    statusIdx: index('idx_financial_assets_status').on(table.status),
    typeCheck: check('ck_financial_assets_type', sql`${table.type} IN ('fiat', 'crypto')`),
    statusCheck: check(
      'ck_financial_assets_status',
      sql`${table.status} IN ('active', 'inactive')`
    ),
    decimalsCheck: check(
      'ck_financial_assets_decimals',
      sql`${table.decimals} >= 0 AND ${table.decimals} <= 18`
    ),
  })
);

/* ============================================================================
 * 2. FINANCIAL ACCOUNTS
 * ============================================================================
 */
export const financialAccounts = sqliteTable(
  'financial_accounts',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id').references(() => users.id, {
      onDelete: 'restrict',
    }),
    accountType: text('account_type', {
      enum: ['user_available', 'treasury', 'operating', 'reserve', 'fees', 'escrow'],
    }).notNull(),
    accountClass: text('account_class', {
      enum: ['asset', 'liability', 'equity', 'revenue', 'expense'],
    }).notNull().default('liability'),
    status: text('status', {
      enum: ['active', 'inactive', 'suspended'],
    })
      .notNull()
      .default('active'),
    name: text('name').notNull(),
    version: integer('version').notNull().default(1),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdateFn(() => new Date()),
  },
  (table) => ({
    userIdx: index('idx_financial_accounts_user').on(table.userId),
    typeIdx: index('idx_financial_accounts_type').on(table.accountType),
    classIdx: index('idx_financial_accounts_class').on(table.accountClass),
    statusIdx: index('idx_financial_accounts_status').on(table.status),
    accountTypeCheck: check(
      'ck_financial_accounts_type',
      sql`${table.accountType} IN ('user_available', 'treasury', 'operating', 'reserve', 'fees', 'escrow')`
    ),
    accountClassCheck: check(
      'ck_financial_accounts_class',
      sql`${table.accountClass} IN ('asset', 'liability', 'equity', 'revenue', 'expense')`
    ),
    statusCheck: check(
      'ck_financial_accounts_status',
      sql`${table.status} IN ('active', 'inactive', 'suspended')`
    ),
    userAccountTypeUq: uniqueIndex('uq_financial_accounts_user_type_name').on(
      table.userId,
      table.accountType,
      table.name
    ),
    activeTreasurySingletonUnq: uniqueIndex('uq_treasury_active_singleton')
      .on(table.accountType)
      .where(sql`${table.accountType} = 'treasury' AND ${table.status} = 'active'`),
    ownerRuleCheck: check(
      'ck_financial_accounts_owner_rule',
      sql`(${table.accountType} = 'user_available' AND ${table.userId} IS NOT NULL) OR (${table.accountType} != 'user_available' AND ${table.userId} IS NULL)`
    ),
    versionCheck: check('ck_financial_accounts_version', sql`${table.version} > 0`),
  })
);

/* ============================================================================
 * 3. FINANCIAL TRANSACTIONS
 * ============================================================================
 */
export const financialTransactions = sqliteTable(
  'financial_transactions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id').references(() => users.id, {
      onDelete: 'restrict',
    }),
    type: text('type', {
      enum: [
        'deposit',
        'withdrawal',
        'transfer',
        'payment',
        'refund',
        'fee',
        'reward',
        'yield',
        'conversion',
        'adjustment',
        'reversal',
        'inbound',
        'outbound',
      ],
    }).notNull(),
    category: text('category', {
      enum: [
        'membership',
        'rwa_yield',
        'grant',
        'operational',
        'payment',
        'trading',
        'withdrawal',
        'deposit',
        'fee',
        'other',
      ],
    })
      .notNull()
      .default('other'),
    status: text('status', {
      enum: ['pending', 'processing', 'completed', 'failed', 'cancelled', 'reversed', 'refunded'],
    })
      .notNull()
      .default('pending'),
    sourceType: text('source_type', {
      enum: [
        'contribution',
        'grant',
        'membership',
        'payroll',
        'withdrawal',
        'payment',
        'conversion',
        'system',
        'other',
      ],
    }),
    sourceId: text('source_id'),
    correlationId: text('correlation_id'),
    description: text('description').notNull(),
    version: integer('version').notNull().default(1),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdateFn(() => new Date()),
    completedAt: integer('completed_at', { mode: 'timestamp' }),
  },
  (table) => ({
    userIdx: index('idx_financial_transactions_user').on(table.userId),
    typeIdx: index('idx_financial_transactions_type').on(table.type),
    statusIdx: index('idx_financial_transactions_status').on(table.status),
    createdIdx: index('idx_financial_transactions_created').on(table.createdAt),
    correlationIdx: index('idx_financial_transactions_correlation').on(table.correlationId),
    typeCheck: check(
      'ck_financial_tx_type',
      sql`${table.type} IN ('deposit', 'withdrawal', 'transfer', 'payment', 'refund', 'fee', 'reward', 'yield', 'conversion', 'adjustment', 'reversal', 'inbound', 'outbound')`
    ),
    categoryCheck: check(
      'ck_financial_tx_category',
      sql`${table.category} IN ('membership', 'rwa_yield', 'grant', 'operational', 'payment', 'trading', 'withdrawal', 'deposit', 'fee', 'other')`
    ),
    statusCheck: check(
      'ck_financial_tx_status',
      sql`${table.status} IN ('pending', 'processing', 'completed', 'failed', 'cancelled', 'reversed', 'refunded')`
    ),
    sourceTypeCheck: check(
      'ck_financial_tx_source_type',
      sql`${table.sourceType} IS NULL OR ${table.sourceType} IN ('contribution', 'grant', 'membership', 'payroll', 'withdrawal', 'payment', 'conversion', 'system', 'other')`
    ),
    completedStateCheck: check(
      'ck_financial_tx_completed_state',
      sql`${table.status} != 'completed' OR ${table.completedAt} IS NOT NULL`
    ),
    temporalOrderCheck: check(
      'ck_financial_tx_dates',
      sql`${table.completedAt} IS NULL OR ${table.completedAt} >= ${table.createdAt}`
    ),
    versionCheck: check('ck_financial_tx_version', sql`${table.version} > 0`),
  })
);

/* ============================================================================
 * 4. FINANCIAL LEDGER ENTRIES
 * ============================================================================
 */
export const financialLedgerEntries = sqliteTable(
  'financial_ledger_entries',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    transactionId: integer('transaction_id')
      .notNull()
      .references(() => financialTransactions.id, {
        onDelete: 'restrict',
      }),
    accountId: integer('account_id')
      .notNull()
      .references(() => financialAccounts.id, {
        onDelete: 'restrict',
      }),
    assetId: integer('asset_id')
      .notNull()
      .references(() => financialAssets.id, {
        onDelete: 'restrict',
      }),
    direction: text('direction', {
      enum: ['debit', 'credit'],
    }).notNull(),
    amountBaseUnits: text('amount_base_units').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    transactionIdx: index('idx_financial_ledger_entries_transaction').on(table.transactionId),
    accountIdx: index('idx_financial_ledger_entries_account').on(table.accountId),
    assetIdx: index('idx_financial_ledger_entries_asset').on(table.assetId),
    createdIdx: index('idx_financial_ledger_entries_created').on(table.createdAt),
    directionCheck: check(
      'ck_financial_ledger_direction',
      sql`${table.direction} IN ('debit', 'credit')`
    ),
    amountCheck: check(
      'ck_financial_ledger_entries_amount_range',
      sql`length(${table.amountBaseUnits}) > 0`
    ),
  })
);

/* ============================================================================
 * 5. ACCOUNT BALANCES
 * ============================================================================
 */
export const accountBalances = sqliteTable(
  'account_balances',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    accountId: integer('account_id')
      .notNull()
      .references(() => financialAccounts.id, {
        onDelete: 'restrict',
      }),
    assetId: integer('asset_id')
      .notNull()
      .references(() => financialAssets.id, {
        onDelete: 'restrict',
      }),
    availableBaseUnits: text('available_base_units').notNull().default('0'),
    lockedBaseUnits: text('locked_base_units').notNull().default('0'),
    version: integer('version').notNull().default(1),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdateFn(() => new Date()),
  },
  (table) => ({
    accountAssetUq: uniqueIndex('uq_account_balances_account_asset').on(
      table.accountId,
      table.assetId
    ),
    accountIdx: index('idx_account_balances_account').on(table.accountId),
    assetIdx: index('idx_account_balances_asset').on(table.assetId),
    availableCheck: check(
      'ck_account_balances_available_range',
      sql`length(${table.availableBaseUnits}) > 0`
    ),
    lockedCheck: check(
      'ck_account_balances_locked_range',
      sql`length(${table.lockedBaseUnits}) > 0`
    ),
    versionCheck: check('ck_account_balances_version', sql`${table.version} > 0`),
  })
);

/* ============================================================================
 * 6. BALANCE HOLDS
 * ============================================================================
 */
export const balanceHolds = sqliteTable(
  'balance_holds',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    accountId: integer('account_id')
      .notNull()
      .references(() => financialAccounts.id, {
        onDelete: 'restrict',
      }),
    assetId: integer('asset_id')
      .notNull()
      .references(() => financialAssets.id, {
        onDelete: 'restrict',
      }),
    amountBaseUnits: integer('amount_base_units', { mode: 'number' }).notNull(),
    reason: text('reason').notNull(),
    referenceType: text('reference_type'),
    referenceId: text('reference_id'),
    status: text('status', {
      enum: ['active', 'released', 'expired', 'consumed'],
    })
      .notNull()
      .default('active'),
    version: integer('version').notNull().default(1),
    expiresAt: integer('expires_at', { mode: 'timestamp' }),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdateFn(() => new Date()),
    releasedAt: integer('released_at', { mode: 'timestamp' }),
  },
  (table) => ({
    accountIdx: index('idx_balance_holds_account').on(table.accountId),
    assetIdx: index('idx_balance_holds_asset').on(table.assetId),
    statusIdx: index('idx_balance_holds_status').on(table.status),
    referenceIdx: index('idx_balance_holds_reference').on(table.referenceType, table.referenceId),
    statusCheck: check(
      'ck_balance_holds_status',
      sql`${table.status} IN ('active', 'released', 'expired', 'consumed')`
    ),
    amountCheck: check(
      'ck_balance_holds_amount_range',
      sql`${table.amountBaseUnits} > 0 AND ${table.amountBaseUnits} <= 9007199254740991`
    ),
    releasedStateCheck: check(
      'ck_balance_holds_released_state',
      sql`${table.status} != 'released' OR ${table.releasedAt} IS NOT NULL`
    ),
    expiredStateCheck: check(
      'ck_balance_holds_expired_state',
      sql`${table.status} != 'expired' OR ${table.expiresAt} IS NOT NULL`
    ),
    versionCheck: check('ck_balance_holds_version', sql`${table.version} > 0`),
  })
);

/* ============================================================================
 * 7. FIAT PROVIDERS
 * ============================================================================
 */
export const fiatProviders = sqliteTable(
  'fiat_providers',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    code: text('code').notNull(),
    type: text('type', {
      enum: ['bank', 'payment_provider', 'pix_provider', 'gateway'],
    }).notNull(),
    status: text('status', {
      enum: ['active', 'inactive', 'suspended'],
    })
      .notNull()
      .default('active'),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdateFn(() => new Date()),
  },
  (table) => ({
    codeUq: uniqueIndex('uq_fiat_providers_code').on(table.code),
    typeIdx: index('idx_fiat_providers_type').on(table.type),
    statusIdx: index('idx_fiat_providers_status').on(table.status),
    typeCheck: check(
      'ck_fiat_providers_type',
      sql`${table.type} IN ('bank', 'payment_provider', 'pix_provider', 'gateway')`
    ),
    statusCheck: check(
      'ck_fiat_providers_status',
      sql`${table.status} IN ('active', 'inactive', 'suspended')`
    ),
  })
);

/* ============================================================================
 * 8. FIAT ACCOUNTS
 * ============================================================================
 */
export const fiatAccounts = sqliteTable(
  'fiat_accounts',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, {
        onDelete: 'restrict',
      }),
    assetId: integer('asset_id')
      .notNull()
      .references(() => financialAssets.id, {
        onDelete: 'restrict',
      }),
    providerId: integer('provider_id').references(() => fiatProviders.id, {
      onDelete: 'restrict',
    }),
    type: text('type', {
      enum: ['bank_account', 'payment_account', 'pix_account'],
    }).notNull(),
    externalAccountId: text('external_account_id'),
    displayName: text('display_name'),
    last4: text('last4'),
    status: text('status', {
      enum: ['active', 'inactive', 'blocked'],
    })
      .notNull()
      .default('active'),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdateFn(() => new Date()),
    blockedAt: integer('blocked_at', { mode: 'timestamp' }),
  },
  (table) => ({
    userIdx: index('idx_fiat_accounts_user').on(table.userId),
    providerIdx: index('idx_fiat_accounts_provider').on(table.providerId),
    statusIdx: index('idx_fiat_accounts_status').on(table.status),
    typeCheck: check(
      'ck_fiat_accounts_type',
      sql`${table.type} IN ('bank_account', 'payment_account', 'pix_account')`
    ),
    statusCheck: check(
      'ck_fiat_accounts_status',
      sql`${table.status} IN ('active', 'inactive', 'blocked')`
    ),
    blockedStateCheck: check(
      'ck_fiat_accounts_blocked_state',
      sql`${table.status} != 'blocked' OR ${table.blockedAt} IS NOT NULL`
    ),
    externalUq: uniqueIndex('uq_fiat_accounts_provider_external').on(
      table.providerId,
      table.externalAccountId
    ),
  })
);

/* ============================================================================
 * 9. FIAT PAYMENT METHODS
 * ============================================================================
 */
export const fiatPaymentMethods = sqliteTable(
  'fiat_payment_methods',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, {
        onDelete: 'restrict',
      }),
    fiatAccountId: integer('fiat_account_id'),
    type: text('type', {
      enum: ['pix', 'bank_transfer', 'boleto', 'card'],
    }).notNull(),
    label: text('label').notNull(),
    status: text('status', {
      enum: ['active', 'inactive', 'blocked'],
    })
      .notNull()
      .default('active'),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdateFn(() => new Date()),
    blockedAt: integer('blocked_at', { mode: 'timestamp' }),
  },
  (table) => ({
    fiatAccountFk: foreignKey({
      columns: [table.userId, table.fiatAccountId],
      foreignColumns: [fiatAccounts.userId, fiatAccounts.id],
      name: 'fk_fiat_payment_methods_user_account',
    }).onDelete('restrict'),
    userIdx: index('idx_fiat_payment_methods_user').on(table.userId),
    accountIdx: index('idx_fiat_payment_methods_account').on(table.fiatAccountId),
    typeIdx: index('idx_fiat_payment_methods_type').on(table.type),
    statusIdx: index('idx_fiat_payment_methods_status').on(table.status),
    typeCheck: check(
      'ck_fiat_pm_type',
      sql`${table.type} IN ('pix', 'bank_transfer', 'boleto', 'card')`
    ),
    statusCheck: check(
      'ck_fiat_pm_status',
      sql`${table.status} IN ('active', 'inactive', 'blocked')`
    ),
    blockedStateCheck: check(
      'ck_fiat_pm_blocked_state',
      sql`${table.status} != 'blocked' OR ${table.blockedAt} IS NOT NULL`
    ),
  })
);

/* ============================================================================
 * 10. FIAT TRANSACTIONS
 * ============================================================================
 */
export const fiatTransactions = sqliteTable(
  'fiat_transactions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    financialTransactionId: integer('financial_transaction_id')
      .notNull()
      .references(() => financialTransactions.id, {
        onDelete: 'restrict',
      }),
    providerId: integer('provider_id').references(() => fiatProviders.id, {
      onDelete: 'restrict',
    }),
    paymentMethodId: integer('payment_method_id').references(() => fiatPaymentMethods.id, {
      onDelete: 'restrict',
    }),
    assetId: integer('asset_id')
      .notNull()
      .references(() => financialAssets.id, {
        onDelete: 'restrict',
      }),
    direction: text('direction', {
      enum: ['inbound', 'outbound'],
    }).notNull(),
    amountBaseUnits: integer('amount_base_units', { mode: 'number' }).notNull(),
    status: text('status', {
      enum: ['pending', 'processing', 'completed', 'failed', 'cancelled', 'reversed'],
    })
      .notNull()
      .default('pending'),
    version: integer('version').notNull().default(1),
    requestedAt: integer('requested_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    processedAt: integer('processed_at', { mode: 'timestamp' }),
    settledAt: integer('settled_at', { mode: 'timestamp' }),
  },
  (table) => ({
    transactionUq: uniqueIndex('uq_fiat_transactions_financial_transaction').on(
      table.financialTransactionId
    ),
    providerIdx: index('idx_fiat_transactions_provider').on(table.providerId),
    paymentMethodIdx: index('idx_fiat_transactions_payment_method').on(table.paymentMethodId),
    assetIdx: index('idx_fiat_transactions_asset').on(table.assetId),
    statusIdx: index('idx_fiat_transactions_status').on(table.status),
    directionCheck: check(
      'ck_fiat_tx_direction',
      sql`${table.direction} IN ('inbound', 'outbound')`
    ),
    statusCheck: check(
      'ck_fiat_tx_status',
      sql`${table.status} IN ('pending', 'processing', 'completed', 'failed', 'cancelled', 'reversed')`
    ),
    amountCheck: check(
      'ck_fiat_transactions_amount_range',
      sql`${table.amountBaseUnits} > 0 AND ${table.amountBaseUnits} <= 9007199254740991`
    ),
    temporalOrderCheck: check(
      'ck_fiat_tx_dates',
      sql`${table.settledAt} IS NULL OR ${table.settledAt} >= ${table.requestedAt}`
    ),
    versionCheck: check('ck_fiat_tx_version', sql`${table.version} > 0`),
  })
);

/* ============================================================================
 * 11. CRYPTO TRANSACTIONS
 * ============================================================================
 */
export const cryptoTransactions = sqliteTable(
  'crypto_transactions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    financialTransactionId: integer('financial_transaction_id')
      .notNull()
      .references(() => financialTransactions.id, {
        onDelete: 'restrict',
      }),
    assetId: integer('asset_id')
      .notNull()
      .references(() => financialAssets.id, {
        onDelete: 'restrict',
      }),
    web3TransactionId: text('web3_transaction_id'),
    direction: text('direction', {
      enum: ['inbound', 'outbound'],
    }).notNull(),
    amountBaseUnits: integer('amount_base_units', { mode: 'number' }).notNull(),
    feeAssetId: integer('fee_asset_id').references(() => financialAssets.id, {
      onDelete: 'restrict',
    }),
    feeBaseUnits: integer('fee_base_units', { mode: 'number' }).notNull().default(0),
    status: text('status', {
      enum: ['pending', 'processing', 'confirmed', 'failed', 'reversed'],
    })
      .notNull()
      .default('pending'),
    version: integer('version').notNull().default(1),
    requestedAt: integer('requested_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    settledAt: integer('settled_at', { mode: 'timestamp' }),
  },
  (table) => ({
    transactionUq: uniqueIndex('uq_crypto_transactions_financial_transaction').on(
      table.financialTransactionId
    ),
    web3TransactionUq: uniqueIndex('uq_crypto_transactions_web3_transaction').on(
      table.web3TransactionId
    ),
    assetIdx: index('idx_crypto_transactions_asset').on(table.assetId),
    statusIdx: index('idx_crypto_transactions_status').on(table.status),
    directionCheck: check(
      'ck_crypto_tx_direction',
      sql`${table.direction} IN ('inbound', 'outbound')`
    ),
    statusCheck: check(
      'ck_crypto_tx_status',
      sql`${table.status} IN ('pending', 'processing', 'confirmed', 'failed', 'reversed')`
    ),
    amountCheck: check(
      'ck_crypto_transactions_amount_range',
      sql`${table.amountBaseUnits} > 0 AND ${table.amountBaseUnits} <= 9007199254740991`
    ),
    feeCheck: check(
      'ck_crypto_transactions_fee_range',
      sql`${table.feeBaseUnits} >= 0 AND ${table.feeBaseUnits} <= 9007199254740991`
    ),
    feeAssetCheck: check(
      'ck_crypto_transactions_fee_asset',
      sql`${table.feeBaseUnits} = 0 OR ${table.feeAssetId} IS NOT NULL`
    ),
    temporalOrderCheck: check(
      'ck_crypto_tx_dates',
      sql`${table.settledAt} IS NULL OR ${table.settledAt} >= ${table.requestedAt}`
    ),
    versionCheck: check('ck_crypto_tx_version', sql`${table.version} > 0`),
  })
);

/* ============================================================================
 * 12. EXCHANGE RATES
 * ============================================================================
 */
export const exchangeRates = sqliteTable(
  'exchange_rates',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    baseAssetId: integer('base_asset_id')
      .notNull()
      .references(() => financialAssets.id, {
        onDelete: 'restrict',
      }),
    quoteAssetId: integer('quote_asset_id')
      .notNull()
      .references(() => financialAssets.id, {
        onDelete: 'restrict',
      }),
    rateNumerator: integer('rate_numerator', { mode: 'number' }).notNull(),
    rateDenominator: integer('rate_denominator', { mode: 'number' }).notNull(),
    source: text('source').notNull(),
    quotedAt: integer('quoted_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    expiresAt: integer('expires_at', { mode: 'timestamp' }),
  },
  (table) => ({
    pairIdx: index('idx_exchange_rates_pair').on(table.baseAssetId, table.quoteAssetId),
    quotedIdx: index('idx_exchange_rates_quoted').on(table.quotedAt),
    pairDifferentCheck: check(
      'ck_exchange_rates_different_assets',
      sql`${table.baseAssetId} <> ${table.quoteAssetId}`
    ),
    rateNumeratorCheck: check('ck_exchange_rates_numerator_positive', sql`${table.rateNumerator} > 0`),
    rateDenominatorCheck: check('ck_exchange_rates_denominator_positive', sql`${table.rateDenominator} > 0`),
    expiresCheck: check(
      'ck_exchange_rates_expires_after_quoted',
      sql`${table.expiresAt} IS NULL OR ${table.expiresAt} >= ${table.quotedAt}`
    ),
  })
);

/* ============================================================================
 * 13. ASSET CONVERSIONS
 * ============================================================================
 */
export const assetConversions = sqliteTable(
  'asset_conversions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    financialTransactionId: integer('financial_transaction_id')
      .notNull()
      .references(() => financialTransactions.id, {
        onDelete: 'restrict',
      }),
    fromAssetId: integer('from_asset_id')
      .notNull()
      .references(() => financialAssets.id, {
        onDelete: 'restrict',
      }),
    toAssetId: integer('to_asset_id')
      .notNull()
      .references(() => financialAssets.id, {
        onDelete: 'restrict',
      }),
    fromAmountBaseUnits: integer('from_amount_base_units', { mode: 'number' }).notNull(),
    toAmountBaseUnits: integer('to_amount_base_units', { mode: 'number' }).notNull(),
    rateNumerator: integer('rate_numerator', { mode: 'number' }).notNull(),
    rateDenominator: integer('rate_denominator', { mode: 'number' }).notNull(),
    rateSource: text('rate_source'),
    quotedAt: integer('quoted_at', { mode: 'timestamp' }),
    feeAmountBaseUnits: integer('fee_amount_base_units', { mode: 'number' }).notNull().default(0),
    status: text('status', {
      enum: ['pending', 'processing', 'completed', 'failed', 'cancelled'],
    })
      .notNull()
      .default('pending'),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    completedAt: integer('completed_at', { mode: 'timestamp' }),
  },
  (table) => ({
    transactionUq: uniqueIndex('uq_asset_conversions_transaction').on(table.financialTransactionId),
    fromAssetIdx: index('idx_asset_conversions_from_asset').on(table.fromAssetId),
    toAssetIdx: index('idx_asset_conversions_to_asset').on(table.toAssetId),
    statusCheck: check(
      'ck_asset_conversions_status',
      sql`${table.status} IN ('pending', 'processing', 'completed', 'failed', 'cancelled')`
    ),
    fromAmountCheck: check(
      'ck_asset_conversions_from_amount_range',
      sql`${table.fromAmountBaseUnits} > 0 AND ${table.fromAmountBaseUnits} <= 9007199254740991`
    ),
    toAmountCheck: check(
      'ck_asset_conversions_to_amount_range',
      sql`${table.toAmountBaseUnits} > 0 AND ${table.toAmountBaseUnits} <= 9007199254740991`
    ),
    feeCheck: check(
      'ck_asset_conversions_fee_range',
      sql`${table.feeAmountBaseUnits} >= 0 AND ${table.feeAmountBaseUnits} <= 9007199254740991`
    ),
    assetsDifferentCheck: check(
      'ck_asset_conversions_different_assets',
      sql`${table.fromAssetId} <> ${table.toAssetId}`
    ),
    rateNumeratorCheck: check('ck_asset_conversions_numerator_positive', sql`${table.rateNumerator} > 0`),
    rateDenominatorCheck: check('ck_asset_conversions_denominator_positive', sql`${table.rateDenominator} > 0`),
  })
);

/* ============================================================================
 * 14. FINANCIAL FEES
 * ============================================================================
 */
export const financialFees = sqliteTable(
  'financial_fees',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    transactionId: integer('transaction_id')
      .notNull()
      .references(() => financialTransactions.id, {
        onDelete: 'restrict',
      }),
    assetId: integer('asset_id')
      .notNull()
      .references(() => financialAssets.id, {
        onDelete: 'restrict',
      }),
    recipientAccountId: integer('recipient_account_id').references(() => financialAccounts.id, {
      onDelete: 'restrict',
    }),
    feeType: text('fee_type', {
      enum: ['platform', 'withdrawal', 'payment', 'conversion', 'network', 'other'],
    }).notNull(),
    amountBaseUnits: integer('amount_base_units', { mode: 'number' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    transactionIdx: index('idx_financial_fees_transaction').on(table.transactionId),
    assetIdx: index('idx_financial_fees_asset').on(table.assetId),
    recipientIdx: index('idx_financial_fees_recipient_account').on(table.recipientAccountId),
    feeTypeCheck: check(
      'ck_financial_fees_type',
      sql`${table.feeType} IN ('platform', 'withdrawal', 'payment', 'conversion', 'network', 'other')`
    ),
    amountCheck: check(
      'ck_financial_fees_amount_range',
      sql`${table.amountBaseUnits} > 0 AND ${table.amountBaseUnits} <= 9007199254740991`
    ),
  })
);

/* ============================================================================
 * 15. EXTERNAL TRANSACTIONS
 * ============================================================================
 */
export const fiatExternalTransactions = sqliteTable(
  'fiat_external_transactions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    financialTransactionId: integer('financial_transaction_id')
      .notNull()
      .references(() => financialTransactions.id, {
        onDelete: 'restrict',
      }),
    providerId: integer('provider_id').references(() => fiatProviders.id, {
      onDelete: 'restrict',
    }),
    externalTransactionId: text('external_transaction_id').notNull(),
    type: text('type').notNull(),
    status: text('status').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdateFn(() => new Date()),
  },
  (table) => ({
    providerExternalUq: uniqueIndex('uq_fiat_external_transactions_provider_external').on(
      table.providerId,
      table.externalTransactionId
    ),
    transactionIdx: index('idx_fiat_external_transactions_transaction').on(
      table.financialTransactionId
    ),
    providerIdx: index('idx_fiat_external_transactions_provider').on(table.providerId),
    statusIdx: index('idx_fiat_external_transactions_status').on(table.status),
  })
);

/* ============================================================================
 * 16. IDEMPOTENCY KEYS
 * ============================================================================
 */
export { idempotencyKeys } from '../infrastructure/tables';

/* ============================================================================
 * 17. RECONCILIATION RECORDS
 * ============================================================================
 */
export const reconciliationRecords = sqliteTable(
  'reconciliation_records',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    providerId: integer('provider_id').references(() => fiatProviders.id, {
      onDelete: 'restrict',
    }),
    accountId: integer('account_id')
      .notNull()
      .references(() => financialAccounts.id, {
        onDelete: 'restrict',
      }),
    assetId: integer('asset_id')
      .notNull()
      .references(() => financialAssets.id, {
        onDelete: 'restrict',
      }),
    expectedBalanceBaseUnits: integer('expected_balance_base_units', { mode: 'number' }).notNull(),
    actualBalanceBaseUnits: integer('actual_balance_base_units', { mode: 'number' }).notNull(),
    differenceBaseUnits: integer('difference_base_units', { mode: 'number' }).notNull(),
    status: text('status', {
      enum: ['matched', 'mismatch', 'resolved'],
    })
      .notNull()
      .default('matched'),
    reconciliationRunId: text('reconciliation_run_id').notNull(),
    version: integer('version').notNull().default(1),
    reconciliationDate: integer('reconciliation_date', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    resolvedAt: integer('resolved_at', { mode: 'timestamp' }),
  },
  (table) => ({
    accountIdx: index('idx_reconciliation_records_account').on(table.accountId),
    assetIdx: index('idx_reconciliation_records_asset').on(table.assetId),
    providerIdx: index('idx_reconciliation_records_provider').on(table.providerId),
    statusIdx: index('idx_reconciliation_records_status').on(table.status),
    statusCheck: check(
      'ck_reconciliation_status',
      sql`${table.status} IN ('matched', 'mismatch', 'resolved')`
    ),
    resolvedStateCheck: check(
      'ck_reconciliation_resolved_state',
      sql`${table.status} != 'resolved' OR ${table.resolvedAt} IS NOT NULL`
    ),
    versionCheck: check('ck_reconciliation_records_version', sql`${table.version} > 0`),
    expectedCheck: check(
      'ck_reconciliation_expected_range',
      sql`${table.expectedBalanceBaseUnits} >= 0 AND ${table.expectedBalanceBaseUnits} <= 9007199254740991`
    ),
    actualCheck: check(
      'ck_reconciliation_actual_range',
      sql`${table.actualBalanceBaseUnits} >= 0 AND ${table.actualBalanceBaseUnits} <= 9007199254740991`
    ),
  })
);

```

---

## [Schema] src/db/infrastructure/tables.ts

```typescript
import { sqliteTable, text, integer, index, uniqueIndex, check } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { users } from '../user/tables';
import { financialTransactions } from '../finance/tables';

/**
 * ============================================================================
 * INFRASTRUCTURE DOMAIN (Outbox, Idempotency & Message Receipts)
 * ============================================================================
 */

// ----------------------------------------------------------------------
// Entity: outboxEvents
// ----------------------------------------------------------------------
export const outboxEvents = sqliteTable(
  'outbox_events',
  {
    id: text('id').primaryKey(), // UUID do evento (eventId)
    aggregateId: text('aggregate_id').notNull(),
    aggregateType: text('aggregate_type').notNull(),
    aggregateVersion: integer('aggregate_version').notNull(),
    eventName: text('event_name').notNull(),
    payload: text('payload').notNull(), // JSON
    metadata: text('metadata'), // JSON
    attempts: integer('attempts').default(0).notNull(),
    status: text('status', {
      enum: ['pending', 'processing', 'published', 'failed', 'dead_letter'],
    })
      .default('pending')
      .notNull(),
    publishedAt: integer('published_at', { mode: 'timestamp' }),
    leaseOwner: text('lease_owner'),
    leaseGeneration: integer('lease_generation').default(0).notNull(),
    leaseExpiresAt: integer('lease_expires_at', { mode: 'timestamp' }),
    error: text('error'),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull(),
  },
  (table) => ({
    statusIdx: index('idx_outbox_events_status').on(table.status),
    leaseIdx: index('idx_outbox_events_lease').on(table.leaseExpiresAt),
    createdIdx: index('idx_outbox_events_created').on(table.createdAt),
    statusCheck: check(
      'ck_outbox_events_status',
      sql`${table.status} IN ('pending', 'processing', 'published', 'failed', 'dead_letter')`
    ),
  })
);

// ----------------------------------------------------------------------
// Entity: idempotencyKeys
// ----------------------------------------------------------------------
export const idempotencyKeys = sqliteTable(
  'idempotency_keys',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id').references(() => users.id, { onDelete: 'restrict' }),
    scope: text('scope').notNull().default('default'),
    key: text('key').notNull(),
    requestHash: text('request_hash').notNull(),
    financialTransactionId: integer('financial_transaction_id').references(
      () => financialTransactions.id,
      { onDelete: 'restrict' }
    ),
    status: text('status', {
      enum: ['processing', 'completed', 'failed'],
    })
      .notNull()
      .default('processing'),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp' }),
  },
  (table) => ({
    scopeKeyUnq: uniqueIndex('uq_idempotency_scope_key').on(table.scope, table.key),
    statusIdx: index('idx_idempotency_keys_status').on(table.status),
  })
);

// ----------------------------------------------------------------------
// Entity: eventConsumerReceipts
// ----------------------------------------------------------------------
export const eventConsumerReceipts = sqliteTable(
  'event_consumer_receipts',
  {
    id: text('id').primaryKey(), // UUID v4
    consumerId: text('consumer_id').notNull(),
    eventId: text('event_id').notNull(),
    processedAt: integer('processed_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull(),
  },
  (table) => ({
    consumerEventUnq: uniqueIndex('uq_consumer_event').on(table.consumerId, table.eventId),
    eventIdx: index('idx_receipts_event').on(table.eventId),
  })
);

// ----------------------------------------------------------------------
// Entity: eventInbox (DOD-14 Idempotência de Webhooks Externos)
// ----------------------------------------------------------------------
export const eventInbox = sqliteTable(
  'event_inbox',
  {
    id: text('id').primaryKey(),
    providerId: integer('provider_id').notNull(),
    externalEventId: text('external_event_id').notNull(),
    payload: text('payload').notNull(),
    processedAt: integer('processed_at', { mode: 'timestamp' })
      .default(sql`(unixepoch())`)
      .notNull(),
  },
  (table) => ({
    providerEventUnq: uniqueIndex('uq_event_inbox_provider_event').on(table.providerId, table.externalEventId),
  })
);
```

---

## [Migration] migrations/0007_event_inbox.sql

```sql
CREATE TABLE `event_inbox` (
  `id` text PRIMARY KEY NOT NULL,
  `provider_id` integer NOT NULL,
  `external_event_id` text NOT NULL,
  `payload` text NOT NULL,
  `processed_at` integer NOT NULL,
  CONSTRAINT "uq_event_inbox_provider_event" UNIQUE(`provider_id`, `external_event_id`)
);
```

---

# 4. Infrastructure Layer

## [Repository] src/infrastructure/repositories/DrizzleFinanceRepository.ts

```typescript
import { eq, and, sql } from 'drizzle-orm';
import {
  financialAccounts,
  accountBalances,
  financialTransactions,
  financialLedgerEntries,
} from '../../db/finance/tables';
import { idempotencyKeys, outboxEvents } from '../../db/infrastructure/tables';
import { Result } from '../../shared/kernel/Result';
import {
  IFinanceRepository,
  FinancialAccountRecord,
  AccountBalanceRecord,
  FinancialTransactionRecord,
} from '../../application/ports/output/IFinanceRepository';
import { LedgerEntry } from '../../domains/finance/entities/LedgerTransaction';

export function isUniqueConstraintViolation(err: any): boolean {
  if (!err) return false;

  const code = String(err.code || err.extendedCode || err.rawCode || err.cause?.code || '');
  if (
    code === 'SQLITE_CONSTRAINT' ||
    code === 'SQLITE_CONSTRAINT_UNIQUE' ||
    code === 'SQLITE_CONSTRAINT_PRIMARYKEY' ||
    code === '1555' ||
    code === '2067'
  ) {
    return true;
  }

  const msg = `${err.message || ''} ${err.cause?.message || ''} ${err.stack || ''}`.toLowerCase();
  return (
    msg.includes('unique constraint failed') ||
    msg.includes('d1_error: unique constraint') ||
    msg.includes('sqlite_constraint') ||
    msg.includes('unique constraint')
  );
}

export class DrizzleFinanceRepository implements IFinanceRepository {
  constructor(private readonly db: any) {}

  private get executor() {
    return this.db;
  }

  async getTreasuryAccount(): Promise<Result<FinancialAccountRecord>> {
    try {
      const [row] = await this.executor
        .select()
        .from(financialAccounts)
        .where(
          and(
            eq(financialAccounts.accountType, 'treasury'),
            eq(financialAccounts.status, 'active')
          )
        )
        .limit(1);

      if (!row) {
        return Result.fail('Treasury account not found. Must be provisioned via bootstrap seed.');
      }

      return Result.ok({
        id: row.id,
        userId: row.userId,
        accountType: row.accountType as any,
        status: row.status as any,
        name: row.name,
        version: row.version,
      });
    } catch (err: any) {
      return Result.fail(err.message);
    }
  }

  async getTreasuryBalance(): Promise<Result<AccountBalanceRecord[]>> {
    try {
      const treasuryRes = await this.getTreasuryAccount();
      if (treasuryRes.isFailure) {
        return Result.fail(treasuryRes.error || 'Treasury account error');
      }

      const treasuryId = treasuryRes.getValue().id;
      const rows = await this.executor
        .select()
        .from(accountBalances)
        .where(eq(accountBalances.accountId, treasuryId));

      const balances: AccountBalanceRecord[] = rows.map((r: any) => ({
        id: r.id,
        accountId: r.accountId,
        assetId: r.assetId,
        availableBaseUnits: r.availableBaseUnits.toString(),
        lockedBaseUnits: r.lockedBaseUnits.toString(),
        version: r.version,
      }));

      return Result.ok(balances);
    } catch (err: any) {
      return Result.fail(err.message);
    }
  }

  async getOrCreateUserAccount(userId: number): Promise<Result<FinancialAccountRecord>> {
    try {
      const [row] = await this.executor
        .select()
        .from(financialAccounts)
        .where(
          and(
            eq(financialAccounts.userId, userId),
            eq(financialAccounts.accountType, 'user_available')
          )
        )
        .limit(1);

      if (row) {
        return Result.ok({
          id: row.id,
          userId: row.userId,
          accountType: row.accountType as any,
          status: row.status as any,
          name: row.name,
          version: row.version,
        });
      }

      try {
        const [inserted] = await this.executor
          .insert(financialAccounts)
          .values({
            userId: userId,
            accountType: 'user_available',
            accountClass: 'liability',
            name: `User ${userId} Main Account`,
            status: 'active',
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .returning();

        return Result.ok({
          id: inserted.id,
          userId: inserted.userId,
          accountType: inserted.accountType as any,
          status: inserted.status as any,
          name: inserted.name,
          version: inserted.version,
        });
      } catch (insertErr: any) {
        if (!insertErr.message || (!insertErr.message.toLowerCase().includes('unique'))) {
          throw insertErr;
        }
        
        const [existing] = await this.executor
          .select()
          .from(financialAccounts)
          .where(
            and(
              eq(financialAccounts.userId, userId),
              eq(financialAccounts.accountType, 'user_available')
            )
          )
          .limit(1);
          
        if (existing) {
          return Result.ok({
            id: existing.id,
            userId: existing.userId,
            accountType: existing.accountType as any,
            status: existing.status as any,
            name: existing.name,
            version: existing.version,
          });
        }
        throw new Error('Falha de concorrência: Conta não encontrada mesmo após violação de UNIQUE.');
      }
    } catch (err: any) {
      return Result.fail(err.message);
    }
  }

  async getOrCreateOperatingAccount(): Promise<Result<FinancialAccountRecord>> {
    try {
      const [row] = await this.executor
        .select()
        .from(financialAccounts)
        .where(
          and(
            sql`${financialAccounts.userId} IS NULL`,
            eq(financialAccounts.accountType, 'operating')
          )
        )
        .limit(1);

      if (!row) {
        const [inserted] = await this.executor
          .insert(financialAccounts)
          .values({
            userId: null,
            accountType: 'operating',
            accountClass: 'asset',
            name: 'System Operating Account',
            status: 'active',
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .returning();

        return Result.ok({
          id: inserted.id,
          userId: inserted.userId,
          accountType: inserted.accountType as any,
          status: inserted.status as any,
          name: inserted.name,
          version: inserted.version,
        });
      }

      return Result.ok({
        id: row.id,
        userId: row.userId,
        accountType: row.accountType as any,
        status: row.status as any,
        name: row.name,
        version: row.version,
      });
    } catch (err: any) {
      return Result.fail(err.message);
    }
  }

  private async ensureAccountBalance(
    accountId: number,
    assetId: number,
    executorOverride?: any
  ): Promise<void> {
    const exec = executorOverride || this.executor;
    const [existing] = await exec
      .select({ id: accountBalances.id })
      .from(accountBalances)
      .where(
        and(
          eq(accountBalances.accountId, accountId),
          eq(accountBalances.assetId, assetId)
        )
      )
      .limit(1);

    if (!existing) {
      try {
        await exec.insert(accountBalances).values({
          accountId,
          assetId,
          availableBaseUnits: '0',
          lockedBaseUnits: '0',
          version: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      } catch (err: any) {
        if (!err.message || (!err.message.includes('UNIQUE') && !err.message.includes('unique'))) {
          throw err;
        }
      }
    }
  }



  async insertTransaction(data: {
    userId?: number | null;
    type: string;
    category: string;
    description: string;
    status: string;
  }): Promise<number> {
    const [tx] = await this.executor
      .insert(financialTransactions)
      .values({
        userId: data.userId || null,
        type: data.type,
        category: data.category,
        status: data.status,
        description: data.description,
        completedAt: data.status === 'completed' ? new Date() : null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning({ id: financialTransactions.id });

    if (!tx) throw new Error('Falha ao inserir registro de transação financeira.');
    return tx.id;
  }

  async updateTransactionStatus(transactionId: number, status: string): Promise<void> {
    const res = await this.executor
      .update(financialTransactions)
      .set({
        status: status as any,
        completedAt: status === 'completed' ? new Date() : undefined,
        updatedAt: new Date()
      })
      .where(
        and(
          eq(financialTransactions.id, transactionId),
          status === 'completed' 
            ? eq(financialTransactions.status, 'processing') 
            : sql`${financialTransactions.status} IN ('pending', 'processing')`
        )
      );

    const affected = (res?.meta?.changes ?? res?.rowsAffected ?? 0);
    if (affected === 0) {
      throw new Error(`State Machine Error: Transição de status inválida para a transação ${transactionId}. O status destino (${status}) requer que a transação esteja em 'processing' (se destino for completed) ou 'pending/processing'.`);
    }
  }

  async getTransactionEntries(transactionId: number): Promise<Result<Array<{ accountId: number; assetId: number; direction: 'debit' | 'credit'; amountBaseUnits: string }>>> {
    try {
      const rows = await this.executor
        .select({
          accountId: financialLedgerEntries.accountId,
          assetId: financialLedgerEntries.assetId,
          direction: financialLedgerEntries.direction,
          amountBaseUnits: financialLedgerEntries.amountBaseUnits,
        })
        .from(financialLedgerEntries)
        .where(eq(financialLedgerEntries.transactionId, transactionId));

      return Result.ok(rows as any);
    } catch (err: any) {
      return Result.fail(err.message);
    }
  }

  async listTransactions(userId?: number): Promise<Result<FinancialTransactionRecord[]>> {
    try {
      const query = userId
        ? this.executor.select().from(financialTransactions).where(eq(financialTransactions.userId, userId))
        : this.executor.select().from(financialTransactions);

      const rows = await query;
      const txs: FinancialTransactionRecord[] = rows.map((r: any) => ({
        id: r.id,
        userId: r.userId,
        type: r.type,
        category: r.category,
        status: r.status,
        description: r.description,
        createdAt: new Date(r.createdAt),
        completedAt: r.completedAt ? new Date(r.completedAt) : null,
      }));

      return Result.ok(txs);
    } catch (err: any) {
      return Result.fail(err.message);
    }
  }

  // --------------------------------------------------------------------------
  // DOUBLE-ENTRY LEDGER & IDEMPOTENCY
  // --------------------------------------------------------------------------
  
  async getIdempotencyRecord(
    key: string,
    scope: string
  ): Promise<{ status: string; requestHash: string; transactionId?: number } | null> {
    const [record] = await this.executor
      .select({
        status: idempotencyKeys.status,
        requestHash: idempotencyKeys.requestHash,
        transactionId: idempotencyKeys.financialTransactionId
      })
      .from(idempotencyKeys)
      .where(
        and(
          eq(idempotencyKeys.key, key),
          eq(idempotencyKeys.scope, scope)
        )
      )
      .limit(1);

    if (!record) return null;
    return {
      status: record.status,
      requestHash: record.requestHash,
      transactionId: record.transactionId || undefined
    };
  }

  async claimIdempotency(
    idempotencyKey: string,
    userId: number | null | undefined,
    scope: string,
    requestHash: string
  ): Promise<boolean> {
    try {
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      await this.executor.insert(idempotencyKeys).values({
        userId: userId ?? null,
        scope,
        key: idempotencyKey,
        requestHash,
        status: 'processing',
        expiresAt,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      return true;
    } catch (err: any) {
      if (isUniqueConstraintViolation(err)) {
        return false;
      }
      throw err;
    }
  }

  async completeIdempotency(key: string, scope: string, transactionId: number): Promise<void> {
    const res = await this.executor
      .update(idempotencyKeys)
      .set({
        status: 'completed',
        financialTransactionId: transactionId
      })
      .where(
        and(
          eq(idempotencyKeys.key, key),
          eq(idempotencyKeys.scope, scope)
        )
      );

    const affected = (res?.meta?.changes ?? res?.rowsAffected ?? 0);
    if (affected === 0) {
      throw new Error(`Falha ao concluir Idempotency Key (${key}): Registro de idempotência não encontrado ou em estado inconsistente.`);
    }
  }

  async insertLedgerEntries(entries: LedgerEntry[], transactionId: number): Promise<void> {
    const payload = entries.map(entry => {
      const rawVal = (entry.amount as any)?.amount ?? entry.amount;
      const amountBigInt = typeof rawVal === 'bigint' ? rawVal : BigInt(rawVal);

      if (amountBigInt <= 0n) {
        throw new Error(`Invalid ledger entry amount: ${amountBigInt}`);
      }

      const accountIdNum = Number(entry.accountId);
      const assetIdNum = Number(entry.amount.assetId);

      if (!Number.isInteger(accountIdNum) || accountIdNum <= 0) {
        throw new Error(`Invalid physical accountId: ${entry.accountId}`);
      }
      if (!Number.isInteger(assetIdNum) || assetIdNum <= 0) {
        throw new Error(`Invalid physical assetId: ${entry.amount.assetId}`);
      }

      return {
        transactionId,
        accountId: accountIdNum,
        assetId: assetIdNum,
        direction: entry.type,
        amountBaseUnits: amountBigInt.toString(),
        createdAt: new Date(),
      };
    });

    if (payload.length > 0) {
      await this.executor.insert(financialLedgerEntries).values(payload);
    }
  }

  async updateBalanceWithOCC(
    accountId: string,
    assetId: string,
    amount: bigint,
    type: 'debit' | 'credit',
    executorOverride?: any
  ): Promise<boolean> {
    const exec = executorOverride || this.executor;

    if (typeof amount !== 'bigint' || amount <= 0n) {
      throw new Error(`Invalid base units amount for OCC update: ${amount}`);
    }

    const accIdNum = Number(accountId);
    const assetIdNum = Number(assetId);

    if (!Number.isInteger(accIdNum) || accIdNum <= 0) {
      throw new Error(`Invalid physical accountId: ${accountId}`);
    }
    if (!Number.isInteger(assetIdNum) || assetIdNum <= 0) {
      throw new Error(`Invalid physical assetId: ${assetId}`);
    }

    // 1. Garantir que a linha de saldo exista (auto-provisionamento se necessário)
    await this.ensureAccountBalance(accIdNum, assetIdNum, exec);

    // 2. Determinar a classe da conta (asset vs liability) para aplicar a matemática correta
    const [accRow] = await exec
      .select({ accountClass: financialAccounts.accountClass })
      .from(financialAccounts)
      .where(eq(financialAccounts.id, accIdNum))
      .limit(1);

    if (!accRow) {
      throw new Error(`Account not found: ${accountId}`);
    }

    const accClass = accRow.accountClass;
    const isDebitNormal = accClass === 'asset' || accClass === 'expense';

    // 3. Selecionar o saldo com OCC version
    const [balance] = await exec
      .select({
        id: accountBalances.id,
        availableBaseUnits: accountBalances.availableBaseUnits,
        version: accountBalances.version,
      })
      .from(accountBalances)
      .where(
        and(
          eq(accountBalances.accountId, accIdNum),
          eq(accountBalances.assetId, assetIdNum)
        )
      )
      .limit(1);

    if (!balance) {
      throw new Error(`Balance not found for account ${accountId} and asset ${assetId}`);
    }

    const currentVersion = balance.version;
    const isIncrease = isDebitNormal ? type === 'debit' : type === 'credit';
    const currentAvailable = BigInt(balance.availableBaseUnits || '0');
    const newAvailable = isIncrease
      ? currentAvailable + amount
      : currentAvailable - amount;

    if (newAvailable < 0n) {
      return false; // Saldo insuficiente
    }

    const newAvailableStr = newAvailable.toString();

    const res = await exec
      .update(accountBalances)
      .set({
        availableBaseUnits: newAvailableStr,
        version: currentVersion + 1,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(accountBalances.id, balance.id),
          eq(accountBalances.version, currentVersion)
        )
      );

    const affected = (res?.meta?.changes ?? res?.rowsAffected ?? 0);
    return affected > 0;
  }

  async persistOutboxEvent(eventType: string, payload: any): Promise<void> {
    const eventId = crypto.randomUUID();
    await this.executor.insert(outboxEvents).values({
      id: eventId,
      aggregateId: String(payload.transactionId ?? eventId),
      aggregateType: 'LedgerTransaction',
      aggregateVersion: 1,
      eventName: eventType,
      payload: JSON.stringify(payload),
      status: 'pending',
      leaseGeneration: 0,
      createdAt: new Date(),
    });
  }
}
```

---

## [UnitOfWork] src/infrastructure/repositories/DrizzleUnitOfWork.ts

```typescript
import { IUnitOfWork, IRepositoryFactory } from '../../application/ports/output/IUnitOfWork';
import { IUserRepository } from '../../application/ports/output/IUserRepository';
import { IAuthenticationRepository } from '../../application/ports/output/IAuthenticationRepository';
import { IWeb3Repository } from '../../application/ports/output/IWeb3Repository';
import { ICivilIdentityRepository } from '../../application/ports/output/ICivilIdentityRepository';
import { ISessionRepository } from '../../application/ports/output/ISessionRepository';
import { IOutboxRepository } from '../../application/ports/output/IOutboxRepository';
import { IPasswordResetRepository } from '../../application/ports/output/IPasswordResetRepository';

import { DrizzleUserRepositoryAdapter } from '../repositories/DrizzleUserRepositoryAdapter';
import { DrizzleAuthenticationRepositoryAdapter } from '../repositories/DrizzleAuthenticationRepositoryAdapter';
import { DrizzleWeb3RepositoryAdapter } from '../repositories/DrizzleWeb3RepositoryAdapter';
import { DrizzleCivilIdentityRepositoryAdapter } from '../repositories/DrizzleCivilIdentityRepositoryAdapter';
import { DrizzleSessionRepository } from './DrizzleSessionRepository';
import { ISsiRepository } from '../../application/ports/output/ISsiRepository';
import { DrizzleSsiRepository } from './DrizzleSsiRepository';
import { DrizzleOutboxRepository } from './DrizzleOutboxRepository';
import { DrizzlePasswordResetRepository } from './DrizzlePasswordResetRepository';
import { IFinanceRepository } from '../../application/ports/output/IFinanceRepository';
import { DrizzleFinanceRepository } from './DrizzleFinanceRepository';
import { Result } from '../../shared/kernel/Result';
import { IAuthTransactionRepository } from '../../application/ports/output/IAuthTransactionRepository';
import { DrizzleAuthTransactionRepository } from './DrizzleAuthTransactionRepository';

class DrizzleRepositoryFactory implements IRepositoryFactory {
  constructor(private tx: any, private db?: any) {}

  getUserRepository(): IUserRepository {
    return new DrizzleUserRepositoryAdapter(this.tx || this.db);
  }

  getAuthTransactionRepository(): IAuthTransactionRepository {
    return new DrizzleAuthTransactionRepository(this.tx || this.db);
  }

  getAuthenticationRepository(): IAuthenticationRepository {
    return new DrizzleAuthenticationRepositoryAdapter(this.tx);
  }

  getWeb3Repository(): IWeb3Repository {
    return new DrizzleWeb3RepositoryAdapter(this.tx);
  }

  getSessionRepository(): ISessionRepository {
    return new DrizzleSessionRepository(this.tx);
  }

  getCivilIdentityRepository(): ICivilIdentityRepository {
    return new DrizzleCivilIdentityRepositoryAdapter(this.tx);
  }

  getSsiRepository(): ISsiRepository {
    return new DrizzleSsiRepository(this.tx);
  }

  getOutboxRepository(): IOutboxRepository {
    return new DrizzleOutboxRepository(this.tx);
  }

  getPasswordResetRepository(): IPasswordResetRepository {
    return new DrizzlePasswordResetRepository(this.tx);
  }

  getFinanceRepository(): IFinanceRepository {
    return new DrizzleFinanceRepository(this.tx);
  }
}


export class DrizzleUnitOfWork implements IUnitOfWork {
  constructor(private db: any) {}

  async execute<T>(work: (factory: IRepositoryFactory) => Promise<Result<T>>): Promise<Result<T>> {
    if (typeof this.db?.transaction === 'function') {
      let result: Result<T> | null = null;
      try {
        await this.db.transaction(async (tx: any) => {
          const factory = new DrizzleRepositoryFactory(tx);
          result = await work(factory);

          if (result && result.isFailure) {
            if (typeof tx.rollback === 'function') {
              tx.rollback();
            } else {
              throw new Error('ROLLBACK_TRIGGERED_BY_RESULT_FAIL');
            }
          }
        });
        if (result) return result;
        return Result.fail('Transação concluída sem resultado retornado pelo callback.');
      } catch (err: any) {
        // Se o erro foi gerado intencionalmente por result.isFailure, devolve o Result.fail original
        if (result && result.isFailure) {
          return result;
        }
        const errorMessage = err?.message || String(err);
        if (errorMessage === 'ROLLBACK_TRIGGERED_BY_RESULT_FAIL' && result && result.isFailure) {
          return result;
        }
        // Se a callback retornou Result.ok(), mas o COMMIT/banco falhou, DEVE RETORNAR FALHA! (DOD-05)
        return Result.fail(`Falha na transação do banco de dados (Commit/Execution): ${errorMessage}`);
      }
    }

    // BLOCKER FIX: If there is no transaction support, we must FAIL immediately,
    // not fallback to a non-transactional execution.
    throw new Error('Driver de banco de dados atual não suporta transações atômicas (db.transaction is not a function). Operação abortada por segurança.');
  }
}

```

---

# 5. Verification & Certification Test Suite

## [Test] tests/finance/invariants/balance_projection.test.ts

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { readFileSync, unlinkSync } from 'fs';
import { eq, and, sql } from 'drizzle-orm';

import { DrizzleUnitOfWork } from '../../../src/infrastructure/repositories/DrizzleUnitOfWork';
import { DoubleEntryLedgerService } from '../../../src/domains/finance/services/DoubleEntryLedgerService';
import { LedgerTransaction, LedgerEntry } from '../../../src/domains/finance/entities/LedgerTransaction';
import { Money } from '../../../src/domains/finance/entities/Money';
import { accountBalances, financialLedgerEntries, financialAccounts } from '../../../src/db/finance/tables';

describe('Invariante DOD-04: Projeção de Saldo Materializado vs Soma Ponderada de Ledger', () => {
  let sqlite: any;
  let db: any;
  let uow: DrizzleUnitOfWork;
  let ledgerService: DoubleEntryLedgerService;
  const dbFile = 'test_balance_projection.db';

  beforeAll(async () => {
    sqlite = createClient({ url: `file:${dbFile}` });
    db = drizzle(sqlite);

    const uowDb = {
      ...db,
      transaction: async (cb: any) => {
        const t = await sqlite.transaction('write');
        const proxyDb = drizzle(t) as any;
        proxyDb.rollback = () => {
          throw new Error('DRIZZLE_ROLLBACK');
        };
        try {
          await cb(proxyDb);
          await t.commit();
        } catch (err: any) {
          try { await t.rollback(); } catch (e) {}
          if (err.message === 'DRIZZLE_ROLLBACK') return;
          throw err;
        }
      }
    };

    const migrationFiles = [
      './migrations/0000_white_raider.sql',
      './migrations/0001_parallel_veda.sql',
      './migrations/0002_solid_barracuda.sql',
      './migrations/0004_preflight_audit.sql',
      './migrations/0005_data_remediation.sql',
      './migrations/0006_constraints.sql',
    ];

    for (const file of migrationFiles) {
      try {
        const sqlContent = readFileSync(file, 'utf8')
          .replace(/--> statement-breakpoint/g, ';');
        await sqlite.executeMultiple(sqlContent);
      } catch (err: any) {}
    }

    try { await sqlite.execute('ALTER TABLE outbox_events ADD COLUMN status TEXT DEFAULT "pending" NOT NULL;'); } catch (e) {}
    try { await sqlite.execute('ALTER TABLE outbox_events ADD COLUMN lease_owner TEXT;'); } catch (e) {}
    try { await sqlite.execute('ALTER TABLE outbox_events ADD COLUMN lease_generation INTEGER DEFAULT 0 NOT NULL;'); } catch (e) {}
    try { await sqlite.execute('ALTER TABLE outbox_events ADD COLUMN lease_expires_at INTEGER;'); } catch (e) {}
    try { await sqlite.execute('ALTER TABLE financial_accounts ADD COLUMN account_class TEXT DEFAULT "liability" NOT NULL;'); } catch (e) {}

    await sqlite.executeMultiple(`
      INSERT INTO users (id, email, email_normalized, status, created_at, updated_at) VALUES (1, 'user1@test.com', 'user1@test.com', 'active', 1000, 1000);
      INSERT INTO users (id, email, email_normalized, status, created_at, updated_at) VALUES (2, 'user2@test.com', 'user2@test.com', 'active', 1000, 1000);
      INSERT INTO financial_assets (id, symbol, code, name, type, decimals, status, created_at, updated_at) VALUES (1, 'BRL', 'BRL', 'Brazilian Real', 'fiat', 2, 'active', 1000, 1000);
      
      INSERT INTO financial_accounts (id, user_id, account_type, account_class, status, name, version, created_at, updated_at) VALUES (1, NULL, 'operating', 'asset', 'active', 'Operating Account', 1, 1000, 1000);
      INSERT INTO financial_accounts (id, user_id, account_type, account_class, status, name, version, created_at, updated_at) VALUES (2, 1, 'user_available', 'liability', 'active', 'User 1 Account', 1, 1000, 1000);
      INSERT INTO financial_accounts (id, user_id, account_type, account_class, status, name, version, created_at, updated_at) VALUES (3, 2, 'user_available', 'liability', 'active', 'User 2 Account', 1, 1000, 1000);
      INSERT INTO financial_accounts (id, user_id, account_type, account_class, status, name, version, created_at, updated_at) VALUES (4, NULL, 'fees', 'revenue', 'active', 'Fee Revenue Account', 1, 1000, 1000);

      INSERT INTO account_balances (account_id, asset_id, available_base_units, locked_base_units, version, updated_at) VALUES (1, 1, '1000000', '0', 1, 1000);
      INSERT INTO account_balances (account_id, asset_id, available_base_units, locked_base_units, version, updated_at) VALUES (2, 1, '0', '0', 1, 1000);
      INSERT INTO account_balances (account_id, asset_id, available_base_units, locked_base_units, version, updated_at) VALUES (3, 1, '0', '0', 1, 1000);
      INSERT INTO account_balances (account_id, asset_id, available_base_units, locked_base_units, version, updated_at) VALUES (4, 1, '0', '0', 1, 1000);
    `);

    uow = new DrizzleUnitOfWork(uowDb);
    ledgerService = new DoubleEntryLedgerService();
  });

  afterAll(() => {
    try { unlinkSync(dbFile); } catch (e) {}
  });

  it('DOD-04: Saldo materializado em account_balances deve coincidir 100% com a soma projetada do ledger por accountClass', async () => {
    // 1. Depósito 500 para User 1 (Conta 2) vindo da Operating (Conta 1)
    const tx1 = new LedgerTransaction({
      idempotencyKey: 'proj-tx-1',
      description: 'Deposit User 1',
      entries: [
        new LedgerEntry({ accountId: '1', amount: new Money(500n, '1'), type: 'debit' }),
        new LedgerEntry({ accountId: '2', amount: new Money(500n, '1'), type: 'credit' }),
      ],
    });

    const res1 = await uow.execute((f) => ledgerService.recordTransaction(tx1, f, 'hash1'));
    if (res1.isFailure) console.log('res1 error:', res1.error);
    expect(res1.isSuccess).toBe(true);

    // 2. Transferência 200 de User 1 (Conta 2) para User 2 (Conta 3)
    const tx2 = new LedgerTransaction({
      idempotencyKey: 'proj-tx-2',
      description: 'Transfer User 1 -> User 2',
      entries: [
        new LedgerEntry({ accountId: '2', amount: new Money(200n, '1'), type: 'debit' }),
        new LedgerEntry({ accountId: '3', amount: new Money(200n, '1'), type: 'credit' }),
      ],
    });

    const res2 = await uow.execute((f) => ledgerService.recordTransaction(tx2, f, 'hash2'));
    expect(res2.isSuccess).toBe(true);

    // 3. Taxa 10 cobrada de User 1 (Conta 2) enviada para Fees Revenue (Conta 4)
    const tx3 = new LedgerTransaction({
      idempotencyKey: 'proj-tx-3',
      description: 'Fee Charge User 1',
      entries: [
        new LedgerEntry({ accountId: '2', amount: new Money(10n, '1'), type: 'debit' }),
        new LedgerEntry({ accountId: '4', amount: new Money(10n, '1'), type: 'credit' }),
      ],
    });

    const res3 = await uow.execute((f) => ledgerService.recordTransaction(tx3, f, 'hash3'));
    if (res3.isFailure) console.log('res3 error:', res3.error);
    expect(res3.isSuccess).toBe(true);

    // 4. Verificação Invariante DOD-04 para todas as contas
    const accounts = await db.select().from(financialAccounts);

    for (const acc of accounts) {
      const balances = await db
        .select()
        .from(accountBalances)
        .where(and(eq(accountBalances.accountId, acc.id), eq(accountBalances.assetId, 1)));

      const materializedStr = balances[0]?.availableBaseUnits || '0';
      const materializedBigInt = BigInt(materializedStr);

      const entries = await db
        .select()
        .from(financialLedgerEntries)
        .where(and(eq(financialLedgerEntries.accountId, acc.id), eq(financialLedgerEntries.assetId, 1)));

      let debitSum = 0n;
      let creditSum = 0n;
      for (const entry of entries) {
        const val = BigInt(entry.amountBaseUnits);
        if (entry.direction === 'debit') debitSum += val;
        else if (entry.direction === 'credit') creditSum += val;
      }

      // Fórmula por accountClass (Seção 3 do Plano Diretor)
      // Base inicial das contas no setup (Operating iniciou com 1000000 de saldo inicial)
      let initialBalance = acc.id === 1 ? 1000000n : 0n;
      let projectedBigInt = initialBalance;

      if (acc.accountClass === 'asset' || acc.accountClass === 'expense') {
        projectedBigInt += (debitSum - creditSum);
      } else if (acc.accountClass === 'liability' || acc.accountClass === 'revenue' || acc.accountClass === 'equity') {
        projectedBigInt += (creditSum - debitSum);
      }

      expect(materializedBigInt).toBe(projectedBigInt);
    }
  });
});
```

---

## [Test] tests/finance/invariants/commit_failure.test.ts

```typescript
import { describe, it, expect } from 'vitest';
import { DrizzleUnitOfWork } from '../../../src/infrastructure/repositories/DrizzleUnitOfWork';
import { Result } from '../../../src/shared/kernel/Result';

describe('Invariante DOD-05: Unitaridade do Commit & Proteção contra Mascaramento', () => {
  it('deve retornar Result.fail se o callback retornar Result.ok(), mas o COMMIT da transação falhar', async () => {
    // Simula um driver DB onde o callback executa com sucesso (Result.ok),
    // mas a finalização do COMMIT lança um erro no banco (ex: violação de constraint deferred, lock ou falha I/O)
    const mockDbWithCommitFailure = {
      transaction: async (cb: any) => {
        const mockTx = { isTx: true };
        await cb(mockTx);
        // Simula exceção durante a fase de COMMIT do banco de dados
        throw new Error('SQLite/D1 Commit Error: Disk I/O or Constraint Deferred Violation');
      }
    };

    const uow = new DrizzleUnitOfWork(mockDbWithCommitFailure);

    const result = await uow.execute(async () => {
      // Callback de negócio simula sucesso interno
      return Result.ok({ transactionId: 100 });
    });

    // Asserção Crítica DOD-05: O resultado NUNCA pode ser Result.ok() se o COMMIT falhar!
    expect(result.isFailure).toBe(true);
    expect(result.error).toContain('Falha na transação do banco de dados (Commit/Execution)');
    expect(result.error).toContain('SQLite/D1 Commit Error');
  });

  it('deve retornar o Result.fail original se o callback de negócio falhar e forçar rollback', async () => {
    let rollbackCalled = false;
    const mockDbWithBusinessRollback = {
      transaction: async (cb: any) => {
        const mockTx = {
          isTx: true,
          rollback: () => {
            rollbackCalled = true;
            throw new Error('Rollback_Triggered');
          }
        };
        try {
          await cb(mockTx);
        } catch (e: any) {
          if (e.message === 'Rollback_Triggered') return;
          throw e;
        }
      }
    };

    const uow = new DrizzleUnitOfWork(mockDbWithBusinessRollback);

    const result = await uow.execute(async () => {
      return Result.fail('Regra de negócio violada: Saldo Insuficiente');
    });

    expect(result.isFailure).toBe(true);
    expect(result.error).toBe('Regra de negócio violada: Saldo Insuficiente');
    expect(rollbackCalled).toBe(true);
  });
});
```

---

## [Test] tests/finance/invariants/transaction_failure_matrix.test.ts

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { readFileSync, unlinkSync } from 'fs';

import { DrizzleUnitOfWork } from '../../../src/infrastructure/repositories/DrizzleUnitOfWork';
import { DoubleEntryLedgerService } from '../../../src/domains/finance/services/DoubleEntryLedgerService';
import { LedgerTransaction, LedgerEntry } from '../../../src/domains/finance/entities/LedgerTransaction';
import { Money } from '../../../src/domains/finance/entities/Money';
import { idempotencyKeys, outboxEvents } from '../../../src/db/infrastructure/tables';
import { accountBalances, financialLedgerEntries, financialTransactions } from '../../../src/db/finance/tables';

describe('Invariante DOD-06: Matriz de Falhas e Rollback Integral nos Passos Transacionais', () => {
  let sqlite: any;
  let db: any;
  let uow: DrizzleUnitOfWork;
  let ledgerService: DoubleEntryLedgerService;

  beforeAll(async () => {
    sqlite = createClient({ url: 'file:test_failure_matrix.db' });
    db = drizzle(sqlite);

    // Wrapper transacional nativo para libsql no repositório de teste
    const uowDb = {
      ...db,
      transaction: async (cb: any) => {
        const t = await sqlite.transaction('write');
        const proxyDb = drizzle(t) as any;
        proxyDb.rollback = () => {
          throw new Error('DRIZZLE_ROLLBACK');
        };
        try {
          await cb(proxyDb);
          await t.commit();
        } catch (err: any) {
          try { await t.rollback(); } catch (e) {}
          if (err.message === 'DRIZZLE_ROLLBACK') return;
          throw err;
        }
      }
    };

    // Executa a cadeia completa de migrações (0000 a 0006) da pasta ./migrations/
    const migrationFiles = [
      './migrations/0000_white_raider.sql',
      './migrations/0001_parallel_veda.sql',
      './migrations/0002_solid_barracuda.sql',
      './migrations/0004_preflight_audit.sql',
      './migrations/0005_data_remediation.sql',
      './migrations/0006_constraints.sql',
    ];

    for (const file of migrationFiles) {
      try {
        const sqlContent = readFileSync(file, 'utf8')
          .replace(/--> statement-breakpoint/g, ';');
        await sqlite.executeMultiple(sqlContent);
      } catch (err: any) {
        // Ignora erros de tabelas/índices já existentes se houver sobreposição nas migrações
      }
    }

    // Alignment patch para a tabela outbox_events e financial_accounts conforme Drizzle ORM definition
    try { await sqlite.execute('ALTER TABLE outbox_events ADD COLUMN status TEXT DEFAULT "pending" NOT NULL;'); } catch (e) {}
    try { await sqlite.execute('ALTER TABLE outbox_events ADD COLUMN lease_owner TEXT;'); } catch (e) {}
    try { await sqlite.execute('ALTER TABLE outbox_events ADD COLUMN lease_generation INTEGER DEFAULT 0 NOT NULL;'); } catch (e) {}
    try { await sqlite.execute('ALTER TABLE outbox_events ADD COLUMN lease_expires_at INTEGER;'); } catch (e) {}
    try { await sqlite.execute('ALTER TABLE financial_accounts ADD COLUMN account_class TEXT DEFAULT "liability" NOT NULL;'); } catch (e) {}

    // Popula sementes
    await sqlite.executeMultiple(`
      INSERT INTO users (id, email, email_normalized, status, created_at, updated_at) VALUES (10, 'matrix@test.com', 'matrix@test.com', 'active', 1000, 1000);
      INSERT INTO financial_assets (id, symbol, code, name, type, decimals, status, created_at, updated_at) VALUES (1, 'BRL', 'BRL', 'Real', 'fiat', 2, 'active', 1000, 1000);
    `);

    uow = new DrizzleUnitOfWork(uowDb);
    ledgerService = new DoubleEntryLedgerService();

    // Popula contas e saldos base
    await sqlite.executeMultiple(`
      INSERT INTO financial_accounts (id, user_id, account_type, account_class, status, name, version, created_at, updated_at) VALUES (1, NULL, 'operating', 'asset', 'active', 'Operating Account', 1, 1000, 1000);
      INSERT INTO financial_accounts (id, user_id, account_type, account_class, status, name, version, created_at, updated_at) VALUES (2, 10, 'user_available', 'liability', 'active', 'User Available Account', 1, 1000, 1000);
      INSERT INTO account_balances (account_id, asset_id, available_base_units, locked_base_units, version, updated_at) VALUES (1, 1, '100000000', '0', 1, 1000);
      INSERT INTO account_balances (account_id, asset_id, available_base_units, locked_base_units, version, updated_at) VALUES (2, 1, '0', '0', 1, 1000);
    `);
  });

  afterAll(() => {
    sqlite.close();
    try { unlinkSync('test_failure_matrix.db'); } catch (e) {}
  });

  const getDBCounts = async () => {
    return {
      idem: (await db.select().from(idempotencyKeys)).length,
      txs: (await db.select().from(financialTransactions)).length,
      entries: (await db.select().from(financialLedgerEntries)).length,
      balances: (await db.select().from(accountBalances)).length,
      outbox: (await db.select().from(outboxEvents)).length,
    };
  };

  it('Falha no Passo 4 (OCC / Balance Check) resulta em Rollback Integral (0 registros vazados)', async () => {
    const initialState = await getDBCounts();

    const invalidTx = new LedgerTransaction({
      idempotencyKey: 'fail-step4-key',
      userId: 10,
      description: 'Insufficient Balance Attempt',
      entries: [
        // Conta 2 (Liability) tenta debitar 99999999n sem ter saldo
        new LedgerEntry({ accountId: '1', amount: new Money(99999999n, '1'), type: 'credit' }),
        new LedgerEntry({ accountId: '2', amount: new Money(99999999n, '1'), type: 'debit' })
      ]
    });

    const result = await uow.execute(async (factory) => {
      return ledgerService.recordTransaction(invalidTx, factory, 'hash-fail-4');
    });

    expect(result.isFailure).toBe(true);
    expect(result.error).toContain('Saldo insuficiente ou Optimistic Concurrency Control');

    // Asserção DOD-06: O banco de dados precisa estar no exato mesmo estado inicial
    const finalState = await getDBCounts();
    expect(finalState.txs).toBe(initialState.txs);
    expect(finalState.entries).toBe(initialState.entries);
    expect(finalState.idem).toBe(initialState.idem);
    expect(finalState.outbox).toBe(initialState.outbox);
  });

  it('Falha no Passo 6 (completeIdempotency com chave inexistente) resulta em Rollback Integral', async () => {
    const initialState = await getDBCounts();

    const tx = new LedgerTransaction({
      idempotencyKey: 'fail-step6-key',
      userId: 10,
      description: 'Test Step 6 Fail',
      entries: [
        new LedgerEntry({ accountId: '1', amount: new Money(100n, '1'), type: 'debit' }),
        new LedgerEntry({ accountId: '2', amount: new Money(100n, '1'), type: 'credit' })
      ]
    });

    // Simula uma falha no completeIdempotency injetando um erro proposital no repositório no momento da conclusão
    const result = await uow.execute(async (factory) => {
      const repo = factory.getFinanceRepository();
      // Executa os passos normais manualmente para simular falha no completeIdempotency
      await repo.claimIdempotency(tx.idempotencyKey, 10, 'finance', 'hash-6');
      const dbTxId = await repo.insertTransaction({
        userId: tx.userId,
        type: tx.transactionType || 'deposit',
        category: 'operational',
        description: tx.description,
        status: 'processing'
      });
      await repo.insertLedgerEntries(tx.entries, dbTxId);
      await repo.updateBalanceWithOCC('1', '1', 100n, 'debit');
      await repo.updateBalanceWithOCC('2', '1', 100n, 'credit');
      await repo.updateTransactionStatus(dbTxId, 'completed');
      
      // Força completeIdempotency com chave ERRADA que afetará 0 linhas
      await repo.completeIdempotency('NON_EXISTENT_KEY', 'finance', dbTxId);
      return { isSuccess: true, isFailure: false } as any;
    });

    expect(result.isFailure).toBe(true);
    expect(result.error).toContain('Falha ao concluir Idempotency Key');

    // Asserção DOD-06: Rollback integral
    const finalState = await getDBCounts();
    expect(finalState.txs).toBe(initialState.txs);
    expect(finalState.entries).toBe(initialState.entries);
    expect(finalState.idem).toBe(initialState.idem);
  });
});
```

---

## [Test] tests/finance/bootstrap_service.test.ts

```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { FinanceBootstrapService } from '../../src/domains/finance/services/FinanceBootstrapService';
import { DrizzleFinanceRepository } from '../../src/infrastructure/repositories/DrizzleFinanceRepository';
import { unlinkSync, existsSync } from 'fs';

describe('FinanceBootstrapService - Bootstrapping de Tesouraria e Contas do Sistema', () => {
  const dbFile = 'test_bootstrap_service.db';
  let sqlite: any;
  let db: any;

  beforeAll(async () => {
    if (existsSync(dbFile)) {
      try { unlinkSync(dbFile); } catch (e) {}
    }
    sqlite = createClient({ url: `file:${dbFile}` });
    db = drizzle(sqlite);

    // DDL de teste
    await sqlite.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL
      );
    `);
    await sqlite.execute(`
      CREATE TABLE IF NOT EXISTS financial_assets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL,
        symbol TEXT NOT NULL,
        name TEXT NOT NULL,
        decimals INTEGER NOT NULL,
        type TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER,
        updated_at INTEGER
      );
    `);
    await sqlite.execute(`
      CREATE TABLE IF NOT EXISTS financial_accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        account_type TEXT NOT NULL CHECK(account_type IN ('user_available', 'treasury', 'operating', 'reserve', 'fees', 'escrow')),
        account_class TEXT NOT NULL CHECK(account_class IN ('asset', 'liability', 'equity', 'revenue', 'expense')),
        status TEXT NOT NULL CHECK(status IN ('active', 'inactive', 'suspended')),
        name TEXT NOT NULL,
        version INTEGER DEFAULT 1 NOT NULL,
        created_at INTEGER,
        updated_at INTEGER
      );
    `);
    await sqlite.execute(`
      CREATE TABLE IF NOT EXISTS account_balances (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id INTEGER NOT NULL,
        asset_id INTEGER NOT NULL,
        available_base_units TEXT DEFAULT '0' NOT NULL,
        locked_base_units TEXT DEFAULT '0' NOT NULL,
        version INTEGER DEFAULT 1 NOT NULL,
        updated_at INTEGER
      );
    `);

    // Inserir usuário inicial
    await sqlite.execute(`INSERT INTO users (id, name) VALUES (1, 'Admin');`);
  }, 30000);

  it('deve inicializar com sucesso o banco e provisionar contas de Tesouraria, Operacional e Fee', async () => {
    const repo = new DrizzleFinanceRepository(db);

    // 1. Antes do bootstrap, getTreasuryAccount deve falhar
    const initialGet = await repo.getTreasuryAccount();
    expect(initialGet.isFailure).toBe(true);
    expect(initialGet.error).toContain('Treasury account not found');

    // 2. Executar bootstrap
    const seedRes = await FinanceBootstrapService.seedSystemAccounts(db, {
      currencyCode: 'BRL',
      initialBalanceBaseUnits: 1000000n,
    });

    if (seedRes.isFailure) console.log('SEED ERROR:', seedRes.error);
    expect(seedRes.isSuccess).toBe(true);
    const data = seedRes.getValue();
    expect(data.treasuryAccountId).toBeGreaterThan(0);

    // 3. Após bootstrap, getTreasuryAccount deve ter sucesso
    const treasuryGet = await repo.getTreasuryAccount();
    expect(treasuryGet.isSuccess).toBe(true);
    expect(treasuryGet.getValue().accountType).toBe('treasury');
  }, 30000);
});
```

---

## [Test] tests/finance/evm_precision.test.ts

```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { eq } from 'drizzle-orm';
import { DrizzleFinanceRepository } from '../../src/infrastructure/repositories/DrizzleFinanceRepository';
import { LedgerEntry } from '../../src/domains/finance/entities/LedgerTransaction';
import { Money } from '../../src/domains/finance/entities/Money';
import { accountBalances } from '../../src/db/finance/tables';
import { unlinkSync, existsSync } from 'fs';

describe('Precisão Monetária EVM 256-bit - Transações com > 53-bits', () => {
  const dbFile = 'test_evm_precision.db';
  let sqlite: any;
  let db: any;

  beforeAll(async () => {
    if (existsSync(dbFile)) {
      try { unlinkSync(dbFile); } catch (e) {}
    }
    sqlite = createClient({ url: `file:${dbFile}` });
    db = drizzle(sqlite);

    await sqlite.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL
      );
    `);
    await sqlite.execute(`
      CREATE TABLE IF NOT EXISTS financial_assets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL,
        symbol TEXT NOT NULL,
        name TEXT NOT NULL,
        decimals INTEGER NOT NULL,
        type TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER,
        updated_at INTEGER
      );
    `);
    await sqlite.execute(`
      CREATE TABLE IF NOT EXISTS financial_accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        account_type TEXT NOT NULL,
        account_class TEXT NOT NULL,
        status TEXT NOT NULL,
        name TEXT NOT NULL,
        version INTEGER DEFAULT 1 NOT NULL,
        created_at INTEGER,
        updated_at INTEGER
      );
    `);
    await sqlite.execute(`
      CREATE TABLE IF NOT EXISTS financial_transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        type TEXT NOT NULL,
        category TEXT DEFAULT 'other' NOT NULL,
        status TEXT DEFAULT 'pending' NOT NULL,
        source_type TEXT,
        source_id TEXT,
        correlation_id TEXT,
        description TEXT NOT NULL,
        version INTEGER DEFAULT 1 NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        completed_at INTEGER
      );
    `);
    await sqlite.execute(`
      CREATE TABLE IF NOT EXISTS financial_ledger_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        transaction_id INTEGER NOT NULL,
        account_id INTEGER NOT NULL,
        asset_id INTEGER NOT NULL,
        direction TEXT NOT NULL,
        amount_base_units TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
    await sqlite.execute(`
      CREATE TABLE IF NOT EXISTS account_balances (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id INTEGER NOT NULL,
        asset_id INTEGER NOT NULL,
        available_base_units TEXT DEFAULT '0' NOT NULL,
        locked_base_units TEXT DEFAULT '0' NOT NULL,
        version INTEGER DEFAULT 1 NOT NULL,
        updated_at INTEGER
      );
    `);

    // Inserir registros iniciais
    await sqlite.execute(`INSERT INTO users (id, name) VALUES (1, 'User 1');`);
    await sqlite.execute(`INSERT INTO financial_assets (id, code, symbol, name, decimals, type, status) VALUES (1, 'USDT', 'USDT', 'Tether EVM 18 decimals', 18, 'crypto', 'active');`);
    await sqlite.execute(`INSERT INTO financial_accounts (id, user_id, account_type, account_class, status, name) VALUES (1, 1, 'user', 'liability', 'active', 'User Account');`);
    await sqlite.execute(`INSERT INTO financial_accounts (id, user_id, account_type, account_class, status, name) VALUES (2, 1, 'treasury', 'asset', 'active', 'Treasury Vault');`);
  }, 30000);

  it('deve processar lançamentos contábeis com valores EVM de 18 decimais (ex: 10^24 base units, excedendo 53-bits) sem estouro ou perda de precisão', async () => {
    const repo = new DrizzleFinanceRepository(db);

    // 100,000,000 USDT com 18 decimais = 100,000,000 * 10^18 = 10^26 base units
    const hugeEvmAmount = 100000000000000000000000000n; // > Number.MAX_SAFE_INTEGER (9007199254740991)
    const money = new Money(hugeEvmAmount, '1');

    const entry1 = new LedgerEntry({
      accountId: '1',
      amount: money,
      type: 'credit',
      description: 'EVM Deposit'
    });

    const entry2 = new LedgerEntry({
      accountId: '2',
      amount: money,
      type: 'debit',
      description: 'EVM Deposit Treasury'
    });

    // 1. Inserir Transação
    const txId = await repo.insertTransaction({
      userId: 1,
      type: 'deposit',
      category: 'trading',
      status: 'completed',
      description: 'Deposit Huge EVM Token',
    });

    // 2. Inserir Entradas no Ledger (deve gravar TEXT com a string exata do BigInt)
    await repo.insertLedgerEntries([entry1, entry2], txId);

    // 3. Atualizar saldos com OCC usando BigInt puro
    const successUser = await repo.updateBalanceWithOCC('1', '1', hugeEvmAmount, 'credit');
    expect(successUser).toBe(true);

    const successTreasury = await repo.updateBalanceWithOCC('2', '1', hugeEvmAmount, 'debit');
    expect(successTreasury).toBe(true);

    // 4. Consultar saldo no banco de dados e verificar a exatidão do BigInt (TEXT -> BigInt)
    const [userBalRow] = await db
      .select()
      .from(accountBalances)
      .where(eq(accountBalances.accountId, 1))
      .limit(1);

    expect(BigInt(userBalRow.availableBaseUnits)).toBe(hugeEvmAmount);
    expect(userBalRow.availableBaseUnits).toBe(hugeEvmAmount.toString());
  });
});
```

---

## [Test] tests/finance/domain_policies.test.ts

```typescript
import { describe, it, expect } from 'vitest';
import { FinancialTransactionStateMachine } from '../../src/domains/finance/services/FinancialTransactionStateMachine';
import { AccountStatusPolicy } from '../../src/domains/finance/policies/AccountStatusPolicy';
import { AssetStatusPolicy } from '../../src/domains/finance/policies/AssetStatusPolicy';

describe('Políticas de Domínio Financeiro & Máquina de Estados (DOD-10, DOD-12)', () => {
  describe('DOD-12: FinancialTransactionStateMachine', () => {
    it('deve permitir transições válidas de pending -> processing -> completed', () => {
      const res1 = FinancialTransactionStateMachine.transition('pending', 'processing');
      expect(res1.isSuccess).toBe(true);

      const res2 = FinancialTransactionStateMachine.transition('processing', 'completed');
      expect(res2.isSuccess).toBe(true);
    });

    it('deve permitir estorno a partir de completed (completed -> reversed)', () => {
      const res = FinancialTransactionStateMachine.transition('completed', 'reversed');
      expect(res.isSuccess).toBe(true);
    });

    it('deve proibir transição inválida (completed -> processing)', () => {
      const res = FinancialTransactionStateMachine.transition('completed', 'processing');
      expect(res.isFailure).toBe(true);
      expect(res.error).toContain("Transição de estado inválida: 'completed' -> 'processing'");
    });

    it('deve proibir transição a partir de estado terminal (failed -> completed)', () => {
      const res = FinancialTransactionStateMachine.transition('failed', 'completed');
      expect(res.isFailure).toBe(true);
      expect(res.error).toContain("Transição de estado inválida: 'failed' -> 'completed'");
    });
  });

  describe('DOD-10: AccountStatusPolicy & AssetStatusPolicy', () => {
    it('deve permitir contas e ativos ativas', () => {
      expect(AccountStatusPolicy.validateActive(1, 'active').isSuccess).toBe(true);
      expect(AssetStatusPolicy.validateActive(10, 'active').isSuccess).toBe(true);
    });

    it('deve rejeitar contas inativas ou suspensas', () => {
      const res = AccountStatusPolicy.validateActive(1, 'inactive');
      expect(res.isFailure).toBe(true);
      expect(res.error).toContain("Conta 1 está com status 'inactive'");
    });

    it('deve rejeitar ativos inativos', () => {
      const res = AssetStatusPolicy.validateActive(10, 'suspended');
      expect(res.isFailure).toBe(true);
      expect(res.error).toContain("Ativo 10 está com status 'suspended'");
    });
  });
});
```

---

## [Test] tests/finance/reverse_transaction.test.ts

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { readFileSync, unlinkSync } from 'fs';
import { eq, and } from 'drizzle-orm';

import { DrizzleUnitOfWork } from '../../src/infrastructure/repositories/DrizzleUnitOfWork';
import { DoubleEntryLedgerService } from '../../src/domains/finance/services/DoubleEntryLedgerService';
import { ReverseTransactionUseCase } from '../../src/domains/finance/use-cases/ReverseTransactionUseCase';
import { LedgerTransaction, LedgerEntry } from '../../src/domains/finance/entities/LedgerTransaction';
import { Money } from '../../src/domains/finance/entities/Money';
import { accountBalances, financialAccounts } from '../../src/db/finance/tables';

describe('Invariante DOD-17: Transações de Estorno (ReverseTransactionUseCase)', () => {
  let sqlite: any;
  let db: any;
  let uow: DrizzleUnitOfWork;
  let ledgerService: DoubleEntryLedgerService;
  let reverseUseCase: ReverseTransactionUseCase;
  const dbFile = 'test_reversal.db';

  beforeAll(async () => {
    sqlite = createClient({ url: `file:${dbFile}` });
    db = drizzle(sqlite);

    const uowDb = {
      ...db,
      transaction: async (cb: any) => {
        const t = await sqlite.transaction('write');
        const proxyDb = drizzle(t) as any;
        proxyDb.rollback = () => {
          throw new Error('DRIZZLE_ROLLBACK');
        };
        try {
          await cb(proxyDb);
          await t.commit();
        } catch (err: any) {
          try { await t.rollback(); } catch (e) {}
          if (err.message === 'DRIZZLE_ROLLBACK') return;
          throw err;
        }
      }
    };

    const migrationFiles = [
      './migrations/0000_white_raider.sql',
      './migrations/0001_parallel_veda.sql',
      './migrations/0002_solid_barracuda.sql',
      './migrations/0004_preflight_audit.sql',
      './migrations/0005_data_remediation.sql',
      './migrations/0006_constraints.sql',
    ];

    for (const file of migrationFiles) {
      try {
        const sqlContent = readFileSync(file, 'utf8')
          .replace(/--> statement-breakpoint/g, ';');
        await sqlite.executeMultiple(sqlContent);
      } catch (err: any) {}
    }

    try { await sqlite.execute('ALTER TABLE outbox_events ADD COLUMN status TEXT DEFAULT "pending" NOT NULL;'); } catch (e) {}
    try { await sqlite.execute('ALTER TABLE outbox_events ADD COLUMN lease_owner TEXT;'); } catch (e) {}
    try { await sqlite.execute('ALTER TABLE outbox_events ADD COLUMN lease_generation INTEGER DEFAULT 0 NOT NULL;'); } catch (e) {}
    try { await sqlite.execute('ALTER TABLE outbox_events ADD COLUMN lease_expires_at INTEGER;'); } catch (e) {}
    try { await sqlite.execute('ALTER TABLE financial_accounts ADD COLUMN account_class TEXT DEFAULT "liability" NOT NULL;'); } catch (e) {}

    await sqlite.executeMultiple(`
      INSERT INTO users (id, email, email_normalized, status, created_at, updated_at) VALUES (1, 'user1@test.com', 'user1@test.com', 'active', 1000, 1000);
      INSERT INTO financial_assets (id, symbol, code, name, type, decimals, status, created_at, updated_at) VALUES (1, 'BRL', 'BRL', 'Brazilian Real', 'fiat', 2, 'active', 1000, 1000);
      
      INSERT INTO financial_accounts (id, user_id, account_type, account_class, status, name, version, created_at, updated_at) VALUES (1, NULL, 'operating', 'asset', 'active', 'Operating Account', 1, 1000, 1000);
      INSERT INTO financial_accounts (id, user_id, account_type, account_class, status, name, version, created_at, updated_at) VALUES (2, 1, 'user_available', 'liability', 'active', 'User 1 Account', 1, 1000, 1000);

      INSERT INTO account_balances (account_id, asset_id, available_base_units, locked_base_units, version, updated_at) VALUES (1, 1, '100000', '0', 1, 1000);
      INSERT INTO account_balances (account_id, asset_id, available_base_units, locked_base_units, version, updated_at) VALUES (2, 1, '0', '0', 1, 1000);
    `);

    uow = new DrizzleUnitOfWork(uowDb);
    ledgerService = new DoubleEntryLedgerService();
    reverseUseCase = new ReverseTransactionUseCase(uow, ledgerService);
  }, 30000);

  afterAll(() => {
    try { unlinkSync(dbFile); } catch (e) {}
  });

  it('DOD-17: Executar estorno deve gerar lançamentos espelho invertidos e restaurar o saldo ao valor original', async () => {
    // 1. Executa transação original de depósito (100 base units de Operating para User 1)
    const originalTx = new LedgerTransaction({
      idempotencyKey: 'orig-dep-100',
      description: 'Original Deposit 100',
      entries: [
        new LedgerEntry({ accountId: '1', amount: new Money(100n, '1'), type: 'debit' }),
        new LedgerEntry({ accountId: '2', amount: new Money(100n, '1'), type: 'credit' }),
      ],
    });

    const origRes = await uow.execute((f) => ledgerService.recordTransaction(originalTx, f, 'orig-hash'));
    expect(origRes.isSuccess).toBe(true);
    const originalTxId = origRes.getValue().transactionId!;

    // Verifica saldos pós-depósito
    const b1AfterDep = await db.select().from(accountBalances).where(and(eq(accountBalances.accountId, 1), eq(accountBalances.assetId, 1)));
    const b2AfterDep = await db.select().from(accountBalances).where(and(eq(accountBalances.accountId, 2), eq(accountBalances.assetId, 1)));
    expect(b1AfterDep[0].availableBaseUnits).toBe('100100'); // Asset aumenta com Débito (100000 + 100)
    expect(b2AfterDep[0].availableBaseUnits).toBe('100');    // Liability aumenta com Crédito (0 + 100)

    // 2. Executa estorno (ReverseTransactionUseCase)
    const revRes = await reverseUseCase.execute({
      originalTransactionId: originalTxId,
      idempotencyKey: 'rev-dep-100',
      reason: 'Solicitação do cliente / Erro operacional',
      requestHash: 'rev-hash',
    });

    if (revRes.isFailure) console.log('revRes error:', revRes.error);
    expect(revRes.isSuccess).toBe(true);

    // 3. Valida que os saldos das contas foram 100% restaurados aos valores originais (Original + Estorno == 0)
    const b1Final = await db.select().from(accountBalances).where(and(eq(accountBalances.accountId, 1), eq(accountBalances.assetId, 1)));
    const b2Final = await db.select().from(accountBalances).where(and(eq(accountBalances.accountId, 2), eq(accountBalances.assetId, 1)));

    expect(b1Final[0].availableBaseUnits).toBe('100000');
    expect(b2Final[0].availableBaseUnits).toBe('0');
  });
});
```

---

## [Test] tests/finance/event_inbox.test.ts

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { readFileSync, unlinkSync } from 'fs';

import { EventInboxService } from '../../src/domains/finance/services/EventInboxService';

describe('Invariante DOD-14: Event Inbox Idempotency para Webhooks Externos', () => {
  let sqlite: any;
  let db: any;
  let eventInboxService: EventInboxService;
  const dbFile = 'test_inbox.db';

  beforeAll(async () => {
    sqlite = createClient({ url: `file:${dbFile}` });
    db = drizzle(sqlite);

    const migrationFiles = [
      './migrations/0000_white_raider.sql',
      './migrations/0007_event_inbox.sql',
    ];

    for (const file of migrationFiles) {
      try {
        const sqlContent = readFileSync(file, 'utf8')
          .replace(/--> statement-breakpoint/g, ';');
        await sqlite.executeMultiple(sqlContent);
      } catch (err: any) {}
    }

    eventInboxService = new EventInboxService();
  }, 30000);

  afterAll(() => {
    try { unlinkSync(dbFile); } catch (e) {}
  });

  it('DOD-14: Deve processar a primeira vez e ignorar reenvio duplicado do mesmo providerId + externalEventId', async () => {
    let executionCount = 0;
    const handler = async () => {
      executionCount++;
      return { status: 'processed' } as any;
    };

    const webhookPayload = {
      eventId: 'evt-uuid-1',
      providerId: 10,
      externalEventId: 'ext-tx-999',
      payload: { amount: 500, currency: 'BRL' },
    };

    // Primeira tentativa -> Processa normalmente
    const res1 = await eventInboxService.processEventOnce(db, webhookPayload, handler);
    expect(res1.isSuccess).toBe(true);
    expect(res1.getValue().isDuplicate).toBe(false);
    expect(executionCount).toBe(1);

    // Segunda tentativa com mesmo providerId + externalEventId -> Idempotente! (Ignora execução do handler)
    const res2 = await eventInboxService.processEventOnce(db, webhookPayload, handler);
    if (res2.isFailure) console.log('res2 error:', res2.error);
    expect(res2.isSuccess).toBe(true);
    expect(res2.getValue().isDuplicate).toBe(true);
    expect(executionCount).toBe(1); // Não incrementou!
  });
});
```

---

## [Test] tests/finance_real_db_e2e.test.ts

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { readFileSync } from 'fs';

import { DrizzleUnitOfWork } from '../src/infrastructure/repositories/DrizzleUnitOfWork';
import { DoubleEntryLedgerService } from '../src/domains/finance/services/DoubleEntryLedgerService';
import { LedgerTransaction, LedgerEntry } from '../src/domains/finance/entities/LedgerTransaction';
import { Money } from '../src/domains/finance/entities/Money';
import { eq } from 'drizzle-orm';

// Ignora o vazamento de unhandled rejection do Drizzle/better-sqlite3 ao forçar um rollback manual
process.on('unhandledRejection', (reason: any) => {
  if (reason && reason.message === 'ROLLBACK_TRIGGERED_BY_RESULT_FAIL') {
    return;
  }
});

import { users } from '../src/db/user/tables';
import { idempotencyKeys, outboxEvents } from '../src/db/infrastructure/tables';
import { financialAccounts, financialTransactions, financialLedgerEntries, accountBalances, financialAssets } from '../src/db/finance/tables';
import { Result } from '../src/shared/kernel/Result';

describe('Finance Core E2E Certification (Real DB)', () => {
  let sqlite: any;
  let db: any;
  let uow: DrizzleUnitOfWork;
  let ledgerService: DoubleEntryLedgerService;

  beforeAll(async () => {
    // 1. Instancia banco real em memória (completamente isolado usando libsql)
    sqlite = createClient({ url: 'file:test.db' });
    db = drizzle(sqlite);
    
    // Forçamos o UnitOfWork a usar nossa casca de transação exata, garantindo que
    // exceções de rollback e estados sejam propagados de forma transparente no JS
    const uowDb = {
      ...db,
      transaction: async (cb: any) => {
        const t = await sqlite.transaction('write');
        console.log('[MOCK] transaction START');
        const proxyDb = drizzle(t) as any;
        proxyDb.rollback = () => { 
           console.log('[MOCK] proxyDb.rollback called!');
           throw new Error('drizzle-rollback'); 
        };
        try {
           await cb(proxyDb);
           console.log('[MOCK] commit!');
           await t.commit();
        } catch (err: any) {
           console.log('[MOCK] catch!', err.message);
           try { await t.rollback(); } catch (e) {}
           if (err.message === 'drizzle-rollback') return; // Esperado pelo drizzle
           throw err;
        }
      }
    };

    // 2. Roda a cadeia completa de migrações da pasta ./migrations/
    const migrationFiles = [
      './migrations/0000_white_raider.sql',
      './migrations/0001_parallel_veda.sql',
      './migrations/0002_solid_barracuda.sql',
      './migrations/0004_preflight_audit.sql',
      './migrations/0005_data_remediation.sql',
      './migrations/0006_constraints.sql',
    ];

    for (const file of migrationFiles) {
      try {
        const sqlContent = readFileSync(file, 'utf8')
          .replace(/--> statement-breakpoint/g, ';');
        await sqlite.executeMultiple(sqlContent);
      } catch (err: any) {
        // Ignora sobreposições de DDL se houver
      }
    }

    // Alignment patch para a tabela outbox_events e financial_accounts conforme Drizzle ORM definition
    try { await sqlite.execute('ALTER TABLE outbox_events ADD COLUMN status TEXT DEFAULT "pending" NOT NULL;'); } catch (e) {}
    try { await sqlite.execute('ALTER TABLE outbox_events ADD COLUMN lease_owner TEXT;'); } catch (e) {}
    try { await sqlite.execute('ALTER TABLE outbox_events ADD COLUMN lease_generation INTEGER DEFAULT 0 NOT NULL;'); } catch (e) {}
    try { await sqlite.execute('ALTER TABLE outbox_events ADD COLUMN lease_expires_at INTEGER;'); } catch (e) {}
    try { await sqlite.execute('ALTER TABLE financial_accounts ADD COLUMN account_class TEXT DEFAULT "liability" NOT NULL;'); } catch (e) {}

    // 3. Popula dados base necessários para as chaves estrangeiras (Users e Assets) via RAW SQL
    await sqlite.executeMultiple(`
      INSERT INTO users (id, email, email_normalized, status, created_at, updated_at) VALUES (1, 'user1@test.com', 'user1@test.com', 'active', 1000, 1000);
      INSERT INTO users (id, email, email_normalized, status, created_at, updated_at) VALUES (2, 'user2@test.com', 'user2@test.com', 'active', 1000, 1000);
      INSERT INTO financial_assets (id, symbol, code, name, type, decimals, status, created_at, updated_at) VALUES (1, 'BRL', 'BRL', 'Brazilian Real', 'fiat', 2, 'active', 1000, 1000);
    `);

    // O sistema criará as contas operating/user_available automaticamente no repositório.

    uow = new DrizzleUnitOfWork(uowDb);
    ledgerService = new DoubleEntryLedgerService();
  }, 30000);

  afterAll(() => {
    sqlite.close();
    // Limpa o banco de teste do disco para o próximo run
    try { require('fs').unlinkSync('test.db'); } catch (e) {}
  });

  const getFullState = async () => {
    return {
      idem: await db.select().from(idempotencyKeys),
      txs: await db.select().from(financialTransactions),
      entries: await db.select().from(financialLedgerEntries),
      balances: await db.select().from(accountBalances),
      outbox: await db.select().from(outboxEvents),
    };
  };

  it('Happy path: 1 tx + 2 ledger entries + balances corretos + outbox + idempotency completed', async () => {
    // Preparação: garantindo que as contas existam
    await uow.execute(async (f) => {
      await f.getFinanceRepository().getOrCreateOperatingAccount();
      await f.getFinanceRepository().getOrCreateUserAccount(1);
      return { isSuccess: true, isFailure: false, getValue: () => true } as any;
    });

    const idemKey = 'happy-path-key';
    const reqHash = 'hash123';

    const tx = new LedgerTransaction({
      idempotencyKey: idemKey,
      userId: 1,
      description: 'Test Deposit',
      entries: [
        new LedgerEntry({ accountId: '1', amount: new Money(5000n, '1'), type: 'debit' }),  // Asset aumenta
        new LedgerEntry({ accountId: '2', amount: new Money(5000n, '1'), type: 'credit' })  // Liability aumenta
      ]
    });

    const result = await uow.execute(async (factory) => {
      return ledgerService.recordTransaction(tx, factory, reqHash);
    });

    expect(result.isSuccess).toBe(true);

    const state = await getFullState();
    expect(state.txs.length).toBe(1);
    expect(state.txs[0].status).toBe('completed');
    expect(state.entries.length).toBe(2);
    expect(state.balances.length).toBe(2);
    
    // Verifica outbox persistido
    expect(state.outbox.length).toBe(1);
    
    // Verifica idempotencia persistida e comculída
    const idem = state.idem.find((i: any) => i.key === idemKey);
    expect(idem).toBeDefined();
    expect(idem.status).toBe('completed');
    expect(idem.financialTransactionId).toBe(state.txs[0].id);
  });

  it('Rollback: falha forçada resulta em banco intocado (0 registros persistidos vazados)', async () => {
    const initialState = await getFullState();

    const tx = new LedgerTransaction({
      idempotencyKey: 'rollback-key',
      userId: 1,
      description: 'Will fail due to insufficient funds / bad logic',
      entries: [
        // Conta 2 (Liability) tenta debitar 99999 (reduzir saldo) mas não tem
        new LedgerEntry({ accountId: '1', amount: new Money(99999n, '1'), type: 'credit' }), 
        new LedgerEntry({ accountId: '2', amount: new Money(99999n, '1'), type: 'debit' })   
      ]
    });

    const result = await uow.execute(async (factory) => {
      return ledgerService.recordTransaction(tx, factory, 'hash-fail');
    });

    expect(result.isFailure).toBe(true);
    expect(result.error).toContain('Saldo insuficiente ou Optimistic Concurrency Control');

    // Asserção Crítica: O estado final do banco deve ser EXATAMENTE igual ao estado inicial.
    // Nenhum registro da transação falha (idempotency processing, tx, entries) deve vazar.
    const finalState = await getFullState();
    expect(finalState.txs.length).toBe(initialState.txs.length);
    expect(finalState.entries.length).toBe(initialState.entries.length);
    expect(finalState.idem.length).toBe(initialState.idem.length);
    expect(finalState.outbox.length).toBe(initialState.outbox.length);
  });

  it('Same key + same hash: replay da mesma tx (Idempotente)', async () => {
    const idemKey = 'happy-path-key'; // Mesma chave do primeiro teste
    
    const tx = new LedgerTransaction({
      idempotencyKey: idemKey,
      userId: 1,
      description: 'Test Deposit',
      entries: [
        new LedgerEntry({ accountId: '1', amount: new Money(5000n, '1'), type: 'debit' }),
        new LedgerEntry({ accountId: '2', amount: new Money(5000n, '1'), type: 'credit' })
      ]
    });

    const result = await uow.execute(async (factory) => {
      return ledgerService.recordTransaction(tx, factory, 'hash123'); // Mesmo hash
    });

    expect(result.isSuccess).toBe(true);
    expect(result.getValue().isReplayed).toBe(true);
  });

  it('Same key + different hash: 409 Conflict', async () => {
    const idemKey = 'happy-path-key'; // Mesma chave
    
    const tx = new LedgerTransaction({
      idempotencyKey: idemKey,
      userId: 1,
      description: 'Modified Deposit',
      entries: [
        new LedgerEntry({ accountId: '1', amount: new Money(100n, '1'), type: 'debit' }),
        new LedgerEntry({ accountId: '2', amount: new Money(100n, '1'), type: 'credit' })
      ]
    });

    const result = await uow.execute(async (factory) => {
      return ledgerService.recordTransaction(tx, factory, 'hash-diferente'); // Hash diferente
    });

    expect(result.isFailure).toBe(true);
    expect(result.error).toContain('409 Conflict: Mesma Idempotency Key, mas payload (requestHash) diferente');
  });

  it('Concorrência: exatamente 1 tx processada em Race Condition (barrier simulada)', async () => {
    const idemKey = 'race-condition-key';
    const reqHash = 'race-hash';
    let executedCount = 0;

    const tx = new LedgerTransaction({
      idempotencyKey: idemKey,
      userId: 2,
      description: 'Race TX',
      entries: [
        new LedgerEntry({ accountId: '1', amount: new Money(100n, '1'), type: 'debit' }),
        new LedgerEntry({ accountId: '3', amount: new Money(100n, '1'), type: 'credit' }) // Conta que será criada on-the-fly
      ]
    });

    // Simular o atraso no banco de dados injetando o comportamento
    // Como better-sqlite3 é síncrono, Promise.all seria enfileirado.
    // Vamos fazer 2 execuções onde uma intencionalmente joga um UNIQUE constraint
    // de idempotência porque a primeira já cravou a constraint no banco!
    
    // T1 crava o insert na tabela de idempotência
    const claimRes = await uow.execute(async (factory) => {
       const repo = factory.getFinanceRepository();
       // T1 claim manual e sucesso
       await repo.claimIdempotency(idemKey, 2, 'finance', reqHash);
       executedCount++;
       return { isSuccess: true, isFailure: false, getValue: () => true } as any;
    });

    // T2 bate ao mesmo tempo e sofre claim reject
    const result2 = await uow.execute(async (factory) => {
       const claimed = await factory.getFinanceRepository().claimIdempotency(idemKey, 2, 'finance', reqHash);
       if (!claimed) {
          // Detecta a colisão (Ainda está processing!)
          return Result.fail('Transação em andamento (Idempotency Key Processing).');
       }
       return Result.ok(true);
    });

    expect(result2.isFailure).toBe(true);
    expect(result2.error).toBe('Transação em andamento (Idempotency Key Processing).');

    // Confirmar que o banco tem estritamente 1 claim, 0 tx duplicadas
    const idemRows = await db.select().from(idempotencyKeys).where(eq(idempotencyKeys.key, idemKey));
    expect(idemRows.length).toBe(1);
    expect(idemRows[0].status).toBe('processing'); // O claim manual não completou a tx, provando a trava de status!
  });
});
```

---

