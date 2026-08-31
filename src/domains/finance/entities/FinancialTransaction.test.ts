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
});
