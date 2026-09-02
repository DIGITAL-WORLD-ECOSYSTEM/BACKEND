import { describe, it, expect } from 'vitest';
import { LedgerTransaction, LedgerEntry } from './LedgerTransaction';
import { Money256 } from '../value-objects/Money256';
import { LedgerImbalanceError } from '../errors/LedgerImbalanceError';

describe('LedgerTransaction (Double-Entry Balance Verification)', () => {
  it('deve lançar LedgerImbalanceError se débitos não forem iguais a créditos', () => {
    expect(() => {
      new LedgerTransaction({
        idempotencyKey: crypto.randomUUID(),
        description: 'Test Imbalance',
        entries: [
          new LedgerEntry({ accountId: '1', amount: Money256.fromBigInt(100n, 1), type: 'debit' }),
          new LedgerEntry({ accountId: '2', amount: Money256.fromBigInt(90n, 1), type: 'credit' })
        ]
      });
    }).toThrowError(LedgerImbalanceError);
  });

  it('deve criar transação normalmente se débitos forem iguais a créditos', () => {
    const tx = new LedgerTransaction({
      idempotencyKey: crypto.randomUUID(),
      description: 'Test Balance',
      entries: [
        new LedgerEntry({ accountId: '1', amount: Money256.fromBigInt(100n, 1), type: 'debit' }),
        new LedgerEntry({ accountId: '2', amount: Money256.fromBigInt(100n, 1), type: 'credit' })
      ]
    });
    expect(tx).toBeInstanceOf(LedgerTransaction);
  });

  it('deve garantir que o array entries seja imutável (Object.isFrozen)', () => {
    const tx = new LedgerTransaction({
      idempotencyKey: crypto.randomUUID(),
      description: 'Test Immutability',
      entries: [
        new LedgerEntry({ accountId: '1', amount: Money256.fromBigInt(100n, 1), type: 'debit' }),
        new LedgerEntry({ accountId: '2', amount: Money256.fromBigInt(100n, 1), type: 'credit' })
      ]
    });
    expect(Object.isFrozen(tx.entries)).toBe(true);
    expect(() => {
      (tx.entries as any).push(
        new LedgerEntry({ accountId: '3', amount: Money256.fromBigInt(10n, 1), type: 'debit' })
      );
    }).toThrow();
  });

  it('deve rejeitar idempotencyKey vazia ou muito longa', () => {
    expect(() => {
      new LedgerTransaction({
        idempotencyKey: '   ',
        description: 'Test Key',
        entries: [
          new LedgerEntry({ accountId: '1', amount: Money256.fromBigInt(100n, 1), type: 'debit' }),
          new LedgerEntry({ accountId: '2', amount: Money256.fromBigInt(100n, 1), type: 'credit' })
        ]
      });
    }).toThrowError('Idempotency key is required');

    expect(() => {
      new LedgerTransaction({
        idempotencyKey: 'a'.repeat(256),
        description: 'Test Key Long',
        entries: [
          new LedgerEntry({ accountId: '1', amount: Money256.fromBigInt(100n, 1), type: 'debit' }),
          new LedgerEntry({ accountId: '2', amount: Money256.fromBigInt(100n, 1), type: 'credit' })
        ]
      });
    }).toThrowError('Idempotency key exceeds maximum length of 255 characters');
  });

  it('deve rejeitar accountId inválido em LedgerEntry', () => {
    expect(() => {
      new LedgerEntry({ accountId: 'abc', amount: Money256.fromBigInt(100n, 1), type: 'debit' });
    }).toThrowError('Invalid LedgerEntry accountId: abc');
  });

  it('deve rejeitar userId inválido em LedgerTransaction', () => {
    expect(() => {
      new LedgerTransaction({
        idempotencyKey: crypto.randomUUID(),
        description: 'Invalid User ID',
        userId: -5,
        entries: [
          new LedgerEntry({ accountId: '1', amount: Money256.fromBigInt(100n, 1), type: 'debit' }),
          new LedgerEntry({ accountId: '2', amount: Money256.fromBigInt(100n, 1), type: 'credit' })
        ]
      });
    }).toThrowError('Invalid userId: -5');
  });
});
