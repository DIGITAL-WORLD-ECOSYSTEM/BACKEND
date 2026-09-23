import { describe, it, expect } from 'vitest';
import { FinancialTransactionStateMachine } from '../../src/domains/finance/services/FinancialTransactionStateMachine';
import { AccountClassPolicy } from '../../src/domains/finance/policies/AccountClassPolicy';
import { AccountStatusPolicy } from '../../src/domains/finance/policies/AccountStatusPolicy';
import { AssetStatusPolicy } from '../../src/domains/finance/policies/AssetStatusPolicy';
import {
  AccountingEntryPolicy,
  AccountingMatrixValidationError,
} from '../../src/domains/finance/policies/AccountingEntryPolicy';
import { Money256 } from '../../src/domains/finance/value-objects/Money256';
import {
  InvalidAccountClassError,
  AccountInactiveError,
  AssetInactiveError,
  InvalidIdentifierError,
} from '../../src/domains/finance/errors/FinancialError';

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

    it('deve tratar self-transition de pending e processing como no-op, mas rejeitar em completed e terminais', () => {
      const resPending = FinancialTransactionStateMachine.transition('pending', 'pending');
      expect(resPending.isSuccess).toBe(true);
      expect(resPending.getValue()).toBe('pending');

      const resProcessing = FinancialTransactionStateMachine.transition('processing', 'processing');
      expect(resProcessing.isSuccess).toBe(true);
      expect(resProcessing.getValue()).toBe('processing');

      const resCompleted = FinancialTransactionStateMachine.transition('completed', 'completed');
      expect(resCompleted.isFailure).toBe(true);
      expect(resCompleted.error).toContain('completed');

      const resFailed = FinancialTransactionStateMachine.transition('failed', 'failed');
      expect(resFailed.isFailure).toBe(true);
      expect(resFailed.error).toContain('terminal');
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

  describe('DOD-10: AccountClassPolicy (Strict Accounting Matrix)', () => {
    it('deve validar corretamente combinações autorizadas de accountType e accountClass', () => {
      expect(() => AccountClassPolicy.validate('treasury', 'asset')).not.toThrow();
      expect(() => AccountClassPolicy.validate('user_available', 'liability')).not.toThrow();
      expect(() => AccountClassPolicy.validate('operating', 'asset')).not.toThrow();
      expect(() => AccountClassPolicy.validate('fees', 'revenue')).not.toThrow();
      expect(() => AccountClassPolicy.validate('reserve', 'asset')).not.toThrow();
      expect(() => AccountClassPolicy.validate('reserve', 'liability')).not.toThrow();
      expect(() => AccountClassPolicy.validate('clearing', 'asset')).not.toThrow();
      expect(() => AccountClassPolicy.validate('clearing', 'liability')).not.toThrow();
    });

    it('deve rejeitar combinações incompatíveis', () => {
      expect(() => AccountClassPolicy.validate('treasury', 'liability')).toThrow(InvalidAccountClassError);
      expect(() => AccountClassPolicy.validate('user_available', 'asset')).toThrow(InvalidAccountClassError);
      expect(() => AccountClassPolicy.validate('fees', 'expense')).toThrow(InvalidAccountClassError);
    });

    it('deve rejeitar tipos ou classes não reconhecidos ou vazios', () => {
      expect(() => AccountClassPolicy.validate('', 'asset')).toThrow(InvalidAccountClassError);
      expect(() => AccountClassPolicy.validate('treasury', '')).toThrow(InvalidAccountClassError);
      expect(() => AccountClassPolicy.validate('tipo_invalido', 'asset')).toThrow(InvalidAccountClassError);
      expect(() => AccountClassPolicy.validate('treasury', 'classe_invalida')).toThrow(InvalidAccountClassError);
    });

    it('deve retornar default determinístico apenas quando houver exatamente uma classe possível', () => {
      expect(AccountClassPolicy.getDefaultClass('treasury')).toBe('asset');
      expect(AccountClassPolicy.getDefaultClass('user_available')).toBe('liability');
      expect(AccountClassPolicy.getDefaultClass('fees')).toBe('revenue');

      // Tipos multi-classe devem rejeitar default arbitrário
      expect(() => AccountClassPolicy.getDefaultClass('reserve')).toThrow(InvalidAccountClassError);
      expect(() => AccountClassPolicy.getDefaultClass('clearing')).toThrow(InvalidAccountClassError);
      expect(() => AccountClassPolicy.getDefaultClass('opening_balance_equity')).toThrow(InvalidAccountClassError);
    });

    it('deve garantir imutabilidade da matriz de classes permitidas', () => {
      const classes = AccountClassPolicy.getPermittedClasses('treasury');
      expect(classes).toEqual(['asset']);
      expect(Object.isFrozen(classes)).toBe(true);
    });
  });

  describe('DOD-10: AccountStatusPolicy & AssetStatusPolicy', () => {
    it('deve permitir contas e ativos ativas', () => {
      expect(() => AccountStatusPolicy.validateActive({ id: 1, status: 'active' })).not.toThrow();
      expect(() => AssetStatusPolicy.validateActive({ id: 10, status: 'active' })).not.toThrow();
      expect(() => AssetStatusPolicy.validateActive(10, 'active')).not.toThrow();
    });

    it('deve rejeitar contas inativas ou suspensas com AccountInactiveError', () => {
      expect(() => AccountStatusPolicy.validateActive({ id: 1, status: 'inactive' })).toThrow(AccountInactiveError);
      expect(() => AccountStatusPolicy.validateActive({ id: 1, status: 'suspended' })).toThrow(AccountInactiveError);
      expect(() => AccountStatusPolicy.validateActive({ id: 1, status: 'blocked' })).toThrow(AccountInactiveError);
    });

    it('deve rejeitar contexto de conta malformado ou ID não-positivo em AccountStatusPolicy', () => {
      expect(() => AccountStatusPolicy.validateActive(null as any)).toThrow(AccountInactiveError);
      expect(() => AccountStatusPolicy.validateActive({ id: 0, status: 'active' })).toThrow(AccountInactiveError);
      expect(() => AccountStatusPolicy.validateActive({ id: -1, status: 'active' })).toThrow(AccountInactiveError);
      expect(() => AccountStatusPolicy.validateActive({ id: 1.5, status: 'active' })).toThrow(AccountInactiveError);
      expect(() => AccountStatusPolicy.validateActive({ id: 1, status: 'status_invalido' as any })).toThrow(AccountInactiveError);
    });

    it('deve rejeitar ativos inativos com AssetInactiveError', () => {
      expect(() => AssetStatusPolicy.validateActive({ id: 10, status: 'suspended' })).toThrow(AssetInactiveError);
      expect(() => AssetStatusPolicy.validateActive({ id: 10, status: 'inactive' })).toThrow(AssetInactiveError);
      expect(() => AssetStatusPolicy.validateActive(10, 'suspended')).toThrow(AssetInactiveError);
    });

    it('deve validar assetId positivo seguro e status conhecido em AssetStatusPolicy', () => {
      expect(() => AssetStatusPolicy.validateActive({ id: 0, status: 'active' })).toThrow(InvalidIdentifierError);
      expect(() => AssetStatusPolicy.validateActive({ id: -5, status: 'active' })).toThrow(InvalidIdentifierError);
      expect(() => AssetStatusPolicy.validateActive({ id: 10, status: 'status_fantasma' as any })).toThrow(AssetInactiveError);
    });

    it('deve validar status via Result kernel em AssetStatusPolicy.validateActiveResult', () => {
      const okRes = AssetStatusPolicy.validateActiveResult(1, 'active');
      expect(okRes.isSuccess).toBe(true);

      const failRes = AssetStatusPolicy.validateActiveResult(1, 'suspended');
      expect(failRes.isFailure).toBe(true);
      expect(failRes.error).toContain("esperado: 'active'");

      const invalidStatusRes = AssetStatusPolicy.validateActiveResult(1, 'invalido');
      expect(invalidStatusRes.isFailure).toBe(true);
      expect(invalidStatusRes.error).toContain('possui status inválido');
    });
  });

  describe('AccountingEntryPolicy (Strict Banking Invariants)', () => {
    it('deve rejeitar estritamente entryType inválido (não inferir como crédito)', () => {
      expect(() => {
        AccountingEntryPolicy.validateEntriesBalance([
          { accountId: 1, assetId: 1, entryType: 'debit', amount: Money256.fromBigInt(100n, 1), description: 'd' },
          { accountId: 2, assetId: 1, entryType: 'DEBITTT' as any, amount: Money256.fromBigInt(100n, 1), description: 'c' },
        ]);
      }).toThrow(AccountingMatrixValidationError);

      expect(() => {
        AccountingEntryPolicy.validateEntriesBalance([
          { accountId: 1, assetId: 1, entryType: 'debit', amount: Money256.fromBigInt(100n, 1), description: 'd' },
          { accountId: 2, assetId: 1, entryType: 'foo' as any, amount: Money256.fromBigInt(100n, 1), description: 'c' },
        ]);
      }).toThrow(AccountingMatrixValidationError);
    });

    it('deve rejeitar spoofing de Money256 em runtime', () => {
      const fakeMoney = {
        isPositive: () => true,
        toBigInt: () => 100n,
        assetId: 1,
        toCanonicalString: () => '100',
      };

      expect(() => {
        AccountingEntryPolicy.validateEntriesBalance([
          { accountId: 1, assetId: 1, entryType: 'debit', amount: fakeMoney as any, description: 'spoof' },
          { accountId: 2, assetId: 1, entryType: 'credit', amount: fakeMoney as any, description: 'spoof' },
        ]);
      }).toThrow(AccountingMatrixValidationError);
    });

    it('deve rejeitar lista de lançamentos com mais de 100 itens (proteção DoS)', () => {
      const entries = Array.from({ length: 102 }, (_, i) => ({
        accountId: i + 1,
        assetId: 1,
        entryType: i % 2 === 0 ? ('debit' as const) : ('credit' as const),
        amount: Money256.fromBigInt(10n, 1),
        description: `Entry ${i}`,
      }));

      expect(() => AccountingEntryPolicy.validateEntriesBalance(entries)).toThrow(
        /não pode possuir mais de 100/
      );
    });

    it('deve rejeitar incoerência de assetId entre spec e Money256', () => {
      expect(() => {
        AccountingEntryPolicy.validateEntriesBalance([
          { accountId: 1, assetId: 1, entryType: 'debit', amount: Money256.fromBigInt(100n, 2), description: 'mismatch' },
          { accountId: 2, assetId: 1, entryType: 'credit', amount: Money256.fromBigInt(100n, 2), description: 'mismatch' },
        ]);
      }).toThrow(AccountingMatrixValidationError);
    });

    it('deve rejeitar auto-transferência (mesma conta origem e destino)', () => {
      expect(() => {
        AccountingEntryPolicy.createTransferEntries({
          sourceAccountId: 1,
          destinationAccountId: 1,
          amount: Money256.fromBigInt(100n, 1),
          description: 'Auto-transferência',
        });
      }).toThrow(AccountingMatrixValidationError);
    });

    it('deve rejeitar conversão entre o mesmo ativo', () => {
      expect(() => {
        AccountingEntryPolicy.createConversionEntries({
          userAccountId: 1,
          clearingAccountId: 2,
          fromAmount: Money256.fromBigInt(100n, 1),
          toAmount: Money256.fromBigInt(100n, 1), // mesmo assetId!
          description: 'Same asset conversion',
        });
      }).toThrow(AccountingMatrixValidationError);
    });

    it('deve rejeitar descrição com caracteres de controle ASCII', () => {
      expect(() => {
        AccountingEntryPolicy.createDepositEntries({
          treasuryAccountId: 1,
          userAccountId: 2,
          amount: Money256.fromBigInt(100n, 1),
          description: 'Depósito com controle\u0000malicioso',
        });
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

    it('deve estornar invertendo debit e credit com validação estrita em createReversalEntries', () => {
      const origEntries = [
        { accountId: 1, assetId: 1, entryType: 'debit' as const, amount: Money256.fromBigInt(50n, 1), description: 'Orig Debit' },
        { accountId: 2, assetId: 1, entryType: 'credit' as const, amount: Money256.fromBigInt(50n, 1), description: 'Orig Credit' },
      ];

      const rev = AccountingEntryPolicy.createReversalEntries(origEntries, 'Estorno solicitado');
      expect(rev).toHaveLength(2);
      expect(rev[0].entryType).toBe('credit');
      expect(rev[1].entryType).toBe('debit');
      expect(rev[0].description).toContain('Reversal (Estorno solicitado)');

      // Rejeita reversal com entryType inválido no original
      expect(() => {
        AccountingEntryPolicy.createReversalEntries([
          { accountId: 1, assetId: 1, entryType: 'invalido' as any, amount: Money256.fromBigInt(50n, 1), description: 'Bad' },
        ], 'Motivo');
      }).toThrow(AccountingMatrixValidationError);
    });

    it('deve filtrar lançamento de receita por revenueAccountId em extractRefundablePaymentAmount', () => {
      const entries = [
        { accountId: 5, direction: 'credit', assetId: 1, amountBaseUnits: '5' },  // Fee revenue
        { accountId: 10, direction: 'credit', assetId: 1, amountBaseUnits: '95' }, // Merchant revenue
      ];

      const res = AccountingEntryPolicy.extractRefundablePaymentAmount(entries as any, 1, 10);
      expect(res.toCanonicalString()).toBe('95');

      expect(() => AccountingEntryPolicy.extractRefundablePaymentAmount(entries as any, 1, 999)).toThrow(AccountingMatrixValidationError);

      // Chamada sem revenueAccountId deve lançar erro de obrigatoriedade
      expect(() => AccountingEntryPolicy.extractRefundablePaymentAmount(entries as any, 1)).toThrow(
        /revenueAccountId é obrigatório/
      );
    });

    it('deve rejeitar parâmetros de operação nulos, primitivos ou malformados (assertOperationParams)', () => {
      expect(() => AccountingEntryPolicy.createDepositEntries(null as any)).toThrow('Parâmetros da operação contábil inválidos.');
      expect(() => AccountingEntryPolicy.createWithdrawalEntries(undefined as any)).toThrow('Parâmetros da operação contábil inválidos.');
      expect(() => AccountingEntryPolicy.createPaymentEntries([] as any)).toThrow('Parâmetros da operação contábil inválidos.');
      expect(() => AccountingEntryPolicy.createRefundEntries('string' as any)).toThrow('Parâmetros da operação contábil inválidos.');
    });

    it('deve rejeitar mesma conta em ambos os lados da operação (assertDistinctAccounts)', () => {
      const money = Money256.fromBigInt(100n, 1);

      // Depósito com treasury e user idênticos
      expect(() => AccountingEntryPolicy.createDepositEntries({
        treasuryAccountId: 5,
        userAccountId: 5,
        amount: money,
        description: 'Mesma conta',
      })).toThrow(/não podem ser idênticas em um depósito/);

      // Retirada com treasury e user idênticos
      expect(() => AccountingEntryPolicy.createWithdrawalEntries({
        treasuryAccountId: 5,
        userAccountId: 5,
        amount: money,
        description: 'Mesma conta',
      })).toThrow(/não podem ser idênticas em uma retirada/);

      // Pagamento com user e receita idênticos
      expect(() => AccountingEntryPolicy.createPaymentEntries({
        userAccountId: 10,
        paymentRevenueAccountId: 10,
        amount: money,
        description: 'Mesma conta',
      })).toThrow(/não podem ser idênticas/);

      // Reembolso com despesa e user idênticos
      expect(() => AccountingEntryPolicy.createRefundEntries({
        refundExpenseAccountId: 20,
        userAccountId: 20,
        amount: money,
        description: 'Mesma conta',
      })).toThrow(/não podem ser idênticas/);

      // Fee com user e fee account idênticos
      expect(() => AccountingEntryPolicy.createFeeEntries({
        userAccountId: 30,
        feeAccountId: 30,
        amount: money,
        description: 'Mesma conta',
      })).toThrow(/não podem ser idênticas/);

      // Ajuste com débito e crédito idênticos
      expect(() => AccountingEntryPolicy.createAdjustmentEntries({
        debitAccountId: 40,
        creditAccountId: 40,
        amount: money,
        reason: 'Ajuste mesma conta',
        authorizedByUserId: 1,
      })).toThrow(/não podem ser idênticas em um ajuste/);

      // Opening Balance com destino e equity idênticos
      expect(() => AccountingEntryPolicy.createOpeningBalanceEntries({
        targetAccountId: 50,
        openingEquityAccountId: 50,
        amount: money,
        description: 'Opening mesma conta',
        authorizedByUserId: 1,
      })).toThrow(/não podem ser idênticas/);
    });

    it('deve sanitizar caracteres de controle em normalizeDisplayName e normalizeDisplayCode', () => {
      // AccountStatusPolicy com controle no nome
      expect(() => AccountStatusPolicy.validateActive({
        id: 1,
        status: 'inactive',
        name: 'Conta\u0000Injetada',
      })).toThrow('(desconhecida)');

      // AssetStatusPolicy com controle no código
      expect(() => AssetStatusPolicy.validateActive({
        id: 1,
        status: 'inactive',
        code: 'BRL\u0007Ctrl',
      })).toThrow('(desconhecido)');
    });
  });
});
