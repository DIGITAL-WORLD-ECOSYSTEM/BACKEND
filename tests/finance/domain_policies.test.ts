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
