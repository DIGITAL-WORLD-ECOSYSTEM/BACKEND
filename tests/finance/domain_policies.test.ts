import { describe, it, expect } from 'vitest';
import { FinancialTransactionStateMachine } from '../../src/domains/finance/services/FinancialTransactionStateMachine';
import { AccountStatusPolicy } from '../../src/domains/finance/policies/AccountStatusPolicy';
import { AssetStatusPolicy } from '../../src/domains/finance/policies/AssetStatusPolicy';
import {
  AccountingEntryPolicy,
  AccountingMatrixValidationError,
} from '../../src/domains/finance/policies/AccountingEntryPolicy';
import { Money256 } from '../../src/domains/finance/value-objects/Money256';

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

    it('deve proibir estritamente cancelamento após início do processamento (processing -> cancelled)', () => {
      const res = FinancialTransactionStateMachine.transition('processing', 'cancelled');
      expect(res.isFailure).toBe(true);
      expect(res.error).toContain("Transição de estado inválida: 'processing' -> 'cancelled'");
      expect(FinancialTransactionStateMachine.canTransition('processing', 'cancelled')).toBe(false);
    });

    it('deve permitir cancelamento antes do processamento (pending -> cancelled)', () => {
      const res = FinancialTransactionStateMachine.transition('pending', 'cancelled');
      expect(res.isSuccess).toBe(true);
      expect(res.getValue()).toBe('cancelled');
    });

    it('deve permitir falha a partir de pending e processing', () => {
      expect(FinancialTransactionStateMachine.transition('pending', 'failed').isSuccess).toBe(true);
      expect(FinancialTransactionStateMachine.transition('processing', 'failed').isSuccess).toBe(true);
    });

    it('deve tratar self-transition como no-op idempotente', () => {
      const resPending = FinancialTransactionStateMachine.transition('pending', 'pending');
      expect(resPending.isSuccess).toBe(true);
      expect(resPending.getValue()).toBe('pending');

      const resCompleted = FinancialTransactionStateMachine.transition('completed', 'completed');
      expect(resCompleted.isSuccess).toBe(true);
      expect(resCompleted.getValue()).toBe('completed');
    });

    it('deve rejeitar status atual ou de destino desconhecido em runtime', () => {
      const resInvalidCurrent = FinancialTransactionStateMachine.transition('inexistente' as any, 'completed');
      expect(resInvalidCurrent.isFailure).toBe(true);
      expect(resInvalidCurrent.error).toContain('Status de transação financeira atual inválido.');

      const resInvalidTarget = FinancialTransactionStateMachine.transition('pending', 'inexistente' as any);
      expect(resInvalidTarget.isFailure).toBe(true);
      expect(resInvalidTarget.error).toContain('Status de transação financeira de destino inválido.');
    });

    it('deve identificar corretamente estados terminais via isTerminal()', () => {
      expect(FinancialTransactionStateMachine.isTerminal('failed')).toBe(true);
      expect(FinancialTransactionStateMachine.isTerminal('cancelled')).toBe(true);
      expect(FinancialTransactionStateMachine.isTerminal('reversed')).toBe(true);

      expect(FinancialTransactionStateMachine.isTerminal('pending')).toBe(false);
      expect(FinancialTransactionStateMachine.isTerminal('processing')).toBe(false);
      expect(FinancialTransactionStateMachine.isTerminal('completed')).toBe(false);
    });

    it('deve retornar lista imutável e correta via getAllowedTransitions()', () => {
      const pendingTransitions = FinancialTransactionStateMachine.getAllowedTransitions('pending');
      expect(pendingTransitions).toEqual(['processing', 'failed', 'cancelled']);
      expect(Object.isFrozen(pendingTransitions)).toBe(true);

      const processingTransitions = FinancialTransactionStateMachine.getAllowedTransitions('processing');
      expect(processingTransitions).toEqual(['completed', 'failed']);
      expect(processingTransitions).not.toContain('cancelled');

      const failedTransitions = FinancialTransactionStateMachine.getAllowedTransitions('failed');
      expect(failedTransitions).toEqual([]);
    });

    it('deve proibir transição a partir de estado terminal (failed -> completed)', () => {
      const res = FinancialTransactionStateMachine.transition('failed', 'completed');
      expect(res.isFailure).toBe(true);
      expect(res.error).toContain("Transição de estado inválida: 'failed' -> 'completed'");
    });
  });

  describe('DOD-10: AccountStatusPolicy & AssetStatusPolicy', () => {
    it('deve permitir contas e ativos ativas', () => {
      expect(() => AccountStatusPolicy.validateActive({ id: 1, status: 'active' })).not.toThrow();
      expect(() => AssetStatusPolicy.validateActive({ id: 10, status: 'active' })).not.toThrow();
    });

    it('deve rejeitar contas inativas ou suspensas', () => {
      expect(() => AccountStatusPolicy.validateActive({ id: 1, status: 'inactive' })).toThrow(/Movimentações somente são permitidas em contas ativas/);
    });

    it('deve rejeitar ativos inativos', () => {
      expect(() => AssetStatusPolicy.validateActive({ id: 10, status: 'suspended' })).toThrow(/Operações financeiras exigem que o ativo esteja ativo/);
    });
  });

  describe('AccountingEntryPolicy (Strict Banking Invariants)', () => {
    it('deve rejeitar incoerência de assetId entre spec e Money256', () => {
      expect(() => {
        AccountingEntryPolicy.validateEntriesBalance([
          { accountId: 1, assetId: 1, entryType: 'debit', amount: Money256.fromBigInt(100n, 2), description: 'mismatch' },
          { accountId: 2, assetId: 1, entryType: 'credit', amount: Money256.fromBigInt(100n, 2), description: 'mismatch' },
        ]);
      }).toThrow(AccountingMatrixValidationError);
    });

    it('deve exigir autorização auditável em adjustment e opening balance', () => {
      const adj = AccountingEntryPolicy.createAdjustmentEntries({
        debitAccountId: 1,
        creditAccountId: 2,
        amount: Money256.fromBigInt(100n, 1),
        reason: 'Correção técnica',
        authorizedByUserId: 42,
      });
      expect(adj[0].description).toContain('AuthUser #42');

      const open = AccountingEntryPolicy.createOpeningBalanceEntries({
        targetAccountId: 1,
        openingEquityAccountId: 99,
        amount: Money256.fromBigInt(1000n, 1),
        description: 'Bootstrap',
        authorizedByUserId: 100,
      });
      expect(open[0].description).toContain('AuthUser #100');
    });

    it('deve filtrar lançamento de receita por revenueAccountId em extractRefundablePaymentAmount', () => {
      const entries = [
        { accountId: 5, direction: 'credit', assetId: 1, amountBaseUnits: '5' },  // Fee revenue
        { accountId: 10, direction: 'credit', assetId: 1, amountBaseUnits: '95' }, // Merchant revenue
      ];

      const res = AccountingEntryPolicy.extractRefundablePaymentAmount(entries as any, 1, 10);
      expect(res.toCanonicalString()).toBe('95');

      expect(() => AccountingEntryPolicy.extractRefundablePaymentAmount(entries as any, 1, 999)).toThrow(AccountingMatrixValidationError);
    });
  });
});
