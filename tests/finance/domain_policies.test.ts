import { describe, it, expect } from 'vitest';
import { FinancialTransactionStateMachine } from '../../src/domains/finance/services/FinancialTransactionStateMachine';
import { AccountStatusPolicy, AssetStatusPolicy } from '../../src/domains/finance/policies/AccountStatusPolicy';

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
      expect(() => AccountStatusPolicy.validateActive({ id: 1, status: 'active' })).not.toThrow();
      expect(() => AssetStatusPolicy.validateActive({ id: 10, status: 'active' })).not.toThrow();
    });

    it('deve rejeitar contas inativas ou suspensas', () => {
      expect(() => AccountStatusPolicy.validateActive({ id: 1, status: 'inactive' })).toThrow(/Movimentações somente são permitidas em contas ativas/);
    });

    it('deve rejeitar ativos inativos', () => {
      expect(() => AssetStatusPolicy.validateActive({ id: 10, status: 'suspended' })).toThrow(/Operações financeiras exigem ativo ativo/);
    });
  });
});
