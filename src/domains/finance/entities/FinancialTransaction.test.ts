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
