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
      }).toThrowError('Financial transaction type "conversion" is not supported in the current operational release.');
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
      }).toThrowError('Invalid status on rehydration: "posted".');
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
      expect(parseCanonicalBaseUnits('0')).toBe(0n);
      expect(parseCanonicalBaseUnits('100')).toBe(100n);
      expect(parseCanonicalBaseUnits(500)).toBe(500n);
      expect(parseCanonicalBaseUnits(1000n)).toBe(1000n);
    });

    it('deve rejeitar base units com casas decimais ou caracteres inválidos', () => {
      expect(() => parseCanonicalBaseUnits('10.5')).toThrowError(InvalidMoneyFormatError);
      expect(() => parseCanonicalBaseUnits('abc')).toThrowError(InvalidMoneyFormatError);
      expect(() => parseCanonicalBaseUnits('-10')).toThrowError(InvalidMoneyFormatError);
      expect(() => parseCanonicalBaseUnits('   ')).toThrowError(InvalidMoneyFormatError);
    });

    it('deve validar limites máximos de uint256 (2^256 - 1)', () => {
      const maxUint256 = (1n << 256n) - 1n;
      expect(parseCanonicalBaseUnits(maxUint256.toString())).toBe(maxUint256);

      const overflowUint256 = maxUint256 + 1n;
      expect(() => parseCanonicalBaseUnits(overflowUint256.toString())).toThrowError('exceeds uint256');
    });

    it('deve exigir estritamente positivo em parsePositiveCanonicalBaseUnits', () => {
      expect(parsePositiveCanonicalBaseUnits('1')).toBe(1n);
      expect(() => parsePositiveCanonicalBaseUnits('0')).toThrowError('must be strictly positive');
    });
  });
});
