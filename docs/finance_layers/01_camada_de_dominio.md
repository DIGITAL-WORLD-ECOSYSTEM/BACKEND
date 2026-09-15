# 1. CAMADA DE DOMÍNIO (Regras Contábeis Puras)

Documento integrante do dossiê canônico do Finance Core (`BackEnd/`).

## Sumário dos Arquivos da Camada

- [FinancialLedgerEntryRecord.ts](#srcdomainsfinancecontractsfinancialledgerentryrecordts) — `src/domains/finance/contracts/FinancialLedgerEntryRecord.ts` (18 linhas)
- [FinancialTransaction.test.ts](#srcdomainsfinanceentitiesfinancialtransactiontestts) — `src/domains/finance/entities/FinancialTransaction.test.ts` (896 linhas)
- [LedgerTransaction.ts](#srcdomainsfinanceentitiesledgertransactionts) — `src/domains/finance/entities/LedgerTransaction.ts` (1197 linhas)
- [FinancialError.ts](#srcdomainsfinanceerrorsfinancialerrorts) — `src/domains/finance/errors/FinancialError.ts` (138 linhas)
- [LedgerImbalanceError.ts](#srcdomainsfinanceerrorsledgerimbalanceerrorts) — `src/domains/finance/errors/LedgerImbalanceError.ts` (10 linhas)
- [AccountClassPolicy.ts](#srcdomainsfinancepoliciesaccountclasspolicyts) — `src/domains/finance/policies/AccountClassPolicy.ts` (209 linhas)
- [AccountingEntryPolicy.ts](#srcdomainsfinancepoliciesaccountingentrypolicyts) — `src/domains/finance/policies/AccountingEntryPolicy.ts` (1454 linhas)
- [AccountStatusPolicy.ts](#srcdomainsfinancepoliciesaccountstatuspolicyts) — `src/domains/finance/policies/AccountStatusPolicy.ts` (122 linhas)
- [AssetStatusPolicy.ts](#srcdomainsfinancepoliciesassetstatuspolicyts) — `src/domains/finance/policies/AssetStatusPolicy.ts` (214 linhas)
- [FinancialTransactionStateMachine.ts](#srcdomainsfinanceservicesfinancialtransactionstatemachinets) — `src/domains/finance/services/FinancialTransactionStateMachine.ts` (152 linhas)
- [BaseUnits.ts](#srcdomainsfinancevalueobjectsbaseunitsts) — `src/domains/finance/value-objects/BaseUnits.ts` (48 linhas)
- [Money256.ts](#srcdomainsfinancevalueobjectsmoney256ts) — `src/domains/finance/value-objects/Money256.ts` (130 linhas)

---

<a id="srcdomainsfinancecontractsfinancialledgerentryrecordts"></a>
## Arquivo: `src/domains/finance/contracts/FinancialLedgerEntryRecord.ts`

- **Caminho absoluto**: `/home/sandro/Área de trabalho/BackEnd/src/domains/finance/contracts/FinancialLedgerEntryRecord.ts`
- **Total de linhas**: 18
- **Linguagem**: TypeScript

```typescript
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

```

---

<a id="srcdomainsfinanceentitiesfinancialtransactiontestts"></a>
## Arquivo: `src/domains/finance/entities/FinancialTransaction.test.ts`

- **Caminho absoluto**: `/home/sandro/Área de trabalho/BackEnd/src/domains/finance/entities/FinancialTransaction.test.ts`
- **Total de linhas**: 896
- **Linguagem**: TypeScript

```typescript
import { describe, it, expect } from 'vitest';
import {
  LedgerTransaction,
  LedgerEntry,
  FINANCIAL_TRANSACTION_CATEGORIES,
  SUPPORTED_FINANCIAL_TRANSACTION_TYPES,
  FINANCIAL_TRANSACTION_STATUSES,
  isUuidV4,
} from './LedgerTransaction';
import { Money256 } from '../value-objects/Money256';
import {
  parseCanonicalBaseUnits,
  parsePositiveCanonicalBaseUnits,
} from '../value-objects/BaseUnits';
import { LedgerImbalanceError } from '../errors/LedgerImbalanceError';
import {
  InvalidLedgerTransactionError,
  InvalidMoneyFormatError,
  InvalidIdentifierError,
  Money256OverflowError,
} from '../errors/FinancialError';

describe('LedgerTransaction & Financial Domain Hardening (Gates 1, 2, 3, 6)', () => {
  describe('01. Double-Entry Balance & Asset Segregation', () => {
    it('deve lançar LedgerImbalanceError se débitos não forem iguais a créditos para o mesmo ativo', () => {
      expect(() => {
        LedgerTransaction.create({
          idempotencyKey: crypto.randomUUID(),
          description: 'Teste desbalanceado',
          transactionType: 'deposit',
          category: 'deposit',
          entries: [
            new LedgerEntry({ accountId: '1', amount: Money256.fromBigInt(100n, 1), type: 'debit' }),
            new LedgerEntry({ accountId: '2', amount: Money256.fromBigInt(90n, 1), type: 'credit' }),
          ],
        });
      }).toThrowError(LedgerImbalanceError);
    });

    it('deve criar transação balanceada 1:1 com status pending e server timestamp', () => {
      const before = Date.now();
      const tx = LedgerTransaction.create({
        idempotencyKey: crypto.randomUUID(),
        description: 'Teste balanceado 1:1',
        transactionType: 'deposit',
        category: 'deposit',
        entries: [
          new LedgerEntry({ accountId: '1', amount: Money256.fromBigInt(100n, 1), type: 'debit' }),
          new LedgerEntry({ accountId: '2', amount: Money256.fromBigInt(100n, 1), type: 'credit' }),
        ],
      });
      const after = Date.now();

      expect(tx).toBeInstanceOf(LedgerTransaction);
      expect(tx.status).toBe('pending');
      expect(tx.status).not.toBe('completed');
      expect(tx.status).not.toBe('reversed');
      expect(tx.createdAt.getTime()).toBeGreaterThanOrEqual(before);
      expect(tx.createdAt.getTime()).toBeLessThanOrEqual(after);
    });

    it('deve suportar transação com múltiplas pernas balanceadas (1 débito para 2 créditos)', () => {
      const tx = LedgerTransaction.create({
        idempotencyKey: crypto.randomUUID(),
        description: 'Teste multi-leg 1:2',
        transactionType: 'transfer',
        category: 'operational',
        entries: [
          new LedgerEntry({ accountId: '1', amount: Money256.fromBigInt(100n, 1), type: 'debit' }),
          new LedgerEntry({ accountId: '2', amount: Money256.fromBigInt(60n, 1), type: 'credit' }),
          new LedgerEntry({ accountId: '3', amount: Money256.fromBigInt(40n, 1), type: 'credit' }),
        ],
      });
      expect(tx.entries.length).toBe(3);
    });

    it('deve rejeitar transação com ativos diferentes desbalanceados mesmo se os totais nominais coincidirem', () => {
      expect(() => {
        LedgerTransaction.create({
          idempotencyKey: crypto.randomUUID(),
          description: 'Mistura de ativos cruzados',
          transactionType: 'transfer',
          category: 'operational',
          entries: [
            new LedgerEntry({ accountId: '1', amount: Money256.fromBigInt(100n, 1), type: 'debit' }), // assetId 1
            new LedgerEntry({ accountId: '2', amount: Money256.fromBigInt(100n, 2), type: 'credit' }), // assetId 2
          ],
        });
      }).toThrowError(LedgerImbalanceError);
    });

    it('deve aceitar transação com múltiplos ativos onde cada ativo individualmente está balanceado', () => {
      const tx = LedgerTransaction.create({
        idempotencyKey: crypto.randomUUID(),
        description: 'Dois ativos balanceados independentemente',
        transactionType: 'transfer',
        category: 'operational',
        entries: [
          new LedgerEntry({ accountId: '1', amount: Money256.fromBigInt(100n, 1), type: 'debit' }),
          new LedgerEntry({ accountId: '2', amount: Money256.fromBigInt(100n, 1), type: 'credit' }),
          new LedgerEntry({ accountId: '3', amount: Money256.fromBigInt(50n, 2), type: 'debit' }),
          new LedgerEntry({ accountId: '4', amount: Money256.fromBigInt(50n, 2), type: 'credit' }),
        ],
      });
      expect(tx.entries.length).toBe(4);
    });

    it('deve rejeitar transação com menos de 2 lançamentos contábeis', () => {
      expect(() => {
        LedgerTransaction.create({
          idempotencyKey: crypto.randomUUID(),
          description: 'Apenas uma partida',
          transactionType: 'deposit',
          category: 'deposit',
          entries: [
            new LedgerEntry({ accountId: '1', amount: Money256.fromBigInt(100n, 1), type: 'debit' }),
          ],
        });
      }).toThrowError(InvalidLedgerTransactionError);
    });

    it('deve rejeitar transação contendo apenas débitos (sem crédito)', () => {
      expect(() => {
        LedgerTransaction.create({
          idempotencyKey: crypto.randomUUID(),
          description: 'Somente débitos',
          transactionType: 'adjustment',
          category: 'operational',
          entries: [
            new LedgerEntry({ accountId: '1', amount: Money256.fromBigInt(50n, 1), type: 'debit' }),
            new LedgerEntry({ accountId: '2', amount: Money256.fromBigInt(50n, 1), type: 'debit' }),
          ],
        });
      }).toThrowError(InvalidLedgerTransactionError);
    });

    it('deve rejeitar transação contendo apenas créditos (sem débito)', () => {
      expect(() => {
        LedgerTransaction.create({
          idempotencyKey: crypto.randomUUID(),
          description: 'Somente créditos',
          transactionType: 'adjustment',
          category: 'operational',
          entries: [
            new LedgerEntry({ accountId: '1', amount: Money256.fromBigInt(50n, 1), type: 'credit' }),
            new LedgerEntry({ accountId: '2', amount: Money256.fromBigInt(50n, 1), type: 'credit' }),
          ],
        });
      }).toThrowError(InvalidLedgerTransactionError);
    });

    it('deve rejeitar IDs de LedgerEntry duplicados dentro da mesma transação (FIN-006)', () => {
      expect(() => {
        LedgerTransaction.create({
          idempotencyKey: crypto.randomUUID(),
          description: 'IDs duplicados',
          transactionType: 'transfer',
          category: 'operational',
          entries: [
            new LedgerEntry({ id: 'same-entry-id', accountId: '1', amount: Money256.fromBigInt(100n, 1), type: 'debit' }),
            new LedgerEntry({ id: 'same-entry-id', accountId: '2', amount: Money256.fromBigInt(100n, 1), type: 'credit' }),
          ],
        });
      }).toThrowError('Transaction cannot contain duplicate ledger entry IDs.');
    });

    it('deve aceitar transação com exatamente 100 lançamentos contábeis (limite DoS)', () => {
      const entries: LedgerEntry[] = [];
      for (let i = 1; i <= 50; i++) {
        entries.push(new LedgerEntry({ accountId: String(i), amount: Money256.fromBigInt(10n, 1), type: 'debit' }));
        entries.push(new LedgerEntry({ accountId: String(i + 50), amount: Money256.fromBigInt(10n, 1), type: 'credit' }));
      }
      expect(entries.length).toBe(100);

      const tx = LedgerTransaction.create({
        idempotencyKey: crypto.randomUUID(),
        description: 'Exatamente 100 entries',
        transactionType: 'adjustment',
        category: 'operational',
        entries,
      });
      expect(tx.entries.length).toBe(100);
    });

    it('deve rejeitar transação com 101 lançamentos contábeis (excede limite DoS)', () => {
      const entries: LedgerEntry[] = [];
      for (let i = 1; i <= 50; i++) {
        entries.push(new LedgerEntry({ accountId: String(i), amount: Money256.fromBigInt(10n, 1), type: 'debit' }));
        entries.push(new LedgerEntry({ accountId: String(i + 50), amount: Money256.fromBigInt(10n, 1), type: 'credit' }));
      }
      entries.push(new LedgerEntry({ accountId: '101', amount: Money256.fromBigInt(10n, 1), type: 'debit' }));
      expect(entries.length).toBe(101);

      expect(() => {
        LedgerTransaction.create({
          idempotencyKey: crypto.randomUUID(),
          description: '101 entries',
          transactionType: 'adjustment',
          category: 'operational',
          entries,
        });
      }).toThrowError('Transaction exceeds maximum limit of 100 entries.');
    });
  });

  describe('02. Deep Immutability & Defensive Copies', () => {
    it('deve garantir que o array entries seja congelado (Object.isFrozen)', () => {
      const tx = LedgerTransaction.create({
        idempotencyKey: crypto.randomUUID(),
        description: 'Teste Array Frozen',
        transactionType: 'deposit',
        category: 'deposit',
        entries: [
          new LedgerEntry({ accountId: '1', amount: Money256.fromBigInt(100n, 1), type: 'debit' }),
          new LedgerEntry({ accountId: '2', amount: Money256.fromBigInt(100n, 1), type: 'credit' }),
        ],
      });

      expect(Object.isFrozen(tx.entries)).toBe(true);
      expect(() => {
        (tx.entries as any).push(
          new LedgerEntry({ accountId: '3', amount: Money256.fromBigInt(10n, 1), type: 'debit' })
        );
      }).toThrow();
    });

    it('deve garantir cópia defensiva do array de entrada (mutação externa não afeta agregado)', () => {
      const externalEntries = [
        new LedgerEntry({ accountId: '1', amount: Money256.fromBigInt(100n, 1), type: 'debit' }),
        new LedgerEntry({ accountId: '2', amount: Money256.fromBigInt(100n, 1), type: 'credit' }),
      ];

      const tx = LedgerTransaction.create({
        idempotencyKey: crypto.randomUUID(),
        description: 'Cópia defensiva',
        transactionType: 'deposit',
        category: 'deposit',
        entries: externalEntries,
      });

      externalEntries.push(
        new LedgerEntry({ accountId: '3', amount: Money256.fromBigInt(50n, 1), type: 'debit' })
      );

      expect(externalEntries.length).toBe(3);
      expect(tx.entries.length).toBe(2);
    });

    it('deve garantir que cada LedgerEntry individual seja congelado (Object.isFrozen)', () => {
      const entry1 = new LedgerEntry({ accountId: '1', amount: Money256.fromBigInt(100n, 1), type: 'debit' });
      const entry2 = new LedgerEntry({ accountId: '2', amount: Money256.fromBigInt(100n, 1), type: 'credit' });

      expect(Object.isFrozen(entry1)).toBe(true);
      expect(Object.isFrozen(entry2)).toBe(true);

      expect(() => {
        (entry1 as any).type = 'credit';
      }).toThrow();

      expect(() => {
        (entry1 as any).accountId = '999';
      }).toThrow();
    });

    it('deve impedir mutação da data interna via createdAt.setTime (getter defensivo)', () => {
      const tx = LedgerTransaction.create({
        idempotencyKey: crypto.randomUUID(),
        description: 'Teste Date Immutability',
        transactionType: 'deposit',
        category: 'deposit',
        entries: [
          new LedgerEntry({ accountId: '1', amount: Money256.fromBigInt(100n, 1), type: 'debit' }),
          new LedgerEntry({ accountId: '2', amount: Money256.fromBigInt(100n, 1), type: 'credit' }),
        ],
      });

      const initialTime = tx.createdAt.getTime();
      const leakedDate = tx.createdAt;
      leakedDate.setTime(0);

      expect(tx.createdAt.getTime()).toBe(initialTime);
      expect(tx.createdAt.getTime()).not.toBe(0);
    });

    it('deve garantir que o próprio agregado LedgerTransaction seja congelado (Object.isFrozen)', () => {
      const tx = LedgerTransaction.create({
        idempotencyKey: crypto.randomUUID(),
        description: 'Teste Aggregate Frozen',
        transactionType: 'deposit',
        category: 'deposit',
        entries: [
          new LedgerEntry({ accountId: '1', amount: Money256.fromBigInt(100n, 1), type: 'debit' }),
          new LedgerEntry({ accountId: '2', amount: Money256.fromBigInt(100n, 1), type: 'credit' }),
        ],
      });

      expect(Object.isFrozen(tx)).toBe(true);
      expect(() => {
        (tx as any).description = 'Mutação ilegal';
      }).toThrow();
    });
  });

  describe('03. Validation of Identifiers, Strings & Unicode Normalization', () => {
    it('deve gerar publicId automaticamente como UUID v4 canônico em lowercase (FIN-004 e FIN-005)', () => {
      const tx1 = LedgerTransaction.create({
        idempotencyKey: crypto.randomUUID(),
        description: 'Tx 1',
        transactionType: 'deposit',
        category: 'deposit',
        entries: [
          new LedgerEntry({ accountId: '1', amount: Money256.fromBigInt(100n, 1), type: 'debit' }),
          new LedgerEntry({ accountId: '2', amount: Money256.fromBigInt(100n, 1), type: 'credit' }),
        ],
      });

      const tx2 = LedgerTransaction.create({
        idempotencyKey: crypto.randomUUID(),
        description: 'Tx 2',
        transactionType: 'deposit',
        category: 'deposit',
        entries: [
          new LedgerEntry({ accountId: '1', amount: Money256.fromBigInt(100n, 1), type: 'debit' }),
          new LedgerEntry({ accountId: '2', amount: Money256.fromBigInt(100n, 1), type: 'credit' }),
        ],
      });

      expect(isUuidV4(tx1.publicId)).toBe(true);
      expect(tx1.publicId).toBe(tx1.publicId.toLowerCase());
      expect(tx1.publicId).not.toBe(tx2.publicId);
    });

    it('deve rejeitar idempotencyKey vazia ou superior a 255 caracteres', () => {
      expect(() => {
        LedgerTransaction.create({
          idempotencyKey: '   ',
          description: 'Blank key',
          transactionType: 'deposit',
          category: 'deposit',
          entries: [
            new LedgerEntry({ accountId: '1', amount: Money256.fromBigInt(100n, 1), type: 'debit' }),
            new LedgerEntry({ accountId: '2', amount: Money256.fromBigInt(100n, 1), type: 'credit' }),
          ],
        });
      }).toThrowError('Idempotency key is required.');

      expect(() => {
        LedgerTransaction.create({
          idempotencyKey: 'k'.repeat(256),
          description: 'Key too long',
          transactionType: 'deposit',
          category: 'deposit',
          entries: [
            new LedgerEntry({ accountId: '1', amount: Money256.fromBigInt(100n, 1), type: 'debit' }),
            new LedgerEntry({ accountId: '2', amount: Money256.fromBigInt(100n, 1), type: 'credit' }),
          ],
        });
      }).toThrowError('Idempotency key exceeds maximum length of 255 characters.');
    });

    it('deve rejeitar caracteres de controle em idempotencyKey e description', () => {
      expect(() => {
        LedgerTransaction.create({
          idempotencyKey: 'chave\ncom\nnewline',
          description: 'Desc normal',
          transactionType: 'deposit',
          category: 'deposit',
          entries: [
            new LedgerEntry({ accountId: '1', amount: Money256.fromBigInt(100n, 1), type: 'debit' }),
            new LedgerEntry({ accountId: '2', amount: Money256.fromBigInt(100n, 1), type: 'credit' }),
          ],
        });
      }).toThrowError('contains forbidden control characters.');

      expect(() => {
        LedgerTransaction.create({
          idempotencyKey: crypto.randomUUID(),
          description: 'Desc com null byte \u0000',
          transactionType: 'deposit',
          category: 'deposit',
          entries: [
            new LedgerEntry({ accountId: '1', amount: Money256.fromBigInt(100n, 1), type: 'debit' }),
            new LedgerEntry({ accountId: '2', amount: Money256.fromBigInt(100n, 1), type: 'credit' }),
          ],
        });
      }).toThrowError('contains forbidden control characters.');
    });

    it('deve rejeitar description superior a 255 caracteres', () => {
      expect(() => {
        LedgerTransaction.create({
          idempotencyKey: crypto.randomUUID(),
          description: 'd'.repeat(256),
          transactionType: 'deposit',
          category: 'deposit',
          entries: [
            new LedgerEntry({ accountId: '1', amount: Money256.fromBigInt(100n, 1), type: 'debit' }),
            new LedgerEntry({ accountId: '2', amount: Money256.fromBigInt(100n, 1), type: 'credit' }),
          ],
        });
      }).toThrowError('Transaction description exceeds maximum length of 255 characters.');
    });

    it('deve rejeitar userId se fornecido e for menor ou igual a 0 ou não-seguro', () => {
      expect(() => {
        LedgerTransaction.create({
          idempotencyKey: crypto.randomUUID(),
          description: 'Invalid user',
          transactionType: 'deposit',
          category: 'deposit',
          userId: -1,
          entries: [
            new LedgerEntry({ accountId: '1', amount: Money256.fromBigInt(100n, 1), type: 'debit' }),
            new LedgerEntry({ accountId: '2', amount: Money256.fromBigInt(100n, 1), type: 'credit' }),
          ],
        });
      }).toThrowError(InvalidIdentifierError);

      expect(() => {
        LedgerTransaction.create({
          idempotencyKey: crypto.randomUUID(),
          description: 'Invalid user 0',
          transactionType: 'deposit',
          category: 'deposit',
          userId: 0,
          entries: [
            new LedgerEntry({ accountId: '1', amount: Money256.fromBigInt(100n, 1), type: 'debit' }),
            new LedgerEntry({ accountId: '2', amount: Money256.fromBigInt(100n, 1), type: 'credit' }),
          ],
        });
      }).toThrowError(InvalidIdentifierError);
    });

    it('deve rejeitar category inválida', () => {
      expect(() => {
        LedgerTransaction.create({
          idempotencyKey: crypto.randomUUID(),
          description: 'Invalid category',
          transactionType: 'deposit',
          // Deliberadamente bypassa TypeScript para testar a fronteira runtime
          category: 'inexistente' as any,
          entries: [
            new LedgerEntry({ accountId: '1', amount: Money256.fromBigInt(100n, 1), type: 'debit' }),
            new LedgerEntry({ accountId: '2', amount: Money256.fromBigInt(100n, 1), type: 'credit' }),
          ],
        });
      }).toThrowError(InvalidLedgerTransactionError);
    });

    it('deve aceitar todas as categorias canônicas definidas', () => {
      for (const cat of FINANCIAL_TRANSACTION_CATEGORIES) {
        const tx = LedgerTransaction.create({
          idempotencyKey: crypto.randomUUID(),
          description: `Teste cat ${cat}`,
          transactionType: 'adjustment',
          category: cat,
          entries: [
            new LedgerEntry({ accountId: '1', amount: Money256.fromBigInt(100n, 1), type: 'debit' }),
            new LedgerEntry({ accountId: '2', amount: Money256.fromBigInt(100n, 1), type: 'credit' }),
          ],
        });
        expect(tx.category).toBe(cat);
      }
    });

    it('deve aceitar todos os tipos contábeis EFETIVAMENTE SUPORTADOS (FIN-003)', () => {
      for (const type of SUPPORTED_FINANCIAL_TRANSACTION_TYPES) {
        if (type === 'reversal' || type === 'refund') continue; // Requerem parâmetros de relacionamento
        const tx = LedgerTransaction.create({
          idempotencyKey: crypto.randomUUID(),
          description: `Teste type ${type}`,
          transactionType: type,
          category: 'operational',
          entries: [
            new LedgerEntry({ accountId: '1', amount: Money256.fromBigInt(100n, 1), type: 'debit' }),
            new LedgerEntry({ accountId: '2', amount: Money256.fromBigInt(100n, 1), type: 'credit' }),
          ],
        });
        expect(tx.transactionType).toBe(type);
      }
    });

    it('deve expressamente bloquear transactionType "conversion" como não suportado (FIN-003 / FIN-TX-001)', () => {
      expect(() => {
        LedgerTransaction.create({
          idempotencyKey: crypto.randomUUID(),
          description: 'Tentativa de conversão de ativos',
          // Deliberadamente testa o tipo conhecido porém não suportado nesta release
          transactionType: 'conversion' as any,
          category: 'trading',
          entries: [
            new LedgerEntry({ accountId: '1', amount: Money256.fromBigInt(100n, 1), type: 'debit' }),
            new LedgerEntry({ accountId: '2', amount: Money256.fromBigInt(100n, 1), type: 'credit' }),
          ],
        });
      }).toThrowError('Invalid or unsupported financial transaction type.');
    });

    it('deve rejeitar transactionType que seja categoria e não tipo (ex: operational)', () => {
      expect(() => {
        LedgerTransaction.create({
          idempotencyKey: crypto.randomUUID(),
          description: 'Tipo inválido operational',
          // Deliberadamente bypassa TypeScript para testar a fronteira runtime
          transactionType: 'operational' as any,
          category: 'operational',
          entries: [
            new LedgerEntry({ accountId: '1', amount: Money256.fromBigInt(100n, 1), type: 'debit' }),
            new LedgerEntry({ accountId: '2', amount: Money256.fromBigInt(100n, 1), type: 'credit' }),
          ],
        });
      }).toThrowError(InvalidLedgerTransactionError);
    });

    it('deve rejeitar runtime props nulo ou não-objeto (FIN-016)', () => {
      expect(() => LedgerTransaction.create(null as any)).toThrowError(
        'LedgerTransaction creation props must be a valid non-null object.'
      );
      expect(() => LedgerTransaction.create(undefined as any)).toThrowError(
        'LedgerTransaction creation props must be a valid non-null object.'
      );
      expect(() => LedgerTransaction.create('invalid' as any)).toThrowError(
        'LedgerTransaction creation props must be a valid non-null object.'
      );
      expect(() => LedgerTransaction.rehydrate(null as any)).toThrowError(
        'LedgerTransaction rehydration snapshot must be a valid non-null object.'
      );
    });
  });

  describe('04. LedgerEntry Validation & Anti-Log-Injection', () => {
    it('deve rejeitar accountId não numérico, negativo ou zero', () => {
      expect(() => {
        new LedgerEntry({ accountId: 'abc', amount: Money256.fromBigInt(100n, 1), type: 'debit' });
      }).toThrowError(InvalidIdentifierError);

      expect(() => {
        new LedgerEntry({ accountId: '0', amount: Money256.fromBigInt(100n, 1), type: 'debit' });
      }).toThrowError(InvalidIdentifierError);

      expect(() => {
        new LedgerEntry({ accountId: '-5', amount: Money256.fromBigInt(100n, 1), type: 'debit' });
      }).toThrowError(InvalidIdentifierError);

      expect(() => {
        new LedgerEntry({ accountId: '1.5', amount: Money256.fromBigInt(100n, 1), type: 'debit' });
      }).toThrowError(InvalidIdentifierError);

      expect(() => {
        new LedgerEntry({ accountId: '9007199254740992', amount: Money256.fromBigInt(100n, 1), type: 'debit' });
      }).toThrowError(InvalidIdentifierError);
    });

    it('deve sanitizar mensagem de erro contra log injection em accountId malicioso (FIN-011)', () => {
      try {
        new LedgerEntry({
          accountId: 'malicious\nFORGED LOG ENTRY',
          amount: Money256.fromBigInt(100n, 1),
          type: 'debit',
        });
        expect.fail('Deveria ter lançado InvalidIdentifierError');
      } catch (err: any) {
        expect(err).toBeInstanceOf(InvalidIdentifierError);
        expect(err.message).not.toContain('\n');
      }
    });

    it('deve rejeitar amount zero ou negativo', () => {
      expect(() => {
        new LedgerEntry({ accountId: '1', amount: Money256.fromBigInt(0n, 1), type: 'debit' });
      }).toThrowError(InvalidMoneyFormatError);

      expect(() => {
        new LedgerEntry({ accountId: '1', amount: Money256.fromBigInt(-10n, 1), type: 'debit' });
      }).toThrowError(InvalidMoneyFormatError);
    });

    it('deve rejeitar direction diferente de debit ou credit', () => {
      expect(() => {
        // Deliberadamente bypassa TypeScript para testar a fronteira runtime
        new LedgerEntry({ accountId: '1', amount: Money256.fromBigInt(100n, 1), type: 'other' as any });
      }).toThrowError('Invalid LedgerEntry direction. Must be "debit" or "credit".');
    });

    it('deve rejeitar description de LedgerEntry com caracteres de controle', () => {
      expect(() => {
        new LedgerEntry({
          accountId: '1',
          amount: Money256.fromBigInt(100n, 1),
          type: 'debit',
          description: 'Linha com\nnewline',
        });
      }).toThrowError('LedgerEntry description contains forbidden control characters.');
    });

    it('deve rejeitar id de LedgerEntry com caracteres de controle', () => {
      expect(() => {
        new LedgerEntry({
          id: 'bad\0id',
          accountId: '1',
          amount: Money256.fromBigInt(100n, 1),
          type: 'debit',
        });
      }).toThrowError(InvalidIdentifierError);
    });

    it('deve rejeitar LedgerEntry com props nulo ou não-objeto (FIN-016)', () => {
      expect(() => new LedgerEntry(null as any)).toThrowError(
        'LedgerEntry props must be a valid non-null object.'
      );
    });
  });

  describe('05. Semantic Rules for Reversal & Refund', () => {
    it('deve exigir reversalOfTransactionId quando transactionType for reversal', () => {
      expect(() => {
        LedgerTransaction.create({
          idempotencyKey: crypto.randomUUID(),
          description: 'Reversal sem tx original',
          transactionType: 'reversal',
          category: 'operational',
          entries: [
            new LedgerEntry({ accountId: '1', amount: Money256.fromBigInt(100n, 1), type: 'debit' }),
            new LedgerEntry({ accountId: '2', amount: Money256.fromBigInt(100n, 1), type: 'credit' }),
          ],
        });
      }).toThrowError('Reversal transaction requires reversalOfTransactionId.');
    });

    it('deve rejeitar reversalOfTransactionId quando transactionType não for reversal', () => {
      expect(() => {
        LedgerTransaction.create({
          idempotencyKey: crypto.randomUUID(),
          description: 'Deposit com reversalOf',
          transactionType: 'deposit',
          category: 'deposit',
          reversalOfTransactionId: 10,
          entries: [
            new LedgerEntry({ accountId: '1', amount: Money256.fromBigInt(100n, 1), type: 'debit' }),
            new LedgerEntry({ accountId: '2', amount: Money256.fromBigInt(100n, 1), type: 'credit' }),
          ],
        });
      }).toThrowError('reversalOfTransactionId is only valid for reversal transactions.');
    });

    it('deve permitir reversal com reversalOfTransactionId positivo válido', () => {
      const tx = LedgerTransaction.create({
        idempotencyKey: crypto.randomUUID(),
        description: 'Estorno de tx #42',
        transactionType: 'reversal',
        category: 'operational',
        reversalOfTransactionId: 42,
        entries: [
          new LedgerEntry({ accountId: '1', amount: Money256.fromBigInt(100n, 1), type: 'debit' }),
          new LedgerEntry({ accountId: '2', amount: Money256.fromBigInt(100n, 1), type: 'credit' }),
        ],
      });
      expect(tx.transactionType).toBe('reversal');
      expect(tx.reversalOfTransactionId).toBe(42);
    });

    it('deve exigir refundOfTransactionId quando transactionType for refund', () => {
      expect(() => {
        LedgerTransaction.create({
          idempotencyKey: crypto.randomUUID(),
          description: 'Refund sem tx original',
          transactionType: 'refund',
          category: 'operational',
          entries: [
            new LedgerEntry({ accountId: '1', amount: Money256.fromBigInt(100n, 1), type: 'debit' }),
            new LedgerEntry({ accountId: '2', amount: Money256.fromBigInt(100n, 1), type: 'credit' }),
          ],
        });
      }).toThrowError('Refund transaction requires refundOfTransactionId.');
    });

    it('deve rejeitar refundOfTransactionId quando transactionType não for refund', () => {
      expect(() => {
        LedgerTransaction.create({
          idempotencyKey: crypto.randomUUID(),
          description: 'Transfer com refundOf',
          transactionType: 'transfer',
          category: 'operational',
          refundOfTransactionId: 5,
          entries: [
            new LedgerEntry({ accountId: '1', amount: Money256.fromBigInt(100n, 1), type: 'debit' }),
            new LedgerEntry({ accountId: '2', amount: Money256.fromBigInt(100n, 1), type: 'credit' }),
          ],
        });
      }).toThrowError('refundOfTransactionId is only valid for refund transactions.');
    });
  });

  describe('06. Rehydration Factory (LedgerTransaction.rehydrate)', () => {
    it('deve reidratar transação completa e canonicalizar publicId para lowercase (FIN-004)', () => {
      const publicId = crypto.randomUUID().toUpperCase();
      const idempotencyKey = crypto.randomUUID();
      const createdAtEpochMs = Date.now();

      const tx = LedgerTransaction.rehydrate({
        databaseId: 101,
        publicId,
        idempotencyKey,
        description: 'Transação persistida',
        status: 'completed',
        createdAtEpochMs,
        userId: 15,
        transactionType: 'deposit',
        category: 'deposit',
        entries: [
          new LedgerEntry({ id: crypto.randomUUID(), accountId: '1', amount: Money256.fromBigInt(100n, 1), type: 'debit' }),
          new LedgerEntry({ id: crypto.randomUUID(), accountId: '2', amount: Money256.fromBigInt(100n, 1), type: 'credit' }),
        ],
      });

      expect(tx.databaseId).toBe(101);
      expect(tx.publicId).toBe(publicId.toLowerCase());
      expect(tx.id).toBe(publicId.toLowerCase());
      expect(tx.status).toBe('completed');
      expect(tx.createdAt.getTime()).toBe(createdAtEpochMs);
      expect(Object.isFrozen(tx.entries)).toBe(true);
      expect(Object.isFrozen(tx)).toBe(true);
    });

    it('deve aceitar todos os status canônicos de ciclo de vida na reidratação', () => {
      for (const status of FINANCIAL_TRANSACTION_STATUSES) {
        const tx = LedgerTransaction.rehydrate({
          databaseId: 1,
          publicId: crypto.randomUUID(),
          idempotencyKey: crypto.randomUUID(),
          description: `Status ${status}`,
          status,
          createdAtEpochMs: Date.now(),
          userId: 1,
          transactionType: 'adjustment',
          category: 'operational',
          entries: [
            new LedgerEntry({ accountId: '1', amount: Money256.fromBigInt(10n, 1), type: 'debit' }),
            new LedgerEntry({ accountId: '2', amount: Money256.fromBigInt(10n, 1), type: 'credit' }),
          ],
        });
        expect(tx.status).toBe(status);
      }
    });

    it('deve rejeitar reidratação com status desconhecido (ex: posted)', () => {
      expect(() => {
        LedgerTransaction.rehydrate({
          databaseId: 1,
          publicId: crypto.randomUUID(),
          idempotencyKey: crypto.randomUUID(),
          description: 'Tx com posted',
          // Deliberadamente bypassa TypeScript para testar a fronteira runtime
          status: 'posted' as any,
          createdAtEpochMs: Date.now(),
          userId: 1,
          transactionType: 'deposit',
          category: 'deposit',
          entries: [
            new LedgerEntry({ accountId: '1', amount: Money256.fromBigInt(10n, 1), type: 'debit' }),
            new LedgerEntry({ accountId: '2', amount: Money256.fromBigInt(10n, 1), type: 'credit' }),
          ],
        });
      }).toThrowError('Invalid status on rehydration.');
    });

    it('deve rejeitar reidratação com databaseId não-positivo', () => {
      expect(() => {
        LedgerTransaction.rehydrate({
          databaseId: -1,
          publicId: crypto.randomUUID(),
          idempotencyKey: crypto.randomUUID(),
          description: 'Tx com ID negativo',
          status: 'completed',
          createdAtEpochMs: Date.now(),
          userId: 1,
          transactionType: 'deposit',
          category: 'deposit',
          entries: [
            new LedgerEntry({ accountId: '1', amount: Money256.fromBigInt(100n, 1), type: 'debit' }),
            new LedgerEntry({ accountId: '2', amount: Money256.fromBigInt(100n, 1), type: 'credit' }),
          ],
        });
      }).toThrowError(InvalidIdentifierError);
    });

    it('deve rejeitar reidratação com entries desbalanceados (corrupção física)', () => {
      expect(() => {
        LedgerTransaction.rehydrate({
          databaseId: 1,
          publicId: crypto.randomUUID(),
          idempotencyKey: crypto.randomUUID(),
          description: 'Tx corrompida no banco',
          status: 'completed',
          createdAtEpochMs: Date.now(),
          userId: 1,
          transactionType: 'deposit',
          category: 'deposit',
          entries: [
            new LedgerEntry({ accountId: '1', amount: Money256.fromBigInt(100n, 1), type: 'debit' }),
            new LedgerEntry({ accountId: '2', amount: Money256.fromBigInt(50n, 1), type: 'credit' }),
          ],
        });
      }).toThrowError(LedgerImbalanceError);
    });

    it('deve rejeitar reidratação com createdAtEpochMs inválido', () => {
      expect(() => {
        LedgerTransaction.rehydrate({
          databaseId: 1,
          publicId: crypto.randomUUID(),
          idempotencyKey: crypto.randomUUID(),
          description: 'Tx com timestamp zero',
          status: 'completed',
          createdAtEpochMs: 0,
          userId: 1,
          transactionType: 'deposit',
          category: 'deposit',
          entries: [
            new LedgerEntry({ accountId: '1', amount: Money256.fromBigInt(100n, 1), type: 'debit' }),
            new LedgerEntry({ accountId: '2', amount: Money256.fromBigInt(100n, 1), type: 'credit' }),
          ],
        });
      }).toThrowError('createdAtEpochMs on rehydration must be a valid positive safe integer timestamp.');
    });

    it('deve rejeitar reidratação com auto-reversão (FIN-001 / auto-reversal)', () => {
      expect(() => {
        LedgerTransaction.rehydrate({
          databaseId: 42,
          publicId: crypto.randomUUID(),
          idempotencyKey: crypto.randomUUID(),
          description: 'Auto reversal inválido',
          status: 'reversed',
          createdAtEpochMs: Date.now(),
          userId: 1,
          transactionType: 'reversal',
          category: 'operational',
          reversalOfTransactionId: 42, // mesmo que databaseId!
          entries: [
            new LedgerEntry({ accountId: '1', amount: Money256.fromBigInt(100n, 1), type: 'debit' }),
            new LedgerEntry({ accountId: '2', amount: Money256.fromBigInt(100n, 1), type: 'credit' }),
          ],
        });
      }).toThrowError('A transaction cannot reverse itself.');
    });

    it('deve rejeitar reidratação com auto-reembolso (FIN-001 / auto-refund)', () => {
      expect(() => {
        LedgerTransaction.rehydrate({
          databaseId: 42,
          publicId: crypto.randomUUID(),
          idempotencyKey: crypto.randomUUID(),
          description: 'Auto refund inválido',
          status: 'completed',
          createdAtEpochMs: Date.now(),
          userId: 1,
          transactionType: 'refund',
          category: 'operational',
          refundOfTransactionId: 42, // mesmo que databaseId!
          entries: [
            new LedgerEntry({ accountId: '1', amount: Money256.fromBigInt(100n, 1), type: 'debit' }),
            new LedgerEntry({ accountId: '2', amount: Money256.fromBigInt(100n, 1), type: 'credit' }),
          ],
        });
      }).toThrowError('A transaction cannot refund itself.');
    });
  });

  describe('07. BaseUnits Value Object (uint256 canonical bounds)', () => {
    it('deve fazer parse de base units canônicas corretas', () => {
      expect(parseCanonicalBaseUnits('0')).toBe('0');
      expect(parseCanonicalBaseUnits('100')).toBe('100');
    });

    it('deve rejeitar base units com casas decimais ou caracteres inválidos', () => {
      expect(() => parseCanonicalBaseUnits('10.5')).toThrowError(InvalidMoneyFormatError);
      expect(() => parseCanonicalBaseUnits('abc')).toThrowError(InvalidMoneyFormatError);
      expect(() => parseCanonicalBaseUnits('-10')).toThrowError(InvalidMoneyFormatError);
      expect(() => parseCanonicalBaseUnits('   ')).toThrowError(InvalidMoneyFormatError);
    });

    it('deve validar limites máximos de uint256 (2^256 - 1)', () => {
      const maxUint256 = (1n << 256n) - 1n;
      expect(parseCanonicalBaseUnits(maxUint256.toString())).toBe(maxUint256.toString());

      const overflowUint256 = maxUint256 + 1n;
      expect(() => parseCanonicalBaseUnits(overflowUint256.toString())).toThrowError(Money256OverflowError);
    });

    it('deve exigir estritamente positivo em parsePositiveCanonicalBaseUnits', () => {
      expect(parsePositiveCanonicalBaseUnits('1')).toBe('1');
      expect(() => parsePositiveCanonicalBaseUnits('0')).toThrowError(InvalidMoneyFormatError);
    });
  });
});

```

---

<a id="srcdomainsfinanceentitiesledgertransactionts"></a>
## Arquivo: `src/domains/finance/entities/LedgerTransaction.ts`

- **Caminho absoluto**: `/home/sandro/Área de trabalho/BackEnd/src/domains/finance/entities/LedgerTransaction.ts`
- **Total de linhas**: 1197
- **Linguagem**: TypeScript

```typescript
import {
  Money256,
  parsePositiveSafeIntegerId,
} from '../value-objects/Money256';

import type { LedgerEntryDirection } from '../value-objects/BaseUnits';

import {
  isLedgerEntryDirection,
} from '../value-objects/BaseUnits';

import { LedgerImbalanceError } from '../errors/LedgerImbalanceError';

import {
  InvalidLedgerTransactionError,
  InvalidMoneyFormatError,
  InvalidIdentifierError,
} from '../errors/FinancialError';

/**
 * ============================================================
 * LIMITES FÍSICOS DO DOMÍNIO
 * ============================================================
 *
 * O domínio financeiro trabalha com inteiros exatos.
 * Nenhum cálculo monetário deve utilizar number para montantes.
 */
const MAX_UINT256 = (1n << 256n) - 1n;

/**
 * Limite máximo suportado pelo objeto Date do JavaScript.
 *
 * O timestamp é armazenado internamente como integer epoch milliseconds.
 */
const MAX_VALID_DATE_EPOCH_MS = 8_640_000_000_000_000;

/**
 * ============================================================
 * STATUS DA TRANSAÇÃO
 * ============================================================
 */

export const FINANCIAL_TRANSACTION_STATUSES = Object.freeze([
  'pending',
  'processing',
  'completed',
  'failed',
  'cancelled',
  'reversed',
] as const);

export type FinancialTransactionStatus =
  (typeof FINANCIAL_TRANSACTION_STATUSES)[number];

export function isFinancialTransactionStatus(
  value: unknown
): value is FinancialTransactionStatus {
  return (
    typeof value === 'string' &&
    FINANCIAL_TRANSACTION_STATUSES.includes(
      value as FinancialTransactionStatus
    )
  );
}

/**
 * ============================================================
 * TIPOS FINANCEIROS CONHECIDOS
 * ============================================================
 *
 * KNOWN:
 * tudo que a arquitetura reconhece historicamente/conceitualmente.
 *
 * SUPPORTED:
 * aquilo que pode ser criado pela release operacional atual.
 *
 * IMPORTANTE:
 * "conversion" é conhecido, mas não suportado para criação.
 */
export const KNOWN_FINANCIAL_TRANSACTION_TYPES = Object.freeze([
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
] as const);

export type FinancialTransactionType =
  (typeof KNOWN_FINANCIAL_TRANSACTION_TYPES)[number];

/**
 * Alias de compatibilidade com consumidores existentes.
 *
 * Mantido congelado para evitar mutação acidental em runtime.
 */
export const FINANCIAL_TRANSACTION_TYPES =
  KNOWN_FINANCIAL_TRANSACTION_TYPES;

/**
 * Subconjunto efetivamente permitido para criação de
 * novas transações na release operacional atual.
 */
export const SUPPORTED_FINANCIAL_TRANSACTION_TYPES = Object.freeze([
  'deposit',
  'withdrawal',
  'transfer',
  'payment',
  'refund',
  'fee',
  'reward',
  'yield',
  'adjustment',
  'reversal',
] as const);

export type SupportedFinancialTransactionType =
  (typeof SUPPORTED_FINANCIAL_TRANSACTION_TYPES)[number];

export function isFinancialTransactionType(
  value: unknown
): value is FinancialTransactionType {
  return (
    typeof value === 'string' &&
    KNOWN_FINANCIAL_TRANSACTION_TYPES.includes(
      value as FinancialTransactionType
    )
  );
}

export function isSupportedFinancialTransactionType(
  value: unknown
): value is SupportedFinancialTransactionType {
  return (
    typeof value === 'string' &&
    SUPPORTED_FINANCIAL_TRANSACTION_TYPES.includes(
      value as SupportedFinancialTransactionType
    )
  );
}

/**
 * ============================================================
 * CATEGORIAS
 * ============================================================
 */

export const FINANCIAL_TRANSACTION_CATEGORIES = Object.freeze([
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
] as const);

export type FinancialTransactionCategory =
  (typeof FINANCIAL_TRANSACTION_CATEGORIES)[number];

export function isFinancialTransactionCategory(
  value: unknown
): value is FinancialTransactionCategory {
  return (
    typeof value === 'string' &&
    FINANCIAL_TRANSACTION_CATEGORIES.includes(
      value as FinancialTransactionCategory
    )
  );
}

/**
 * ============================================================
 * UUID V4
 * ============================================================
 */

const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Verifica somente o formato UUID v4.
 *
 * A função aceita whitespace externo para facilitar o tratamento
 * de input de borda; a forma canônica deve ser obtida via
 * normalizeUuidV4().
 */
export function isUuidV4(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    UUID_V4_REGEX.test(value.trim())
  );
}

/**
 * Normaliza UUID para forma canônica:
 * - string obrigatória
 * - UUID v4
 * - trim
 * - lowercase
 */
export function normalizeUuidV4(
  value: unknown,
  fieldName: string
): string {
  if (typeof value !== 'string') {
    throw new InvalidIdentifierError(
      `${fieldName} must be a valid UUID v4.`
    );
  }

  const normalized = value.trim().toLowerCase();

  if (!UUID_V4_REGEX.test(normalized)) {
    throw new InvalidIdentifierError(
      `${fieldName} must be a valid UUID v4.`
    );
  }

  return normalized;
}

/**
 * ============================================================
 * NORMALIZAÇÃO DE TEXTO
 * ============================================================
 *
 * A função:
 * - rejeita tipos não-string
 * - remove whitespace externo
 * - normaliza Unicode NFC
 * - rejeita string vazia
 * - limita tamanho
 * - bloqueia caracteres de controle
 */
function normalizeRequiredText(
  value: unknown,
  fieldName: string,
  maxLength: number
): string {
  if (typeof value !== 'string') {
    throw new InvalidLedgerTransactionError(
      `${fieldName} must be a string.`
    );
  }

  const normalized = value.trim().normalize('NFC');

  if (normalized.length === 0) {
    throw new InvalidLedgerTransactionError(
      `${fieldName} is required.`
    );
  }

  if (normalized.length > maxLength) {
    throw new InvalidLedgerTransactionError(
      `${fieldName} exceeds maximum length of ${maxLength} characters.`
    );
  }

  if (/[\u0000-\u001F\u007F]/u.test(normalized)) {
    throw new InvalidLedgerTransactionError(
      `${fieldName} contains forbidden control characters.`
    );
  }

  return normalized;
}

/**
 * Identificador opaco utilizado por LedgerEntry.
 *
 * Não é tratado como UUID obrigatório porque o ID de entry pode ser
 * um identificador de persistência/integração.
 */
function normalizeOptionalOpaqueIdentifier(
  value: unknown
): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== 'string') {
    throw new InvalidIdentifierError(
      'LedgerEntry id must be a string.'
    );
  }

  const normalized = value.trim().normalize('NFC');

  if (
    normalized.length === 0 ||
    normalized.length > 255 ||
    /[\u0000-\u001F\u007F]/u.test(normalized)
  ) {
    throw new InvalidIdentifierError(
      'Invalid LedgerEntry id.'
    );
  }

  return normalized;
}

/**
 * ============================================================
 * LEDGER ENTRY
 * ============================================================
 */

export type LedgerEntryType = LedgerEntryDirection;

export interface LedgerEntryProps {
  id?: string;
  accountId: string;
  amount: Money256;
  type: LedgerEntryDirection;
  description?: string;
}

export class LedgerEntry {
  public readonly id: string;
  public readonly accountId: string;
  public readonly amount: Money256;
  public readonly type: LedgerEntryDirection;
  public readonly description?: string;

  constructor(props: LedgerEntryProps) {
    if (!props || typeof props !== 'object') {
      throw new InvalidLedgerTransactionError(
        'LedgerEntry props must be a valid non-null object.'
      );
    }

    /**
     * --------------------------------------------------------
     * Entry ID
     * --------------------------------------------------------
     */
    const normalizedProvidedId =
      normalizeOptionalOpaqueIdentifier(props.id);

    this.id =
      normalizedProvidedId ??
      crypto.randomUUID().toLowerCase();

    /**
     * --------------------------------------------------------
     * Account ID
     * --------------------------------------------------------
     *
     * Mantido como string na entidade para preservar a representação
     * canônica e evitar conversões repetidas.
     */
    if (typeof props.accountId !== 'string') {
      throw new InvalidIdentifierError(
        'LedgerEntry accountId is required and must be a string.'
      );
    }

    const trimmedAccountId = props.accountId.trim();

    if (!/^[1-9]\d*$/.test(trimmedAccountId)) {
      throw new InvalidIdentifierError(
        'Invalid LedgerEntry accountId. Must be a positive integer string without signs, spaces or decimals.'
      );
    }

    const numericAccountId = Number(trimmedAccountId);

    if (
      !Number.isSafeInteger(numericAccountId) ||
      numericAccountId <= 0
    ) {
      throw new InvalidIdentifierError(
        'Invalid LedgerEntry accountId. Out of safe integer range.'
      );
    }

    /**
     * --------------------------------------------------------
     * Money256
     * --------------------------------------------------------
     */
    if (!props.amount) {
      throw new InvalidMoneyFormatError(
        'LedgerEntry amount is required.'
      );
    }

    if (!(props.amount instanceof Money256)) {
      throw new InvalidMoneyFormatError(
        'LedgerEntry amount must be an instance of Money256.'
      );
    }

    if (!props.amount.isPositive()) {
      throw new InvalidMoneyFormatError(
        'LedgerEntry amount must be strictly positive (> 0).'
      );
    }

    /**
     * --------------------------------------------------------
     * Direction
     * --------------------------------------------------------
     */
    if (!isLedgerEntryDirection(props.type)) {
      throw new InvalidLedgerTransactionError(
        'Invalid LedgerEntry direction. Must be "debit" or "credit".'
      );
    }

    /**
     * --------------------------------------------------------
     * Description opcional
     * --------------------------------------------------------
     */
    let normalizedDescription: string | undefined;

    if (
      props.description !== undefined &&
      props.description !== null
    ) {
      if (typeof props.description !== 'string') {
        throw new InvalidLedgerTransactionError(
          'LedgerEntry description must be a string.'
        );
      }

      const candidate = props.description
        .trim()
        .normalize('NFC');

      if (candidate.length > 255) {
        throw new InvalidLedgerTransactionError(
          'LedgerEntry description exceeds maximum length of 255 characters.'
        );
      }

      if (/[\u0000-\u001F\u007F]/u.test(candidate)) {
        throw new InvalidLedgerTransactionError(
          'LedgerEntry description contains forbidden control characters.'
        );
      }

      normalizedDescription =
        candidate.length > 0 ? candidate : undefined;
    }

    this.accountId = trimmedAccountId;
    this.amount = props.amount;
    this.type = props.type;
    this.description = normalizedDescription;

    /**
     * Garante imutabilidade estrutural em runtime.
     *
     * A imutabilidade do Money256 é responsabilidade do próprio VO.
     */
    Object.freeze(this);
  }
}

/**
 * ============================================================
 * CREATE CONTRACT
 * ============================================================
 *
 * Importante:
 * publicId NÃO é aceito pelo caller.
 * A identidade pública é sempre gerada pela própria entidade.
 *
 * createdAt também não é aceito pelo caller.
 * O timestamp é sempre gerado pelo servidor.
 */
export interface CreateLedgerTransactionProps {
  idempotencyKey: string;
  description: string;
  entries: readonly LedgerEntry[];
  userId?: number | null;
  transactionType: SupportedFinancialTransactionType;
  category: FinancialTransactionCategory;
  reversalOfTransactionId?: number;
  refundOfTransactionId?: number;
}

/**
 * ============================================================
 * PERSISTENCE SNAPSHOT
 * ============================================================
 *
 * O snapshot contém metadados específicos de persistência.
 */
export interface LedgerTransactionSnapshot {
  publicId: string;
  databaseId: number;
  idempotencyKey: string;
  description: string;
  entries: readonly LedgerEntry[];
  userId: number | null;
  transactionType: FinancialTransactionType;
  category: FinancialTransactionCategory;
  status: FinancialTransactionStatus;
  createdAtEpochMs: number;
  reversalOfTransactionId?: number;
  refundOfTransactionId?: number;
}

/**
 * ============================================================
 * LEDGER TRANSACTION
 * ============================================================
 */

export class LedgerTransaction {
  /**
   * Mantido como alias de compatibilidade com consumidores existentes.
   *
   * Preferir publicId em novo código.
   *
   * @deprecated Use publicId.
   */
  public readonly id: string;

  public readonly publicId: string;

  /**
   * Mantido temporariamente por compatibilidade com a infraestrutura
   * atual. Idealmente deve ficar apenas no Snapshot/Repository.
   *
   * @deprecated Persistence identity não deve fazer parte da API
   * de domínio em uma futura separação de bounded context.
   */
  public readonly databaseId?: number;

  public readonly idempotencyKey: string;
  public readonly description: string;
  public readonly entries: ReadonlyArray<LedgerEntry>;
  public readonly userId: number | null;
  public readonly transactionType: FinancialTransactionType;
  public readonly category: FinancialTransactionCategory;
  public readonly status: FinancialTransactionStatus;
  public readonly reversalOfTransactionId?: number;
  public readonly refundOfTransactionId?: number;

  private readonly createdAtEpochMs: number;

  /**
   * Getter defensivo.
   *
   * Cada chamada devolve uma nova Date e não expõe o estado interno.
   */
  public get createdAt(): Date {
    return new Date(this.createdAtEpochMs);
  }

  private constructor(params: {
    publicId: string;
    databaseId?: number;
    idempotencyKey: string;
    description: string;
    entries: readonly LedgerEntry[];
    userId: number | null;
    transactionType: FinancialTransactionType;
    category: FinancialTransactionCategory;
    status: FinancialTransactionStatus;
    createdAtEpochMs: number;
    reversalOfTransactionId?: number;
    refundOfTransactionId?: number;
  }) {
    this.publicId = params.publicId;
    this.id = params.publicId;
    this.databaseId = params.databaseId;
    this.idempotencyKey = params.idempotencyKey;
    this.description = params.description;

    /**
     * Cópia defensiva + congelamento do array.
     *
     * Os LedgerEntry já são imutáveis individualmente.
     */
    this.entries = Object.freeze([...params.entries]);

    this.userId = params.userId;
    this.transactionType = params.transactionType;
    this.category = params.category;
    this.status = params.status;
    this.createdAtEpochMs = params.createdAtEpochMs;
    this.reversalOfTransactionId =
      params.reversalOfTransactionId;
    this.refundOfTransactionId =
      params.refundOfTransactionId;

    /**
     * Congelamento do Aggregate Root.
     */
    Object.freeze(this);
  }

  /**
   * ==========================================================
   * FACTORY: CREATE
   * ==========================================================
   *
   * Cria uma nova transação.
   *
   * Invariantes desta factory:
   * - identidade gerada internamente
   * - timestamp gerado internamente
   * - status inicial = pending
   * - tipo deve ser suportado
   * - entries devem ser válidos
   * - double-entry balanceado
   */
  public static create(
    props: CreateLedgerTransactionProps
  ): LedgerTransaction {
    if (!props || typeof props !== 'object') {
      throw new InvalidLedgerTransactionError(
        'LedgerTransaction creation props must be a valid non-null object.'
      );
    }

    const idempotencyKey = normalizeRequiredText(
      props.idempotencyKey,
      'Idempotency key',
      255
    );

    const description = normalizeRequiredText(
      props.description,
      'Transaction description',
      255
    );

    LedgerTransaction.validateEntriesCollection(
      props.entries
    );

    let userId: number | null = null;

    if (
      props.userId !== undefined &&
      props.userId !== null
    ) {
      userId = parsePositiveSafeIntegerId(
        props.userId,
        'userId'
      );
    }

    /**
     * A interface já utiliza SupportedFinancialTransactionType.
     *
     * A validação runtime continua obrigatória porque a entrada pode
     * ter atravessado JSON/DTO/any antes de chegar aqui.
     */
    const rawTransactionType: unknown =
      props.transactionType;

    if (
      !isSupportedFinancialTransactionType(
        rawTransactionType
      )
    ) {
      throw new InvalidLedgerTransactionError(
        'Invalid or unsupported financial transaction type.'
      );
    }

    const transactionType = rawTransactionType;

    if (
      !isFinancialTransactionCategory(props.category)
    ) {
      throw new InvalidLedgerTransactionError(
        'Invalid financial transaction category.'
      );
    }

    /**
     * Verifica somente invariantes relacionais locais.
     *
     * Existência, ownership, estado original, limite cumulativo
     * de refund e unicidade de reversal são responsabilidade
     * de RefundPolicy/ReversalPolicy + persistência autoritativa.
     */
    const {
      reversalId,
      refundId,
    } = LedgerTransaction.validateRelationships(
      transactionType,
      props.reversalOfTransactionId,
      props.refundOfTransactionId
    );

    /**
     * Identidade pública criada internamente.
     */
    const publicId = crypto
      .randomUUID()
      .toLowerCase();

    /**
     * Tempo criado exclusivamente pelo servidor.
     */
    const createdAtEpochMs = Date.now();

    LedgerTransaction.validateCreatedAtEpochMs(
      createdAtEpochMs,
      'createdAtEpochMs'
    );

    /**
     * Validação contábil final.
     */
    LedgerTransaction.validateDoubleEntry(
      props.entries
    );

    return new LedgerTransaction({
      publicId,
      idempotencyKey,
      description,
      entries: props.entries,
      userId,
      transactionType,
      category: props.category,
      status: 'pending',
      createdAtEpochMs,
      reversalOfTransactionId: reversalId,
      refundOfTransactionId: refundId,
    });
  }

  /**
   * ==========================================================
   * FACTORY: REHYDRATE
   * ==========================================================
   *
   * DB -> Domain.
   *
   * Revalida:
   * - identidade
   * - IDs físicos
   * - strings
   * - entries
   * - unicidade
   * - enums
   * - relações
   * - timestamp
   * - double-entry
   */
  public static rehydrate(
    snapshot: LedgerTransactionSnapshot
  ): LedgerTransaction {
    if (!snapshot || typeof snapshot !== 'object') {
      throw new InvalidLedgerTransactionError(
        'LedgerTransaction rehydration snapshot must be a valid non-null object.'
      );
    }

    const publicId = normalizeUuidV4(
      snapshot.publicId,
      'snapshot.publicId'
    );

    const databaseId = parsePositiveSafeIntegerId(
      snapshot.databaseId,
      'databaseId'
    );

    const idempotencyKey = normalizeRequiredText(
      snapshot.idempotencyKey,
      'Idempotency key',
      255
    );

    const description = normalizeRequiredText(
      snapshot.description,
      'Transaction description',
      255
    );

    LedgerTransaction.validateEntriesCollection(
      snapshot.entries
    );

    let userId: number | null = null;

    if (
      snapshot.userId !== undefined &&
      snapshot.userId !== null
    ) {
      userId = parsePositiveSafeIntegerId(
        snapshot.userId,
        'userId'
      );
    }

    if (
      !isFinancialTransactionType(
        snapshot.transactionType
      )
    ) {
      throw new InvalidLedgerTransactionError(
        'Invalid transactionType on rehydration.'
      );
    }

    const transactionType =
      snapshot.transactionType;

    if (
      !isFinancialTransactionCategory(
        snapshot.category
      )
    ) {
      throw new InvalidLedgerTransactionError(
        'Invalid category on rehydration.'
      );
    }

    if (
      !isFinancialTransactionStatus(
        snapshot.status
      )
    ) {
      throw new InvalidLedgerTransactionError(
        'Invalid status on rehydration.'
      );
    }

    const {
      reversalId,
      refundId,
    } = LedgerTransaction.validateRelationships(
      transactionType,
      snapshot.reversalOfTransactionId,
      snapshot.refundOfTransactionId
    );

    /**
     * Auto-referência é uma invariante local.
     *
     * ReversalPolicy/RefundPolicy tratarão regras mais profundas,
     * como existência e estado da transação original.
     */
    if (
      reversalId !== undefined &&
      reversalId === databaseId
    ) {
      throw new InvalidLedgerTransactionError(
        'A transaction cannot reverse itself.'
      );
    }

    if (
      refundId !== undefined &&
      refundId === databaseId
    ) {
      throw new InvalidLedgerTransactionError(
        'A transaction cannot refund itself.'
      );
    }

    LedgerTransaction.validateCreatedAtEpochMs(
      snapshot.createdAtEpochMs,
      'createdAtEpochMs on rehydration'
    );

    LedgerTransaction.validateDoubleEntry(
      snapshot.entries
    );

    return new LedgerTransaction({
      publicId,
      databaseId,
      idempotencyKey,
      description,
      entries: snapshot.entries,
      userId,
      transactionType,
      category: snapshot.category,
      status: snapshot.status,
      createdAtEpochMs:
        snapshot.createdAtEpochMs,
      reversalOfTransactionId: reversalId,
      refundOfTransactionId: refundId,
    });
  }

  /**
   * ==========================================================
   * VALIDATE ENTRIES COLLECTION
   * ==========================================================
   *
   * A ordem das validações é intencional:
   *
   * 1. verifica se é array
   * 2. verifica limites
   * 3. verifica instâncias
   * 4. verifica IDs
   * 5. verifica debit/credit
   *
   * Isso evita TypeError antes do erro de domínio.
   */
  private static validateEntriesCollection(
    entries: readonly LedgerEntry[]
  ): void {
    if (!Array.isArray(entries)) {
      throw new InvalidLedgerTransactionError(
        'Transaction entries must be an array.'
      );
    }

    if (entries.length < 2) {
      throw new InvalidLedgerTransactionError(
        'Transaction must contain at least two entries.'
      );
    }

    if (entries.length > 100) {
      throw new InvalidLedgerTransactionError(
        'Transaction exceeds maximum limit of 100 entries.'
      );
    }

    const seenEntryIds = new Set<string>();

    let hasDebit = false;
    let hasCredit = false;

    for (const entry of entries) {
      /**
       * IMPORTANTE:
       * validar instanceof ANTES de acessar entry.type/id.
       */
      if (!(entry instanceof LedgerEntry)) {
        throw new InvalidLedgerTransactionError(
          'All entries must be valid instances of LedgerEntry.'
        );
      }

      if (seenEntryIds.has(entry.id)) {
        throw new InvalidLedgerTransactionError(
          'Transaction cannot contain duplicate ledger entry IDs.'
        );
      }

      seenEntryIds.add(entry.id);

      if (entry.type === 'debit') {
        hasDebit = true;
      } else if (entry.type === 'credit') {
        hasCredit = true;
      }
    }

    if (!hasDebit || !hasCredit) {
      throw new InvalidLedgerTransactionError(
        'Transaction must contain at least one debit and one credit entry.'
      );
    }
  }

  /**
   * ==========================================================
   * RELATIONSHIP SHAPE VALIDATION
   * ==========================================================
   *
   * Esta função NÃO consulta banco.
   *
   * Ela valida apenas a estrutura local:
   *
   * reversal:
   *   requires reversalOfTransactionId
   *
   * refund:
   *   requires refundOfTransactionId
   *
   * demais tipos:
   *   não podem carregar nenhum relationship ID
   *
   * Regras externas ficam em:
   *   ReversalPolicy
   *   RefundPolicy
   */
  private static validateRelationships(
    type: FinancialTransactionType,
    reversalId?: number,
    refundId?: number
  ): {
    reversalId?: number;
    refundId?: number;
  } {
    if (type === 'reversal') {
      if (
        reversalId === undefined ||
        reversalId === null
      ) {
        throw new InvalidLedgerTransactionError(
          'Reversal transaction requires reversalOfTransactionId.'
        );
      }

      const validatedReversalId =
        parsePositiveSafeIntegerId(
          reversalId,
          'reversalOfTransactionId'
        );

      if (
        refundId !== undefined &&
        refundId !== null
      ) {
        throw new InvalidLedgerTransactionError(
          'Reversal transaction cannot have refundOfTransactionId.'
        );
      }

      return {
        reversalId: validatedReversalId,
      };
    }

    if (type === 'refund') {
      if (
        refundId === undefined ||
        refundId === null
      ) {
        throw new InvalidLedgerTransactionError(
          'Refund transaction requires refundOfTransactionId.'
        );
      }

      const validatedRefundId =
        parsePositiveSafeIntegerId(
          refundId,
          'refundOfTransactionId'
        );

      if (
        reversalId !== undefined &&
        reversalId !== null
      ) {
        throw new InvalidLedgerTransactionError(
          'Refund transaction cannot have reversalOfTransactionId.'
        );
      }

      return {
        refundId: validatedRefundId,
      };
    }

    if (
      reversalId !== undefined &&
      reversalId !== null
    ) {
      throw new InvalidLedgerTransactionError(
        `reversalOfTransactionId is only valid for reversal transactions.`
      );
    }

    if (
      refundId !== undefined &&
      refundId !== null
    ) {
      throw new InvalidLedgerTransactionError(
        `refundOfTransactionId is only valid for refund transactions.`
      );
    }

    return {};
  }

  /**
   * ==========================================================
   * CREATED AT
   * ==========================================================
   */
  private static validateCreatedAtEpochMs(
    value: unknown,
    fieldName: string
  ): void {
    if (
      !Number.isSafeInteger(value) ||
      (value as number) <= 0 ||
      (value as number) > MAX_VALID_DATE_EPOCH_MS
    ) {
      throw new InvalidLedgerTransactionError(
        `${fieldName} must be a valid positive safe integer timestamp.`
      );
    }
  }

  /**
   * ==========================================================
   * DOUBLE ENTRY
   * ==========================================================
   *
   * FIN-001
   *
   * Para cada ativo:
   *
   *   SUM(debit) == SUM(credit)
   *
   * A matemática usa exclusivamente bigint.
   */
  private static validateDoubleEntry(
    entries: readonly LedgerEntry[]
  ): void {
    const balances = new Map<number, bigint>();

    for (const entry of entries) {
      /**
       * validateDoubleEntry é chamada somente após
       * validateEntriesCollection().
       *
       * Portanto entry já é LedgerEntry.
       */
      const assetId = entry.amount.assetId;

      const currentBalance =
        balances.get(assetId) ?? 0n;

      const amount = entry.amount.amount;

      /**
       * Proteção contra acumulador acima do limite físico.
       */
      if (
        amount < 0n ||
        amount > MAX_UINT256
      ) {
        throw new InvalidMoneyFormatError(
          'LedgerEntry amount exceeds the supported uint256 domain.'
        );
      }

      if (entry.type === 'debit') {
        const nextBalance =
          currentBalance + amount;

        /**
         * O acumulador absoluto não deve ultrapassar
         * o domínio uint256.
         */
        if (nextBalance > MAX_UINT256) {
          throw new InvalidMoneyFormatError(
            'Ledger transaction aggregate amount exceeds uint256 limits.'
          );
        }

        balances.set(
          assetId,
          nextBalance
        );
      } else {
        const nextBalance =
          currentBalance - amount;

        /**
         * Podemos aceitar um acumulador negativo durante
         * a demonstração matemática para depois detectar
         * imbalance.
         *
         * Não fazemos clamp e não usamos number.
         */
        balances.set(
          assetId,
          nextBalance
        );
      }
    }

    for (const [
      assetId,
      balance,
    ] of balances.entries()) {
      if (balance !== 0n) {
        throw new LedgerImbalanceError(
          `Double-entry validation failed for asset #${assetId}: Debits and Credits do not balance (Diff: ${balance.toString()}).`
        );
      }
    }
  }
}

```

---

<a id="srcdomainsfinanceerrorsfinancialerrorts"></a>
## Arquivo: `src/domains/finance/errors/FinancialError.ts`

- **Caminho absoluto**: `/home/sandro/Área de trabalho/BackEnd/src/domains/finance/errors/FinancialError.ts`
- **Total de linhas**: 138
- **Linguagem**: TypeScript

```typescript
export abstract class FinancialError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly retryable: boolean = false,
    public readonly httpStatus: number = 400
  ) {
    super(message);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class InsufficientBalanceError extends FinancialError {
  constructor(message: string = 'Saldo insuficiente para a operação financeira.') {
    super(message, 'INSUFFICIENT_BALANCE', false, 422);
  }
}

export class OptimisticConcurrencyError extends FinancialError {
  constructor(message: string = 'Conflito de concorrência otimista (OCC). Recarregue e tente novamente.') {
    super(message, 'OCC_CONFLICT', true, 409);
  }
}

export class IdempotencyConflictError extends FinancialError {
  constructor(message: string = 'Conflito de idempotência: Mesma chave fornecida com payload divergente.') {
    super(message, 'IDEMPOTENCY_HASH_MISMATCH', false, 409);
  }
}

export class IdempotencyInProgressError extends FinancialError {
  constructor(message: string = 'Transação em processamento com esta chave de idempotência.') {
    super(message, 'IDEMPOTENCY_IN_PROGRESS', true, 409);
  }
}

export class InvalidStateTransitionError extends FinancialError {
  constructor(message: string = 'Transição de estado inválida para a transação financeira.') {
    super(message, 'INVALID_STATE_TRANSITION', false, 422);
  }
}

export class ReversalAlreadyExistsError extends FinancialError {
  constructor(message: string = 'A transação já foi estornada anteriormente.') {
    super(message, 'REVERSAL_ALREADY_EXISTS', false, 409);
  }
}

export class ExternalEventPayloadConflictError extends FinancialError {
  constructor(message: string = 'Evento externo com mesmo providerId e externalEventId possui payload divergente.') {
    super(message, 'EXTERNAL_EVENT_PAYLOAD_CONFLICT', false, 409);
  }
}

export class AccountInactiveError extends FinancialError {
  constructor(message: string = 'Conta financeira inativa ou suspensa.') {
    super(message, 'ACCOUNT_INACTIVE', false, 422);
  }
}

export class AssetInactiveError extends FinancialError {
  constructor(message: string = 'Ativo financeiro inativo.') {
    super(message, 'ASSET_INACTIVE', false, 422);
  }
}

export class Money256OverflowError extends FinancialError {
  constructor(message: string = 'Valor excede o limite máximo permitido de 256 bits (2^256 - 1).') {
    super(message, 'MONEY_256_OVERFLOW', false, 400);
  }
}

export class InvalidMoneyFormatError extends FinancialError {
  constructor(message: string = 'Formato numérico inválido. Deve ser string decimal canônica sem expoente, sinal ou zeros à esquerda.') {
    super(message, 'INVALID_MONEY_FORMAT', false, 400);
  }
}

export class CurrencyMismatchError extends FinancialError {
  constructor(message: string = 'Operação proibida entre ativos/moedas diferentes.') {
    super(message, 'CURRENCY_MISMATCH', false, 422);
  }
}

export class MoneyUnderflowError extends FinancialError {
  constructor(message: string = 'Subtração resultando em saldo negativo é proibida (underflow).') {
    super(message, 'MONEY_UNDERFLOW', false, 422);
  }
}

export class InvalidIdentifierError extends FinancialError {
  constructor(message: string = 'Identificador físico inválido.') {
    super(message, 'INVALID_IDENTIFIER', false, 400);
  }
}

export class InvalidRefundAmountError extends FinancialError {
  constructor(message: string = 'Valor de reembolso inválido ou excede o montante da transação original.') {
    super(message, 'INVALID_REFUND_AMOUNT', false, 422);
  }
}

export class UnsupportedFinancialOperationError extends FinancialError {
  constructor(message: string = 'Operação financeira não suportada.') {
    super(message, 'UNSUPPORTED_FINANCIAL_OPERATION', false, 400);
  }
}

export class InvalidFinancialOperationError extends FinancialError {
  constructor(message: string = 'Operação financeira inválida ou parâmetros inconsistentes.') {
    super(message, 'INVALID_FINANCIAL_OPERATION', false, 400);
  }
}

export class AccountOwnershipError extends FinancialError {
  constructor(message: string = 'Conflito de propriedade da conta ou transação financeira.') {
    super(message, 'ACCOUNT_OWNERSHIP_MISMATCH', false, 403);
  }
}

export class InvalidAccountClassError extends FinancialError {
  constructor(accountTypeOrMessage: string = 'Classe contábil inválida ou não suportada.', accountClass?: string) {
    const message = accountClass
      ? `Classe de conta "${accountClass}" é incompatível com o tipo de conta "${accountTypeOrMessage}".`
      : accountTypeOrMessage;
    super(message, 'INVALID_ACCOUNT_CLASS', false, 422);
  }
}

export class InvalidLedgerTransactionError extends FinancialError {
  constructor(message: string = 'Transação contábil do ledger inválida ou viola os invariantes de partidas dobradas.') {
    super(message, 'INVALID_LEDGER_TRANSACTION', false, 422);
  }
}




```

---

<a id="srcdomainsfinanceerrorsledgerimbalanceerrorts"></a>
## Arquivo: `src/domains/finance/errors/LedgerImbalanceError.ts`

- **Caminho absoluto**: `/home/sandro/Área de trabalho/BackEnd/src/domains/finance/errors/LedgerImbalanceError.ts`
- **Total de linhas**: 10
- **Linguagem**: TypeScript

```typescript
import { FinancialError } from './FinancialError';

export class LedgerImbalanceError extends FinancialError {
  constructor(
    message: string = 'A transação não está balanceada. A soma dos débitos deve ser exatamente igual à soma dos créditos.'
  ) {
    super(message, 'LEDGER_IMBALANCE', false, 422);
  }
}


```

---

<a id="srcdomainsfinancepoliciesaccountclasspolicyts"></a>
## Arquivo: `src/domains/finance/policies/AccountClassPolicy.ts`

- **Caminho absoluto**: `/home/sandro/Área de trabalho/BackEnd/src/domains/finance/policies/AccountClassPolicy.ts`
- **Total de linhas**: 209
- **Linguagem**: TypeScript

```typescript
import { InvalidAccountClassError } from '../errors/FinancialError';

export type FinancialAccountType =
  | 'user_available'
  | 'treasury'
  | 'operating'
  | 'fees'
  | 'reserve'
  | 'escrow'
  | 'reward_expense'
  | 'yield_expense'
  | 'clearing'
  | 'opening_balance_equity'
  | 'payment_revenue'
  | 'refund_expense';

export type FinancialAccountClass =
  | 'asset'
  | 'liability'
  | 'revenue'
  | 'expense'
  | 'equity';

const PERMITTED_CLASSES: Readonly<
  Record<FinancialAccountType, readonly FinancialAccountClass[]>
> = Object.freeze({
  user_available: Object.freeze(['liability'] as const),
  treasury: Object.freeze(['asset'] as const),
  operating: Object.freeze(['asset'] as const),
  fees: Object.freeze(['revenue'] as const),
  reserve: Object.freeze(['asset', 'liability'] as const),
  escrow: Object.freeze(['liability'] as const),
  reward_expense: Object.freeze(['expense'] as const),
  yield_expense: Object.freeze(['expense'] as const),
  clearing: Object.freeze(['asset', 'liability'] as const),
  opening_balance_equity: Object.freeze(['equity', 'liability'] as const),
  payment_revenue: Object.freeze(['revenue'] as const),
  refund_expense: Object.freeze(['expense'] as const),
});

export class AccountClassPolicy {
  /**
   * Valida se o tipo de conta pode utilizar a classe contábil informada.
   *
   * A assinatura continua aceitando string para preservar compatibilidade
   * com callers existentes. A validação real ocorre em runtime.
   */
  public static validate(
    accountType: string,
    accountClass: string
  ): void {
    if (
      typeof accountType !== 'string' ||
      accountType.trim().length === 0
    ) {
      throw new InvalidAccountClassError(
        String(accountType),
        String(accountClass)
      );
    }

    if (
      typeof accountClass !== 'string' ||
      accountClass.trim().length === 0
    ) {
      throw new InvalidAccountClassError(
        accountType,
        String(accountClass)
      );
    }

    const normalizedAccountType = accountType.trim();
    const normalizedAccountClass = accountClass.trim();

    if (!AccountClassPolicy.isFinancialAccountType(normalizedAccountType)) {
      throw new InvalidAccountClassError(
        normalizedAccountType,
        normalizedAccountClass
      );
    }

    if (
      !AccountClassPolicy.isFinancialAccountClass(
        normalizedAccountClass
      )
    ) {
      throw new InvalidAccountClassError(
        normalizedAccountType,
        normalizedAccountClass
      );
    }

    const allowed = PERMITTED_CLASSES[normalizedAccountType];

    if (
      !(allowed as readonly string[]).includes(
        normalizedAccountClass
      )
    ) {
      throw new InvalidAccountClassError(
        normalizedAccountType,
        normalizedAccountClass
      );
    }
  }

  /**
   * Retorna a classe default somente quando houver exatamente uma
   * classe possível.
   *
   * Nunca escolhe arbitrariamente a primeira opção de uma matriz
   * que possua múltiplas classes permitidas.
   */
  public static getDefaultClass(
    accountType: string
  ): FinancialAccountClass {
    if (
      typeof accountType !== 'string' ||
      accountType.trim().length === 0
    ) {
      throw new InvalidAccountClassError(
        String(accountType),
        'default_not_deterministic'
      );
    }

    const normalizedAccountType = accountType.trim();

    if (
      !AccountClassPolicy.isFinancialAccountType(
        normalizedAccountType
      )
    ) {
      throw new InvalidAccountClassError(
        normalizedAccountType,
        'unknown'
      );
    }

    const allowed = PERMITTED_CLASSES[normalizedAccountType];

    if (allowed.length !== 1) {
      throw new InvalidAccountClassError(
        normalizedAccountType,
        'default_not_deterministic'
      );
    }

    return allowed[0];
  }

  /**
   * Runtime type guard para tipos de conta conhecidos.
   */
  public static isFinancialAccountType(
    value: unknown
  ): value is FinancialAccountType {
    return (
      typeof value === 'string' &&
      Object.prototype.hasOwnProperty.call(
        PERMITTED_CLASSES,
        value
      )
    );
  }

  /**
   * Runtime type guard para classes contábeis conhecidas.
   */
  public static isFinancialAccountClass(
    value: unknown
  ): value is FinancialAccountClass {
    return (
      value === 'asset' ||
      value === 'liability' ||
      value === 'revenue' ||
      value === 'expense' ||
      value === 'equity'
    );
  }

  /**
   * Retorna a lista imutável de classes permitidas para o tipo informado.
   *
   * A estrutura retornada não pode ser modificada porque tanto a matriz
   * externa quanto suas listas internas são Object.freeze().
   */
  public static getPermittedClasses(
    accountType: string
  ): readonly FinancialAccountClass[] {
    if (typeof accountType !== 'string') {
      throw new InvalidAccountClassError(
        String(accountType),
        'unknown'
      );
    }

    const normalized = accountType.trim();

    if (!AccountClassPolicy.isFinancialAccountType(normalized)) {
      throw new InvalidAccountClassError(
        normalized,
        'unknown'
      );
    }

    return PERMITTED_CLASSES[normalized];
  }
}

```

---

<a id="srcdomainsfinancepoliciesaccountingentrypolicyts"></a>
## Arquivo: `src/domains/finance/policies/AccountingEntryPolicy.ts`

- **Caminho absoluto**: `/home/sandro/Área de trabalho/BackEnd/src/domains/finance/policies/AccountingEntryPolicy.ts`
- **Total de linhas**: 1454
- **Linguagem**: TypeScript

```typescript
import {
  Money256,
  parsePositiveSafeIntegerId,
} from '../value-objects/Money256';

import { FinancialError } from '../errors/FinancialError';

import type { FinancialLedgerEntryRecord } from '../contracts/FinancialLedgerEntryRecord';

import type {
  FinancialTransactionType,
  FinancialTransactionCategory,
} from '../entities/LedgerTransaction';

export type LedgerEntryDirection = 'debit' | 'credit';

export interface RawLedgerEntrySpec {
  accountId: number;
  assetId: number;
  entryType: LedgerEntryDirection;
  amount: Money256;
  description: string;
}

export interface AccountingContext {
  transactionType: FinancialTransactionType;
  category?: FinancialTransactionCategory;
  source?: string;
  destination?: string;
  assetId: number;
  feeType?: string;
  businessReason?: string;
  authorizedByUserId?: number;
  auditRef?: string;
}

export class AccountingMatrixValidationError extends FinancialError {
  constructor(message: string) {
    super(
      message,
      'ACCOUNTING_MATRIX_VALIDATION_FAILED',
      false,
      422
    );
  }
}

const MAX_UINT256 = (1n << 256n) - 1n;

const MAX_LEDGER_ENTRIES = 100;

const MAX_DESCRIPTION_LENGTH = 2000;

export class AccountingEntryPolicy {
  /**
   * 1. DEPOSIT:
   *
   * Dr Treasury Asset (+Ativo)
   * Cr User Available (+Passivo)
   */
  public static createDepositEntries(params: {
    treasuryAccountId: number;
    userAccountId: number;
    amount: Money256;
    description: string;
  }): RawLedgerEntrySpec[] {
    AccountingEntryPolicy.assertOperationParams(params);

    AccountingEntryPolicy.assertPositiveAmount(params.amount);

    const amount =
      AccountingEntryPolicy.assertMoney256(params.amount);

    const description =
      AccountingEntryPolicy.normalizeDescription(
        params.description
      );

    const treasuryAccountId =
      parsePositiveSafeIntegerId(
        params.treasuryAccountId,
        'treasuryAccountId'
      );

    const userAccountId =
      parsePositiveSafeIntegerId(
        params.userAccountId,
        'userAccountId'
      );

    AccountingEntryPolicy.assertDistinctAccounts(
      treasuryAccountId,
      userAccountId,
      'A conta de treasury e a conta do usuário não podem ser idênticas em um depósito.'
    );

    const entries: RawLedgerEntrySpec[] = [
      AccountingEntryPolicy.createEntry({
        accountId: treasuryAccountId,
        assetId: amount.assetId,
        entryType: 'debit',
        amount,
        description:
          `Deposit Treasury Debit: ${description}`,
      }),
      AccountingEntryPolicy.createEntry({
        accountId: userAccountId,
        assetId: amount.assetId,
        entryType: 'credit',
        amount,
        description:
          `Deposit User Credit: ${description}`,
      }),
    ];

    AccountingEntryPolicy.validateEntriesBalance(entries);

    return entries;
  }

  /**
   * 2. WITHDRAWAL:
   *
   * Dr User Available (-Passivo)
   * Cr Treasury Asset (-Ativo)
   */
  public static createWithdrawalEntries(params: {
    treasuryAccountId: number;
    userAccountId: number;
    amount: Money256;
    description: string;
  }): RawLedgerEntrySpec[] {
    AccountingEntryPolicy.assertOperationParams(params);

    AccountingEntryPolicy.assertPositiveAmount(params.amount);

    const amount =
      AccountingEntryPolicy.assertMoney256(params.amount);

    const description =
      AccountingEntryPolicy.normalizeDescription(
        params.description
      );

    const treasuryAccountId =
      parsePositiveSafeIntegerId(
        params.treasuryAccountId,
        'treasuryAccountId'
      );

    const userAccountId =
      parsePositiveSafeIntegerId(
        params.userAccountId,
        'userAccountId'
      );

    AccountingEntryPolicy.assertDistinctAccounts(
      treasuryAccountId,
      userAccountId,
      'A conta de treasury e a conta do usuário não podem ser idênticas em uma retirada.'
    );

    const entries: RawLedgerEntrySpec[] = [
      AccountingEntryPolicy.createEntry({
        accountId: userAccountId,
        assetId: amount.assetId,
        entryType: 'debit',
        amount,
        description:
          `Withdrawal User Debit: ${description}`,
      }),
      AccountingEntryPolicy.createEntry({
        accountId: treasuryAccountId,
        assetId: amount.assetId,
        entryType: 'credit',
        amount,
        description:
          `Withdrawal Treasury Credit: ${description}`,
      }),
    ];

    AccountingEntryPolicy.validateEntriesBalance(entries);

    return entries;
  }

  /**
   * 3. TRANSFER:
   *
   * Dr Source User (-Passivo)
   * Cr Target User (+Passivo)
   */
  public static createTransferEntries(params: {
    sourceAccountId: number;
    destinationAccountId: number;
    amount: Money256;
    description: string;
  }): RawLedgerEntrySpec[] {
    AccountingEntryPolicy.assertOperationParams(params);

    AccountingEntryPolicy.assertPositiveAmount(params.amount);

    const amount =
      AccountingEntryPolicy.assertMoney256(params.amount);

    const description =
      AccountingEntryPolicy.normalizeDescription(
        params.description
      );

    const sourceAcc =
      parsePositiveSafeIntegerId(
        params.sourceAccountId,
        'sourceAccountId'
      );

    const destAcc =
      parsePositiveSafeIntegerId(
        params.destinationAccountId,
        'destinationAccountId'
      );

    AccountingEntryPolicy.assertDistinctAccounts(
      sourceAcc,
      destAcc,
      'Conta de origem e destino não podem ser idênticas em uma transferência.'
    );

    const entries: RawLedgerEntrySpec[] = [
      AccountingEntryPolicy.createEntry({
        accountId: sourceAcc,
        assetId: amount.assetId,
        entryType: 'debit',
        amount,
        description:
          `Transfer Debit: ${description}`,
      }),
      AccountingEntryPolicy.createEntry({
        accountId: destAcc,
        assetId: amount.assetId,
        entryType: 'credit',
        amount,
        description:
          `Transfer Credit: ${description}`,
      }),
    ];

    AccountingEntryPolicy.validateEntriesBalance(entries);

    return entries;
  }

  /**
   * 4. PAYMENT:
   *
   * Dr User Available (-Passivo)
   * Cr Payment Revenue (+Receita)
   */
  public static createPaymentEntries(params: {
    userAccountId: number;
    paymentRevenueAccountId: number;
    amount: Money256;
    description: string;
  }): RawLedgerEntrySpec[] {
    AccountingEntryPolicy.assertOperationParams(params);

    AccountingEntryPolicy.assertPositiveAmount(params.amount);

    const amount =
      AccountingEntryPolicy.assertMoney256(params.amount);

    const description =
      AccountingEntryPolicy.normalizeDescription(
        params.description
      );

    const userAccountId =
      parsePositiveSafeIntegerId(
        params.userAccountId,
        'userAccountId'
      );

    const paymentRevenueAccountId =
      parsePositiveSafeIntegerId(
        params.paymentRevenueAccountId,
        'paymentRevenueAccountId'
      );

    AccountingEntryPolicy.assertDistinctAccounts(
      userAccountId,
      paymentRevenueAccountId,
      'A conta do usuário e a conta de receita do pagamento não podem ser idênticas.'
    );

    const entries: RawLedgerEntrySpec[] = [
      AccountingEntryPolicy.createEntry({
        accountId: userAccountId,
        assetId: amount.assetId,
        entryType: 'debit',
        amount,
        description:
          `Payment User Debit: ${description}`,
      }),
      AccountingEntryPolicy.createEntry({
        accountId: paymentRevenueAccountId,
        assetId: amount.assetId,
        entryType: 'credit',
        amount,
        description:
          `Payment Revenue Credit: ${description}`,
      }),
    ];

    AccountingEntryPolicy.validateEntriesBalance(entries);

    return entries;
  }

  /**
   * 5. REFUND:
   *
   * Dr Refund Expense (+Despesa)
   * Cr User Available (+Passivo)
   */
  public static createRefundEntries(params: {
    refundExpenseAccountId: number;
    userAccountId: number;
    amount: Money256;
    description: string;
  }): RawLedgerEntrySpec[] {
    AccountingEntryPolicy.assertOperationParams(params);

    AccountingEntryPolicy.assertPositiveAmount(params.amount);

    const amount =
      AccountingEntryPolicy.assertMoney256(params.amount);

    const description =
      AccountingEntryPolicy.normalizeDescription(
        params.description
      );

    const refundExpenseAccountId =
      parsePositiveSafeIntegerId(
        params.refundExpenseAccountId,
        'refundExpenseAccountId'
      );

    const userAccountId =
      parsePositiveSafeIntegerId(
        params.userAccountId,
        'userAccountId'
      );

    AccountingEntryPolicy.assertDistinctAccounts(
      refundExpenseAccountId,
      userAccountId,
      'A conta de despesa de refund e a conta do usuário não podem ser idênticas.'
    );

    const entries: RawLedgerEntrySpec[] = [
      AccountingEntryPolicy.createEntry({
        accountId: refundExpenseAccountId,
        assetId: amount.assetId,
        entryType: 'debit',
        amount,
        description:
          `Refund Expense Debit: ${description}`,
      }),
      AccountingEntryPolicy.createEntry({
        accountId: userAccountId,
        assetId: amount.assetId,
        entryType: 'credit',
        amount,
        description:
          `Refund User Credit: ${description}`,
      }),
    ];

    AccountingEntryPolicy.validateEntriesBalance(entries);

    return entries;
  }

  /**
   * 6. FEE:
   *
   * Dr User Available (-Passivo)
   * Cr Fees Revenue (+Receita)
   */
  public static createFeeEntries(params: {
    userAccountId: number;
    feeAccountId: number;
    amount: Money256;
    description: string;
  }): RawLedgerEntrySpec[] {
    AccountingEntryPolicy.assertOperationParams(params);

    AccountingEntryPolicy.assertPositiveAmount(params.amount);

    const amount =
      AccountingEntryPolicy.assertMoney256(params.amount);

    const description =
      AccountingEntryPolicy.normalizeDescription(
        params.description
      );

    const userAccountId =
      parsePositiveSafeIntegerId(
        params.userAccountId,
        'userAccountId'
      );

    const feeAccountId =
      parsePositiveSafeIntegerId(
        params.feeAccountId,
        'feeAccountId'
      );

    AccountingEntryPolicy.assertDistinctAccounts(
      userAccountId,
      feeAccountId,
      'A conta do usuário e a conta de receitas de fee não podem ser idênticas.'
    );

    const entries: RawLedgerEntrySpec[] = [
      AccountingEntryPolicy.createEntry({
        accountId: userAccountId,
        assetId: amount.assetId,
        entryType: 'debit',
        amount,
        description:
          `Fee User Debit: ${description}`,
      }),
      AccountingEntryPolicy.createEntry({
        accountId: feeAccountId,
        assetId: amount.assetId,
        entryType: 'credit',
        amount,
        description:
          `Fee Revenue Credit: ${description}`,
      }),
    ];

    AccountingEntryPolicy.validateEntriesBalance(entries);

    return entries;
  }

  /**
   * 7. REWARD:
   *
   * Dr Reward Expense (+Despesa)
   * Cr User Available (+Passivo)
   */
  public static createRewardEntries(params: {
    rewardExpenseAccountId: number;
    userAccountId: number;
    amount: Money256;
    description: string;
  }): RawLedgerEntrySpec[] {
    AccountingEntryPolicy.assertOperationParams(params);

    AccountingEntryPolicy.assertPositiveAmount(params.amount);

    const amount =
      AccountingEntryPolicy.assertMoney256(params.amount);

    const description =
      AccountingEntryPolicy.normalizeDescription(
        params.description
      );

    const rewardExpenseAccountId =
      parsePositiveSafeIntegerId(
        params.rewardExpenseAccountId,
        'rewardExpenseAccountId'
      );

    const userAccountId =
      parsePositiveSafeIntegerId(
        params.userAccountId,
        'userAccountId'
      );

    AccountingEntryPolicy.assertDistinctAccounts(
      rewardExpenseAccountId,
      userAccountId,
      'A conta de despesa de reward e a conta do usuário não podem ser idênticas.'
    );

    const entries: RawLedgerEntrySpec[] = [
      AccountingEntryPolicy.createEntry({
        accountId: rewardExpenseAccountId,
        assetId: amount.assetId,
        entryType: 'debit',
        amount,
        description:
          `Reward Expense Debit: ${description}`,
      }),
      AccountingEntryPolicy.createEntry({
        accountId: userAccountId,
        assetId: amount.assetId,
        entryType: 'credit',
        amount,
        description:
          `Reward User Credit: ${description}`,
      }),
    ];

    AccountingEntryPolicy.validateEntriesBalance(entries);

    return entries;
  }

  /**
   * 8. YIELD:
   *
   * Dr Yield Expense (+Despesa)
   * Cr User Available (+Passivo)
   */
  public static createYieldEntries(params: {
    yieldExpenseAccountId: number;
    userAccountId: number;
    amount: Money256;
    description: string;
  }): RawLedgerEntrySpec[] {
    AccountingEntryPolicy.assertOperationParams(params);

    AccountingEntryPolicy.assertPositiveAmount(params.amount);

    const amount =
      AccountingEntryPolicy.assertMoney256(params.amount);

    const description =
      AccountingEntryPolicy.normalizeDescription(
        params.description
      );

    const yieldExpenseAccountId =
      parsePositiveSafeIntegerId(
        params.yieldExpenseAccountId,
        'yieldExpenseAccountId'
      );

    const userAccountId =
      parsePositiveSafeIntegerId(
        params.userAccountId,
        'userAccountId'
      );

    AccountingEntryPolicy.assertDistinctAccounts(
      yieldExpenseAccountId,
      userAccountId,
      'A conta de despesa de yield e a conta do usuário não podem ser idênticas.'
    );

    const entries: RawLedgerEntrySpec[] = [
      AccountingEntryPolicy.createEntry({
        accountId: yieldExpenseAccountId,
        assetId: amount.assetId,
        entryType: 'debit',
        amount,
        description:
          `Yield Expense Debit: ${description}`,
      }),
      AccountingEntryPolicy.createEntry({
        accountId: userAccountId,
        assetId: amount.assetId,
        entryType: 'credit',
        amount,
        description:
          `Yield User Credit: ${description}`,
      }),
    ];

    AccountingEntryPolicy.validateEntriesBalance(entries);

    return entries;
  }

  /**
   * 9. CONVERSION:
   *
   * Leg 1 (FromAsset):
   *   Dr User / Cr Clearing
   *
   * Leg 2 (ToAsset):
   *   Dr Clearing / Cr User
   *
   * A cotação, slippage, taxa e demais regras econômicas da conversão
   * continuam pertencendo ao Use Case Forex especializado.
   */
  public static createConversionEntries(params: {
    userAccountId: number;
    clearingAccountId: number;
    fromAmount: Money256;
    toAmount: Money256;
    description: string;
  }): RawLedgerEntrySpec[] {
    AccountingEntryPolicy.assertOperationParams(params);

    AccountingEntryPolicy.assertPositiveAmount(
      params.fromAmount
    );

    AccountingEntryPolicy.assertPositiveAmount(
      params.toAmount
    );

    const fromAmount =
      AccountingEntryPolicy.assertMoney256(
        params.fromAmount
      );

    const toAmount =
      AccountingEntryPolicy.assertMoney256(
        params.toAmount
      );

    if (fromAmount.assetId === toAmount.assetId) {
      throw new AccountingMatrixValidationError(
        'Conversão exige ativos distintos.'
      );
    }

    const description =
      AccountingEntryPolicy.normalizeDescription(
        params.description
      );

    const userAcc =
      parsePositiveSafeIntegerId(
        params.userAccountId,
        'userAccountId'
      );

    const clearingAcc =
      parsePositiveSafeIntegerId(
        params.clearingAccountId,
        'clearingAccountId'
      );

    AccountingEntryPolicy.assertDistinctAccounts(
      userAcc,
      clearingAcc,
      'A conta do usuário e a conta de clearing não podem ser idênticas em uma conversão.'
    );

    const entries: RawLedgerEntrySpec[] = [
      AccountingEntryPolicy.createEntry({
        accountId: userAcc,
        assetId: fromAmount.assetId,
        entryType: 'debit',
        amount: fromAmount,
        description:
          `Conversion Debit FromAsset: ${description}`,
      }),
      AccountingEntryPolicy.createEntry({
        accountId: clearingAcc,
        assetId: fromAmount.assetId,
        entryType: 'credit',
        amount: fromAmount,
        description:
          `Conversion Clearing Credit FromAsset: ${description}`,
      }),
      AccountingEntryPolicy.createEntry({
        accountId: clearingAcc,
        assetId: toAmount.assetId,
        entryType: 'debit',
        amount: toAmount,
        description:
          `Conversion Clearing Debit ToAsset: ${description}`,
      }),
      AccountingEntryPolicy.createEntry({
        accountId: userAcc,
        assetId: toAmount.assetId,
        entryType: 'credit',
        amount: toAmount,
        description:
          `Conversion Credit ToAsset: ${description}`,
      }),
    ];

    AccountingEntryPolicy.validateEntriesBalance(entries);

    return entries;
  }

  /**
   * 10. ADJUSTMENT:
   *
   * Lançamento de ajuste com identificação auditável explícita.
   *
   * IMPORTANTE:
   * authorizedByUserId representa a identidade declarada do autor.
   * Não representa, sozinho, autorização.
   *
   * A autorização efetiva deve ser garantida pelo Use Case/RBAC.
   */
  public static createAdjustmentEntries(params: {
    debitAccountId: number;
    creditAccountId: number;
    amount: Money256;
    reason: string;
    authorizedByUserId: number;
  }): RawLedgerEntrySpec[] {
    AccountingEntryPolicy.assertOperationParams(params);

    AccountingEntryPolicy.assertPositiveAmount(params.amount);

    const reason =
      AccountingEntryPolicy.normalizeRequiredReason(
        params.reason,
        'Lançamento de ajuste exige justificativa auditável.'
      );

    const authorizedBy =
      parsePositiveSafeIntegerId(
        params.authorizedByUserId,
        'authorizedByUserId'
      );

    const debAcc =
      parsePositiveSafeIntegerId(
        params.debitAccountId,
        'debitAccountId'
      );

    const credAcc =
      parsePositiveSafeIntegerId(
        params.creditAccountId,
        'creditAccountId'
      );

    AccountingEntryPolicy.assertDistinctAccounts(
      debAcc,
      credAcc,
      'Conta de débito e conta de crédito não podem ser idênticas em um ajuste.'
    );

    const amount =
      AccountingEntryPolicy.assertMoney256(params.amount);

    const entries: RawLedgerEntrySpec[] = [
      AccountingEntryPolicy.createEntry({
        accountId: debAcc,
        assetId: amount.assetId,
        entryType: 'debit',
        amount,
        description:
          `Adjustment Debit (AuthUser #${authorizedBy}): ${reason}`,
      }),
      AccountingEntryPolicy.createEntry({
        accountId: credAcc,
        assetId: amount.assetId,
        entryType: 'credit',
        amount,
        description:
          `Adjustment Credit (AuthUser #${authorizedBy}): ${reason}`,
      }),
    ];

    AccountingEntryPolicy.validateEntriesBalance(entries);

    return entries;
  }

  /**
   * 11. REVERSAL:
   *
   * Inversão exata dos lançamentos da transação original.
   *
   * A decisão de que determinada transação pode ser revertida
   * pertence à ReversalPolicy / State Machine / Orchestrator.
   */
  public static createReversalEntries(
    originalEntries: RawLedgerEntrySpec[],
    reason: string
  ): RawLedgerEntrySpec[] {
    if (
      !Array.isArray(originalEntries) ||
      originalEntries.length === 0
    ) {
      throw new AccountingMatrixValidationError(
        'Não há lançamentos originais para estornar.'
      );
    }

    if (
      originalEntries.length > MAX_LEDGER_ENTRIES
    ) {
      throw new AccountingMatrixValidationError(
        `A transação não pode possuir mais de ${MAX_LEDGER_ENTRIES} lançamentos.`
      );
    }

    const normalizedReason =
      AccountingEntryPolicy.normalizeRequiredReason(
        reason,
        'Estorno contábil exige justificativa auditável.'
      );

    const reversalEntries =
      originalEntries.map((orig) => {
        AccountingEntryPolicy.assertRawEntryShape(
          orig
        );

        let entryType: LedgerEntryDirection;

        if (orig.entryType === 'debit') {
          entryType = 'credit';
        } else if (orig.entryType === 'credit') {
          entryType = 'debit';
        } else {
          throw new AccountingMatrixValidationError(
            `Lançamento original possui entryType inválido: ${String(
              orig.entryType
            )}.`
          );
        }

        const accountId =
          parsePositiveSafeIntegerId(
            orig.accountId,
            'orig.accountId'
          );

        const assetId =
          parsePositiveSafeIntegerId(
            orig.assetId,
            'orig.assetId'
          );

        const amount =
          AccountingEntryPolicy.assertMoney256(
            orig.amount
          );

        if (amount.assetId !== assetId) {
          throw new AccountingMatrixValidationError(
            `Incoerência de ativo no lançamento original: assetId (${assetId}) !== amount.assetId (${amount.assetId}).`
          );
        }

        const description =
          AccountingEntryPolicy.normalizeDescription(
            orig.description
          );

        return {
          accountId,
          assetId,
          entryType,
          amount,
          description:
            `Reversal (${normalizedReason}): ${description}`,
        };
      });

    AccountingEntryPolicy.validateEntriesBalance(
      reversalEntries
    );

    return reversalEntries;
  }

  /**
   * 12. OPENING BALANCE:
   *
   * Dr Asset Account
   * Cr Opening Equity
   *
   * A autorização administrativa efetiva deve ser garantida
   * antes da chamada deste método.
   */
  public static createOpeningBalanceEntries(params: {
    targetAccountId: number;
    openingEquityAccountId: number;
    amount: Money256;
    description: string;
    authorizedByUserId: number;
  }): RawLedgerEntrySpec[] {
    AccountingEntryPolicy.assertOperationParams(params);

    AccountingEntryPolicy.assertPositiveAmount(params.amount);

    const amount =
      AccountingEntryPolicy.assertMoney256(params.amount);

    const description =
      AccountingEntryPolicy.normalizeDescription(
        params.description
      );

    const authorizedBy =
      parsePositiveSafeIntegerId(
        params.authorizedByUserId,
        'authorizedByUserId'
      );

    const targetAcc =
      parsePositiveSafeIntegerId(
        params.targetAccountId,
        'targetAccountId'
      );

    const equityAcc =
      parsePositiveSafeIntegerId(
        params.openingEquityAccountId,
        'openingEquityAccountId'
      );

    AccountingEntryPolicy.assertDistinctAccounts(
      targetAcc,
      equityAcc,
      'A conta de destino e a conta de opening equity não podem ser idênticas.'
    );

    const entries: RawLedgerEntrySpec[] = [
      AccountingEntryPolicy.createEntry({
        accountId: targetAcc,
        assetId: amount.assetId,
        entryType: 'debit',
        amount,
        description:
          `Opening Balance Debit (AuthUser #${authorizedBy}): ${description}`,
      }),
      AccountingEntryPolicy.createEntry({
        accountId: equityAcc,
        assetId: amount.assetId,
        entryType: 'credit',
        amount,
        description:
          `Opening Equity Credit (AuthUser #${authorizedBy}): ${description}`,
      }),
    ];

    AccountingEntryPolicy.validateEntriesBalance(entries);

    return entries;
  }

  /**
   * Valida que:
   *
   *   sum(Debits) === sum(Credits)
   *
   * para cada ativo individualmente.
   *
   * Também funciona como barreira defensiva de runtime para
   * RawLedgerEntrySpec.
   */
  public static validateEntriesBalance(
    entries: RawLedgerEntrySpec[]
  ): void {
    if (
      !Array.isArray(entries) ||
      entries.length === 0
    ) {
      throw new AccountingMatrixValidationError(
        'A lista de lançamentos contábeis não pode ser vazia.'
      );
    }

    if (
      entries.length > MAX_LEDGER_ENTRIES
    ) {
      throw new AccountingMatrixValidationError(
        `A lista de lançamentos não pode possuir mais de ${MAX_LEDGER_ENTRIES} itens.`
      );
    }

    const assetDebits = new Map<number, bigint>();
    const assetCredits = new Map<number, bigint>();

    for (const entry of entries) {
      AccountingEntryPolicy.assertRawEntryShape(
        entry
      );

      const amount =
        AccountingEntryPolicy.assertMoney256(
          entry.amount
        );

      parsePositiveSafeIntegerId(
        entry.accountId,
        'entry.accountId'
      );

      const assetId =
        parsePositiveSafeIntegerId(
          entry.assetId,
          'entry.assetId'
        );

      if (amount.assetId !== assetId) {
        throw new AccountingMatrixValidationError(
          `Incoerência de ativo no lançamento contábil: ` +
            `spec.assetId (${assetId}) !== ` +
            `amount.assetId (${amount.assetId}).`
        );
      }

      AccountingEntryPolicy.assertPositiveAmount(
        amount
      );

      const amountBigInt = amount.toBigInt();

      if (
        amountBigInt <= 0n ||
        amountBigInt > MAX_UINT256
      ) {
        throw new AccountingMatrixValidationError(
          `Valor contábil fora do intervalo permitido uint256 positivo no lançamento da conta #${entry.accountId}.`
        );
      }

      if (entry.entryType === 'debit') {
        const current =
          assetDebits.get(assetId) ?? 0n;

        const next =
          current + amountBigInt;

        if (next > MAX_UINT256) {
          throw new AccountingMatrixValidationError(
            `Overflow uint256 no acumulado de débitos do ativo #${assetId}.`
          );
        }

        assetDebits.set(assetId, next);
      } else if (entry.entryType === 'credit') {
        const current =
          assetCredits.get(assetId) ?? 0n;

        const next =
          current + amountBigInt;

        if (next > MAX_UINT256) {
          throw new AccountingMatrixValidationError(
            `Overflow uint256 no acumulado de créditos do ativo #${assetId}.`
          );
        }

        assetCredits.set(assetId, next);
      } else {
        /**
         * Nunca usar "else = credit".
         *
         * Qualquer valor diferente de debit/credit é inválido.
         */
        throw new AccountingMatrixValidationError(
          `Tipo de lançamento inválido: ${String(
            entry.entryType
          )}.`
        );
      }
    }

    const allAssetIds = new Set([
      ...assetDebits.keys(),
      ...assetCredits.keys(),
    ]);

    for (const assetId of allAssetIds) {
      const totalDebits =
        assetDebits.get(assetId) ?? 0n;

      const totalCredits =
        assetCredits.get(assetId) ?? 0n;

      if (totalDebits !== totalCredits) {
        throw new AccountingMatrixValidationError(
          `Lançamentos desbalanceados para o ativo #${assetId}: ` +
            `Total Débitos (${totalDebits}) !== ` +
            `Total Créditos (${totalCredits})`
        );
      }
    }
  }

  /**
   * Identifica e extrai o montante reembolsável de uma transação
   * de pagamento original.
   *
   * Mantemos o parâmetro opcional na assinatura para não quebrar
   * compile-time callers existentes, porém, em runtime, a conta
   * de receita é obrigatória para uma seleção semanticamente segura.
   */
  public static extractRefundablePaymentAmount(
    entries: FinancialLedgerEntryRecord[],
    assetId: number,
    revenueAccountId?: number
  ): Money256 {
    if (
      !Array.isArray(entries) ||
      entries.length === 0
    ) {
      throw new AccountingMatrixValidationError(
        'A transação original não possui lançamentos contábeis.'
      );
    }

    if (revenueAccountId === undefined) {
      throw new AccountingMatrixValidationError(
        'revenueAccountId é obrigatório para identificar o lançamento de receita de forma segura.'
      );
    }

    const normalizedAssetId =
      parsePositiveSafeIntegerId(
        assetId,
        'assetId'
      );

    const normalizedRevenueAccountId =
      parsePositiveSafeIntegerId(
        revenueAccountId,
        'revenueAccountId'
      );

    const paymentCreditEntries =
      entries.filter(
        (entry) =>
          entry !== null &&
          typeof entry === 'object' &&
          entry.direction === 'credit' &&
          entry.assetId === normalizedAssetId &&
          entry.accountId ===
            normalizedRevenueAccountId
      );

    if (paymentCreditEntries.length === 0) {
      throw new AccountingMatrixValidationError(
        `A transação original não possui lançamento de receita referente ao ativo #${normalizedAssetId} e conta #${normalizedRevenueAccountId}.`
      );
    }

    if (paymentCreditEntries.length > 1) {
      throw new AccountingMatrixValidationError(
        `A transação original possui múltiplos lançamentos de receita para o ativo #${normalizedAssetId} e conta #${normalizedRevenueAccountId}; não é possível determinar um valor reembolsável de forma segura.`
      );
    }

    const paymentCreditEntry =
      paymentCreditEntries[0];

    if (
      typeof paymentCreditEntry.amountBaseUnits !==
        'string' ||
      paymentCreditEntry.amountBaseUnits
        .trim()
        .length === 0
    ) {
      throw new AccountingMatrixValidationError(
        'O valor-base do lançamento de receita é inválido.'
      );
    }

    return Money256.fromString(
      paymentCreditEntry.amountBaseUnits,
      normalizedAssetId
    );
  }

  /**
   * Garante que um amount recebido em runtime realmente seja
   * uma instância válida de Money256.
   */
  private static assertMoney256(
    amount: unknown
  ): Money256 {
    if (!(amount instanceof Money256)) {
      throw new AccountingMatrixValidationError(
        'O valor do lançamento deve ser uma instância válida de Money256.'
      );
    }

    return amount;
  }

  /**
   * Garante valor estritamente positivo.
   */
  private static assertPositiveAmount(
    amount: Money256
  ): void {
    const validatedAmount =
      AccountingEntryPolicy.assertMoney256(
        amount
      );

    if (!validatedAmount.isPositive()) {
      throw new AccountingMatrixValidationError(
        `Todo lançamento contábil exige um valor estritamente positivo (FIN-002/FIN-004). Recebido: ${validatedAmount.toCanonicalString()}`
      );
    }
  }

  /**
   * Valida estrutura mínima de um RawLedgerEntrySpec
   * recebida em runtime.
   */
  private static assertRawEntryShape(
    entry: unknown
  ): asserts entry is RawLedgerEntrySpec {
    if (
      entry === null ||
      typeof entry !== 'object' ||
      Array.isArray(entry)
    ) {
      throw new AccountingMatrixValidationError(
        'Lançamento contábil inválido: objeto esperado.'
      );
    }

    const raw =
      entry as Partial<RawLedgerEntrySpec>;

    if (
      typeof raw.entryType !== 'string' ||
      (
        raw.entryType !== 'debit' &&
        raw.entryType !== 'credit'
      )
    ) {
      throw new AccountingMatrixValidationError(
        `Tipo de lançamento inválido: ${String(
          raw.entryType
        )}.`
      );
    }

    if (
      !Object.prototype.hasOwnProperty.call(
        raw,
        'amount'
      ) ||
      !(raw.amount instanceof Money256)
    ) {
      throw new AccountingMatrixValidationError(
        'O lançamento contábil deve possuir um amount válido do tipo Money256.'
      );
    }

    if (
      typeof raw.description !== 'string'
    ) {
      throw new AccountingMatrixValidationError(
        'A descrição do lançamento contábil deve ser uma string.'
      );
    }

    AccountingEntryPolicy.normalizeDescription(
      raw.description
    );
  }

  /**
   * Valida o objeto de parâmetros antes que um builder
   * tente acessar suas propriedades.
   *
   * Evita TypeError em casos de null/undefined/malformed runtime input.
   */
  private static assertOperationParams(
    params: unknown
  ): asserts params is object {
    if (
      params === null ||
      typeof params !== 'object' ||
      Array.isArray(params)
    ) {
      throw new AccountingMatrixValidationError(
        'Parâmetros da operação contábil inválidos.'
      );
    }
  }

  /**
   * Impede lançamentos economicamente sem efeito causados
   * pela utilização da mesma conta nos dois lados da operação.
   */
  private static assertDistinctAccounts(
    firstAccountId: number,
    secondAccountId: number,
    message: string
  ): void {
    if (firstAccountId === secondAccountId) {
      throw new AccountingMatrixValidationError(
        message
      );
    }
  }

  /**
   * Construtor interno de entries.
   *
   * Centraliza invariantes comuns:
   * - accountId;
   * - assetId;
   * - entryType;
   * - Money256;
   * - positividade;
   * - consistência do ativo;
   * - descrição.
   */
  private static createEntry(params: {
    accountId: number;
    assetId: number;
    entryType: LedgerEntryDirection;
    amount: Money256;
    description: string;
  }): RawLedgerEntrySpec {
    const accountId =
      parsePositiveSafeIntegerId(
        params.accountId,
        'accountId'
      );

    const assetId =
      parsePositiveSafeIntegerId(
        params.assetId,
        'assetId'
      );

    const amount =
      AccountingEntryPolicy.assertMoney256(
        params.amount
      );

    if (
      params.entryType !== 'debit' &&
      params.entryType !== 'credit'
    ) {
      throw new AccountingMatrixValidationError(
        `entryType inválido: ${String(
          params.entryType
        )}.`
      );
    }

    if (amount.assetId !== assetId) {
      throw new AccountingMatrixValidationError(
        `Asset inconsistente: ${assetId} !== ${amount.assetId}.`
      );
    }

    AccountingEntryPolicy.assertPositiveAmount(
      amount
    );

    const description =
      AccountingEntryPolicy.normalizeDescription(
        params.description
      );

    return {
      accountId,
      assetId,
      entryType: params.entryType,
      amount,
      description,
    };
  }

  /**
   * Normalização/validação textual compartilhada.
   *
   * Protege contra:
   * - null/undefined;
   * - strings vazias;
   * - caracteres ASCII de controle;
   * - texto excessivamente grande.
   */
  private static normalizeDescription(
    value: string
  ): string {
    if (typeof value !== 'string') {
      throw new AccountingMatrixValidationError(
        'A descrição do lançamento contábil deve ser uma string.'
      );
    }

    const normalized = value
      .normalize('NFC')
      .trim();

    if (normalized.length === 0) {
      throw new AccountingMatrixValidationError(
        'A descrição do lançamento contábil não pode ser vazia.'
      );
    }

    if (
      normalized.length >
      MAX_DESCRIPTION_LENGTH
    ) {
      throw new AccountingMatrixValidationError(
        `A descrição do lançamento contábil não pode exceder ${MAX_DESCRIPTION_LENGTH} caracteres.`
      );
    }

    for (
      let index = 0;
      index < normalized.length;
      index += 1
    ) {
      const codeUnit =
        normalized.charCodeAt(index);

      if (
        (codeUnit >= 0 &&
          codeUnit <= 8) ||
        (codeUnit >= 11 &&
          codeUnit <= 12) ||
        (codeUnit >= 14 &&
          codeUnit <= 31) ||
        codeUnit === 127
      ) {
        throw new AccountingMatrixValidationError(
          'A descrição do lançamento contábil contém caractere de controle inválido.'
        );
      }
    }

    return normalized;
  }

  /**
   * Validação de justificativas críticas.
   */
  private static normalizeRequiredReason(
    value: string,
    emptyMessage: string
  ): string {
    if (
      typeof value !== 'string' ||
      value.trim().length === 0
    ) {
      throw new AccountingMatrixValidationError(
        emptyMessage
      );
    }

    return AccountingEntryPolicy.normalizeDescription(
      value
    );
  }
}

```

---

<a id="srcdomainsfinancepoliciesaccountstatuspolicyts"></a>
## Arquivo: `src/domains/finance/policies/AccountStatusPolicy.ts`

- **Caminho absoluto**: `/home/sandro/Área de trabalho/BackEnd/src/domains/finance/policies/AccountStatusPolicy.ts`
- **Total de linhas**: 122
- **Linguagem**: TypeScript

```typescript
import { AccountInactiveError } from '../errors/FinancialError';

export type AccountStatus =
  | 'active'
  | 'inactive'
  | 'suspended'
  | 'blocked'
  | 'closed'
  | 'pending';

export interface AccountStatusContext {
  id: number;
  status: AccountStatus;
  name?: string;
}

const KNOWN_ACCOUNT_STATUSES = Object.freeze([
  'active',
  'inactive',
  'suspended',
  'blocked',
  'closed',
  'pending',
] as const);

export class AccountStatusPolicy {
  /**
   * Runtime type guard para status financeiros de conta conhecidos.
   */
  public static isAccountStatus(
    value: unknown
  ): value is AccountStatus {
    return (
      typeof value === 'string' &&
      (KNOWN_ACCOUNT_STATUSES as readonly string[]).includes(value)
    );
  }

  /**
   * Garante que uma conta possa participar de movimentações financeiras.
   *
   * Esta policy decide exclusivamente o estado operacional da conta.
   *
   * Não é responsabilidade desta classe:
   * - autenticação;
   * - autorização;
   * - ownership;
   * - RBAC;
   * - saldo;
   * - existência persistida;
   * - regras contábeis.
   */
  public static validateActive(
    account: AccountStatusContext
  ): void {
    if (
      account === null ||
      typeof account !== 'object' ||
      Array.isArray(account)
    ) {
      throw new AccountInactiveError(
        'Conta financeira inválida: contexto de conta ausente ou malformado.'
      );
    }

    if (
      !Number.isSafeInteger(account.id) ||
      account.id <= 0
    ) {
      throw new AccountInactiveError(
        'Conta financeira possui identificador inválido.'
      );
    }

    if (!AccountStatusPolicy.isAccountStatus(account.status)) {
      throw new AccountInactiveError(
        `Conta financeira #${account.id} possui status inválido: "${String(
          account.status
        )}".`
      );
    }

    if (account.status !== 'active') {
      const name =
        typeof account.name === 'string' &&
        account.name.trim().length > 0
          ? AccountStatusPolicy.normalizeDisplayName(account.name)
          : 'desconhecida';

      throw new AccountInactiveError(
        `Conta financeira #${account.id} (${name}) está com status "${account.status}". ` +
          'Movimentações somente são permitidas em contas ativas.'
      );
    }
  }

  /**
   * Normaliza o nome utilizado exclusivamente em mensagens de erro/log.
   *
   * Não faz parte da persistência nem altera a entidade de conta.
   */
  private static normalizeDisplayName(
    value: string
  ): string {
    const normalized = value.normalize('NFC').trim();

    for (let index = 0; index < normalized.length; index += 1) {
      const codeUnit = normalized.charCodeAt(index);

      if (
        (codeUnit >= 0 && codeUnit <= 8) ||
        (codeUnit >= 11 && codeUnit <= 12) ||
        (codeUnit >= 14 && codeUnit <= 31) ||
        codeUnit === 127
      ) {
        return 'desconhecida';
      }
    }

    return normalized;
  }
}

```

---

<a id="srcdomainsfinancepoliciesassetstatuspolicyts"></a>
## Arquivo: `src/domains/finance/policies/AssetStatusPolicy.ts`

- **Caminho absoluto**: `/home/sandro/Área de trabalho/BackEnd/src/domains/finance/policies/AssetStatusPolicy.ts`
- **Total de linhas**: 214
- **Linguagem**: TypeScript

```typescript
import { AssetInactiveError } from '../errors/FinancialError';
import { Result } from '../../../shared/kernel/Result';
import { parsePositiveSafeIntegerId } from '../value-objects/Money256';

export type AssetStatus =
  | 'active'
  | 'inactive'
  | 'suspended'
  | 'blocked'
  | 'retired'
  | 'pending';

export interface AssetStatusContext {
  id: number | string;
  status: AssetStatus;
  code?: string;
}

const KNOWN_ASSET_STATUSES = Object.freeze([
  'active',
  'inactive',
  'suspended',
  'blocked',
  'retired',
  'pending',
] as const);

export class AssetStatusPolicy {
  /**
   * Mantemos os overloads originais para preservar compatibilidade.
   *
   * Forma canônica:
   *   validateActive({ id, status, code })
   *
   * Forma compatível:
   *   validateActive(assetId, status)
   */
  public static validateActive(
    asset: AssetStatusContext
  ): void;

  public static validateActive(
    assetId: number | string,
    status: string
  ): void;

  public static validateActive(
    assetInput: AssetStatusContext | number | string,
    status?: string
  ): void {
    const context = AssetStatusPolicy.normalizeContext(
      assetInput,
      status
    );

    const assetId = parsePositiveSafeIntegerId(
      context.id,
      'asset.id'
    );

    if (!AssetStatusPolicy.isAssetStatus(context.status)) {
      throw new AssetInactiveError(
        `Ativo financeiro #${assetId} possui status inválido: "${String(
          context.status
        )}".`
      );
    }

    if (context.status !== 'active') {
      const code =
        typeof context.code === 'string' &&
        context.code.trim().length > 0
          ? AssetStatusPolicy.normalizeDisplayCode(context.code)
          : 'desconhecido';

      throw new AssetInactiveError(
        `Ativo financeiro #${assetId} (${code}) está com status "${context.status}". ` +
          'Operações financeiras exigem que o ativo esteja ativo.'
      );
    }
  }

  /**
   * Validação equivalente usando Result.
   *
   * Mantida para compatibilidade com callers que adotam o padrão Result.
   */
  public static validateActiveResult(
    assetId: string | number,
    status: string
  ): Result<void> {
    try {
      const normalizedAssetId =
        parsePositiveSafeIntegerId(
          assetId,
          'asset.id'
        );

      if (!AssetStatusPolicy.isAssetStatus(status)) {
        return Result.fail(
          `Operação bloqueada por política de domínio: Ativo ${normalizedAssetId} possui status inválido '${String(
            status
          )}'.`
        );
      }

      if (status !== 'active') {
        return Result.fail(
          `Operação bloqueada por política de domínio: Ativo ${normalizedAssetId} está com status '${status}' (esperado: 'active').`
        );
      }

      return Result.ok(undefined);
    } catch (error) {
      return Result.fail(
        error instanceof Error
          ? error.message
          : 'Falha ao validar o status do ativo financeiro.'
      );
    }
  }

  /**
   * Runtime type guard para status conhecidos.
   */
  public static isAssetStatus(
    value: unknown
  ): value is AssetStatus {
    return (
      typeof value === 'string' &&
      (KNOWN_ASSET_STATUSES as readonly string[]).includes(value)
    );
  }

  /**
   * Normaliza as duas formas públicas de entrada em um único
   * contrato interno.
   */
  private static normalizeContext(
    assetInput: AssetStatusContext | number | string,
    status?: string
  ): AssetStatusContext {
    if (
      assetInput !== null &&
      typeof assetInput === 'object' &&
      !Array.isArray(assetInput)
    ) {
      const context = assetInput as AssetStatusContext;

      if (
        !('id' in context) ||
        !('status' in context)
      ) {
        throw new AssetInactiveError(
          'Contexto de ativo financeiro incompleto.'
        );
      }

      return {
        id: context.id,
        status: context.status,
        code:
          typeof context.code === 'string'
            ? context.code.trim()
            : undefined,
      };
    }

    if (
      typeof assetInput === 'number' ||
      typeof assetInput === 'string'
    ) {
      if (typeof status !== 'string') {
        throw new AssetInactiveError(
          'Status do ativo financeiro é obrigatório.'
        );
      }

      return {
        id: assetInput,
        status: status as AssetStatus,
      };
    }

    throw new AssetInactiveError(
      'Contexto de ativo financeiro inválido.'
    );
  }

  /**
   * Evita que dados de apresentação com caracteres de controle
   * poluam mensagens de erro/log.
   */
  private static normalizeDisplayCode(
    value: string
  ): string {
    const normalized = value.normalize('NFC').trim();

    for (let index = 0; index < normalized.length; index += 1) {
      const codeUnit = normalized.charCodeAt(index);

      if (
        (codeUnit >= 0 && codeUnit <= 8) ||
        (codeUnit >= 11 && codeUnit <= 12) ||
        (codeUnit >= 14 && codeUnit <= 31) ||
        codeUnit === 127
      ) {
        return 'desconhecido';
      }
    }

    return normalized;
  }
}

```

---

<a id="srcdomainsfinanceservicesfinancialtransactionstatemachinets"></a>
## Arquivo: `src/domains/finance/services/FinancialTransactionStateMachine.ts`

- **Caminho absoluto**: `/home/sandro/Área de trabalho/BackEnd/src/domains/finance/services/FinancialTransactionStateMachine.ts`
- **Total de linhas**: 152
- **Linguagem**: TypeScript

```typescript
import { Result } from '../../../shared/kernel/Result';

/**
 * ============================================================
 * FINANCIAL TRANSACTION STATUS
 * ============================================================
 *
 * Representa exclusivamente o lifecycle de negócio da transação.
 *
 * IMPORTANTE:
 * FinancialTransactionStatus NÃO representa:
 * - posting state (not_posted vs posted);
 * - idempotency state (processing vs completed);
 * - OCC state (versioning de saldo);
 * - settlement state;
 * - estado de outbox.
 *
 * Esses conceitos pertencem às respectivas camadas/policies de infraestrutura e liquidação.
 */
export type FinancialTransactionStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'reversed';

const FINANCIAL_TRANSACTION_STATUSES = Object.freeze([
  'pending',
  'processing',
  'completed',
  'failed',
  'cancelled',
  'reversed',
] as const);

function isFinancialTransactionStatus(
  value: unknown
): value is FinancialTransactionStatus {
  return (
    typeof value === 'string' &&
    FINANCIAL_TRANSACTION_STATUSES.includes(
      value as FinancialTransactionStatus
    )
  );
}

/**
 * ============================================================
 * STATE TRANSITION MATRIX (CANÔNICA E IMUTÁVEL)
 * ============================================================
 *
 * pending:    -> processing | failed | cancelled
 * processing: -> completed  | failed
 * completed:  -> reversed
 * failed:     -> terminal (nenhuma)
 * cancelled:  -> terminal (nenhuma)
 * reversed:   -> terminal (nenhuma)
 *
 * REGRA FINANCEIRA CRÍTICA:
 * 'processing -> cancelled' É ESTRITAMENTE PROIBIDO.
 * O cancelamento só pode ocorrer enquanto a transação estiver em 'pending'.
 */
const ALLOWED_TRANSITIONS: Readonly<
  Record<
    FinancialTransactionStatus,
    readonly FinancialTransactionStatus[]
  >
> = Object.freeze({
  pending: Object.freeze(['processing', 'failed', 'cancelled'] as const),
  processing: Object.freeze(['completed', 'failed'] as const),
  completed: Object.freeze(['reversed'] as const),
  failed: Object.freeze([] as const),
  cancelled: Object.freeze([] as const),
  reversed: Object.freeze([] as const),
});

export class FinancialTransactionStateMachine {
  /**
   * Executa e valida a transição de estado da transação financeira.
   *
   * Retorna:
   *   Result.ok(targetStatus) se a transição for permitida ou for no-op idempotente.
   *   Result.fail(mensagem) se o status for inválido ou a transição for proibida.
   */
  static transition(
    currentStatus: FinancialTransactionStatus,
    targetStatus: FinancialTransactionStatus
  ): Result<FinancialTransactionStatus> {
    if (!isFinancialTransactionStatus(currentStatus)) {
      return Result.fail('Status de transação financeira atual inválido.');
    }

    if (!isFinancialTransactionStatus(targetStatus)) {
      return Result.fail('Status de transação financeira de destino inválido.');
    }

    // No-op idempotente: transição para o mesmo estado é segura e permitida
    if (currentStatus === targetStatus) {
      return Result.ok(targetStatus);
    }

    const allowedTransitions = ALLOWED_TRANSITIONS[currentStatus];

    if (!allowedTransitions.includes(targetStatus)) {
      return Result.fail(
        `Transição de estado inválida: '${currentStatus}' -> '${targetStatus}'. Transições permitidas a partir de '${currentStatus}': [${allowedTransitions.join(', ')}].`
      );
    }

    return Result.ok(targetStatus);
  }

  /**
   * Helper booleano de conveniência para verificar se a transição é autorizada.
   */
  static canTransition(
    currentStatus: FinancialTransactionStatus,
    targetStatus: FinancialTransactionStatus
  ): boolean {
    return this.transition(currentStatus, targetStatus).isSuccess;
  }

  /**
   * Verifica se o status fornecido é terminal (não admite mais transições de saída).
   */
  static isTerminal(status: FinancialTransactionStatus): boolean {
    if (!isFinancialTransactionStatus(status)) {
      return false;
    }
    return status === 'failed' || status === 'cancelled' || status === 'reversed';
  }

  /**
   * Type-guard para validação de input externo.
   */
  static isValidStatus(status: unknown): status is FinancialTransactionStatus {
    return isFinancialTransactionStatus(status);
  }

  /**
   * Retorna uma lista imutável das transições permitidas a partir do status informado.
   */
  static getAllowedTransitions(
    status: FinancialTransactionStatus
  ): readonly FinancialTransactionStatus[] {
    if (!isFinancialTransactionStatus(status)) {
      return Object.freeze([]);
    }
    return ALLOWED_TRANSITIONS[status];
  }
}

```

---

<a id="srcdomainsfinancevalueobjectsbaseunitsts"></a>
## Arquivo: `src/domains/finance/value-objects/BaseUnits.ts`

- **Caminho absoluto**: `/home/sandro/Área de trabalho/BackEnd/src/domains/finance/value-objects/BaseUnits.ts`
- **Total de linhas**: 48
- **Linguagem**: TypeScript

```typescript
import {
  InvalidMoneyFormatError,
  Money256OverflowError,
} from '../errors/FinancialError';

export const MAX_UINT256 = (1n << 256n) - 1n; // 2^256 - 1

export const LEDGER_ENTRY_DIRECTIONS = ['debit', 'credit'] as const;
export type LedgerEntryDirection = typeof LEDGER_ENTRY_DIRECTIONS[number];

export function isLedgerEntryDirection(value: unknown): value is LedgerEntryDirection {
  return typeof value === 'string' && (value === 'debit' || value === 'credit');
}

/**
 * FIN-AMT-001: Canonical Base Unit Range
 * Valida se um valor de base units é uma string decimal canônica e respeita o teto de 256 bits.
 * Permite zero ("0") para saldos, limites e projeções.
 */
export function parseCanonicalBaseUnits(value: unknown): string {
  if (typeof value !== 'string') {
    throw new InvalidMoneyFormatError('O valor de unidades base deve ser fornecido como string decimal canônica.');
  }

  if (!/^(0|[1-9]\d*)$/.test(value)) {
    throw new InvalidMoneyFormatError(
      `Formato de unidades base inválido: "${value}". Deve ser uma string de inteiros sem sinal, sem decimais, sem espaços e sem zeros à esquerda.`
    );
  }

  const numericBigInt = BigInt(value);
  if (numericBigInt > MAX_UINT256) {
    throw new Money256OverflowError();
  }

  return value;
}

/**
 * Valida montante estritamente positivo para lançamentos do ledger contábil (> 0).
 */
export function parsePositiveCanonicalBaseUnits(value: unknown): string {
  const canonical = parseCanonicalBaseUnits(value);
  if (canonical === '0') {
    throw new InvalidMoneyFormatError('Lançamentos no ledger contábil exigem montante estritamente positivo (> 0).');
  }
  return canonical;
}

```

---

<a id="srcdomainsfinancevalueobjectsmoney256ts"></a>
## Arquivo: `src/domains/finance/value-objects/Money256.ts`

- **Caminho absoluto**: `/home/sandro/Área de trabalho/BackEnd/src/domains/finance/value-objects/Money256.ts`
- **Total de linhas**: 130
- **Linguagem**: TypeScript

```typescript
import {
  InvalidMoneyFormatError,
  Money256OverflowError,
  CurrencyMismatchError,
  MoneyUnderflowError,
  InvalidIdentifierError,
} from '../errors/FinancialError';

export const MAX_UINT256 = (1n << 256n) - 1n; // 2^256 - 1

export function parsePositiveSafeIntegerId(id: number | string, name = 'id'): number {
  const numericId = typeof id === 'number' ? id : Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0 || numericId > Number.MAX_SAFE_INTEGER) {
    throw new InvalidIdentifierError(`Invalid physical ${name}: ${id}`);
  }
  return numericId;
}

export class Money256 {
  public readonly amount: bigint;
  public readonly assetId: number;

  constructor(amount: bigint | string, assetId: number | string) {
    this.assetId = parsePositiveSafeIntegerId(assetId, 'assetId');

    if (typeof amount === 'string') {
      this.amount = Money256.parseCanonicalString(amount);
    } else if (typeof amount === 'bigint') {
      Money256.assertValidRange(amount);
      this.amount = amount;
    } else {
      throw new InvalidMoneyFormatError('Money amount must be a bigint or canonical decimal string.');
    }

    Object.freeze(this);
  }

  public static zero(assetId: number | string): Money256 {
    return new Money256(0n, assetId);
  }

  public static fromString(amountStr: string, assetId: number | string): Money256 {
    return new Money256(amountStr, assetId);
  }

  public static fromBigInt(amount: bigint, assetId: number | string): Money256 {
    return new Money256(amount, assetId);
  }

  public static parseCanonicalString(str: string): bigint {
    if (typeof str !== 'string' || !/^(0|[1-9]\d*)$/.test(str)) {
      throw new InvalidMoneyFormatError(
        `Invalid canonical decimal string format: "${str}". Must be non-negative integer string without leading zeros, exponent, or signs.`
      );
    }
    const val = BigInt(str);
    Money256.assertValidRange(val);
    return val;
  }

  private static assertValidRange(val: bigint): void {
    if (val < 0n) {
      throw new InvalidMoneyFormatError('Monetary amount cannot be negative.');
    }
    if (val > MAX_UINT256) {
      throw new Money256OverflowError();
    }
  }

  public add(other: Money256): Money256 {
    this.assertSameAsset(other);
    return new Money256(this.amount + other.amount, this.assetId);
  }

  public subtract(other: Money256): Money256 {
    this.assertSameAsset(other);
    if (this.amount < other.amount) {
      throw new MoneyUnderflowError('Subtraction resulting in negative balance is prohibited.');
    }
    return new Money256(this.amount - other.amount, this.assetId);
  }

  public isZero(): boolean {
    return this.amount === 0n;
  }

  public isPositive(): boolean {
    return this.amount > 0n;
  }

  public equals(other: Money256): boolean {
    return this.assetId === other.assetId && this.amount === other.amount;
  }

  public greaterThan(other: Money256): boolean {
    this.assertSameAsset(other);
    return this.amount > other.amount;
  }

  public greaterThanOrEqual(other: Money256): boolean {
    this.assertSameAsset(other);
    return this.amount >= other.amount;
  }

  public lessThan(other: Money256): boolean {
    this.assertSameAsset(other);
    return this.amount < other.amount;
  }

  public lessThanOrEqual(other: Money256): boolean {
    this.assertSameAsset(other);
    return this.amount <= other.amount;
  }

  public toCanonicalString(): string {
    return this.amount.toString(10);
  }

  public toBigInt(): bigint {
    return this.amount;
  }

  private assertSameAsset(other: Money256): void {
    if (this.assetId !== other.assetId) {
      throw new CurrencyMismatchError(
        `Cannot perform arithmetic on different assets: ${this.assetId} and ${other.assetId}`
      );
    }
  }
}

```

---

