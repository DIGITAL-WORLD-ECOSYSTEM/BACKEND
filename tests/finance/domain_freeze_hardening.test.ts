import { describe, it, expect } from 'vitest';
import {
  Money256,
  MAX_UINT256,
  parsePositiveSafeIntegerId,
} from '../../src/domains/finance/value-objects/Money256';
import { BaseUnits } from '../../src/domains/finance/value-objects/BaseUnits';
import {
  FinancialTextPolicy,
  MAX_LEDGER_DESCRIPTION_LENGTH,
  DANGEROUS_TEXT_CHARACTERS_REGEX,
} from '../../src/domains/finance/policies/FinancialTextPolicy';
import {
  LedgerTransaction,
  LedgerEntry,
} from '../../src/domains/finance/entities/LedgerTransaction';
import { FinancialTransactionStateMachine } from '../../src/domains/finance/services/FinancialTransactionStateMachine';
import {
  AccountingEntryPolicy,
  AccountingMatrixValidationError,
} from '../../src/domains/finance/policies/AccountingEntryPolicy';
import { AccountStatusPolicy } from '../../src/domains/finance/policies/AccountStatusPolicy';
import { AssetStatusPolicy } from '../../src/domains/finance/policies/AssetStatusPolicy';
import { validateCanonicalLedgerEntryRecord } from '../../src/domains/finance/contracts/FinancialLedgerEntryRecord';
import {
  FinancialError,
  FinancialValidationError,
  AccountInactiveError,
  AssetInactiveError,
  InvalidMoneyFormatError,
  Money256OverflowError,
  MoneyUnderflowError,
  CurrencyMismatchError,
  InvalidIdentifierError,
  InvalidLedgerTransactionError,
  InsufficientBalanceError,
  AccountOwnershipError,
  OptimisticConcurrencyError,
  InvalidStateTransitionError,
  InvalidAccountClassError,
  FinancialArithmeticError,
  InvalidRefundAmountError,
  IdempotencyConflictError,
  IdempotencyInProgressError,
  ReversalAlreadyExistsError,
  ExternalEventPayloadConflictError,
  FinancialRangeError,
  UnsupportedFinancialOperationError,
  InvalidFinancialOperationError,
} from '../../src/domains/finance/errors/FinancialError';
import { LedgerImbalanceError } from '../../src/domains/finance/errors/LedgerImbalanceError';
import { mapFinancialErrorToHttpStatus } from '../../src/application/finance/errors/FinancialErrorMapper';

describe('Domain Freeze — RC1 Hardening Suite', () => {
  describe('1. Money256 & EVM uint256 Safety', () => {
    it('deve aceitar MAX_UINT256 e rejeitar MAX_UINT256 + 1', () => {
      const maxStr = MAX_UINT256.toString(10);
      const mMax = Money256.fromString(maxStr, 1);
      expect(mMax.toBigInt()).toBe(MAX_UINT256);

      const overMax = MAX_UINT256 + 1n;
      expect(() => Money256.fromBigInt(overMax, 1)).toThrow(Money256OverflowError);
    });

    it('deve permitir zero e proibir montante negativo', () => {
      const zero = Money256.zero(1);
      expect(zero.isZero()).toBe(true);
      expect(() => Money256.fromBigInt(-1n, 1)).toThrow(InvalidMoneyFormatError);
    });

    it('deve proibir underflow na subtração', () => {
      const a = Money256.fromString('10', 1);
      const b = Money256.fromString('20', 1);
      expect(() => a.subtract(b)).toThrow(MoneyUnderflowError);
    });

    it('deve rejeitar operações entre ativos diferentes', () => {
      const a = Money256.fromString('10', 1);
      const b = Money256.fromString('10', 2);
      expect(() => a.add(b)).toThrow(CurrencyMismatchError);
      expect(() => a.greaterThan(b)).toThrow(CurrencyMismatchError);
    });

    it('deve blindar todas as operações contra duck-typing / objetos forjados', () => {
      const realMoney = Money256.fromString('100', 1);
      const fakeMoney = { assetId: 1, amount: 100n } as any;

      expect(() => realMoney.add(fakeMoney)).toThrow(InvalidMoneyFormatError);
      expect(() => realMoney.subtract(fakeMoney)).toThrow(InvalidMoneyFormatError);
      expect(() => realMoney.greaterThan(fakeMoney)).toThrow(InvalidMoneyFormatError);
      expect(() => realMoney.greaterThanOrEqual(fakeMoney)).toThrow(InvalidMoneyFormatError);
      expect(() => realMoney.lessThan(fakeMoney)).toThrow(InvalidMoneyFormatError);
      expect(() => realMoney.lessThanOrEqual(fakeMoney)).toThrow(InvalidMoneyFormatError);

      // equals retorna false sem lançar TypeError
      expect(realMoney.equals(fakeMoney)).toBe(false);
      expect(realMoney.equals(null)).toBe(false);
      expect(realMoney.equals(undefined)).toBe(false);
      expect(realMoney.equals('100')).toBe(false);
    });
  });

  describe('2. Identificadores Canônicos (parsePositiveSafeIntegerId)', () => {
    it('deve aceitar formatos canônicos válidos (number e string)', () => {
      expect(parsePositiveSafeIntegerId(123)).toBe(123);
      expect(parsePositiveSafeIntegerId('123')).toBe(123);
      expect(parsePositiveSafeIntegerId(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
      expect(parsePositiveSafeIntegerId(String(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER);
    });

    it('deve rejeitar representações não-canônicas sem converter silenciosamente', () => {
      // Espaços
      expect(() => parsePositiveSafeIntegerId(' 123 ')).toThrow(InvalidIdentifierError);
      expect(() => parsePositiveSafeIntegerId(' 123')).toThrow(InvalidIdentifierError);
      expect(() => parsePositiveSafeIntegerId('123 ')).toThrow(InvalidIdentifierError);

      // Zeros à esquerda
      expect(() => parsePositiveSafeIntegerId('00123')).toThrow(InvalidIdentifierError);
      expect(() => parsePositiveSafeIntegerId('01')).toThrow(InvalidIdentifierError);

      // Sinais
      expect(() => parsePositiveSafeIntegerId('+123')).toThrow(InvalidIdentifierError);
      expect(() => parsePositiveSafeIntegerId('-123')).toThrow(InvalidIdentifierError);

      // Notação científica e hex
      expect(() => parsePositiveSafeIntegerId('1e2')).toThrow(InvalidIdentifierError);
      expect(() => parsePositiveSafeIntegerId('0x10')).toThrow(InvalidIdentifierError);

      // Decimais
      expect(() => parsePositiveSafeIntegerId('123.0')).toThrow(InvalidIdentifierError);
      expect(() => parsePositiveSafeIntegerId(1.5)).toThrow(InvalidIdentifierError);

      // Zero e negativos
      expect(() => parsePositiveSafeIntegerId('0')).toThrow(InvalidIdentifierError);
      expect(() => parsePositiveSafeIntegerId(0)).toThrow(InvalidIdentifierError);
      expect(() => parsePositiveSafeIntegerId(-1)).toThrow(InvalidIdentifierError);

      // Fora de safe integer
      expect(() => parsePositiveSafeIntegerId(Number.MAX_SAFE_INTEGER + 1)).toThrow(InvalidIdentifierError);
      expect(() => parsePositiveSafeIntegerId(NaN)).toThrow(InvalidIdentifierError);
      expect(() => parsePositiveSafeIntegerId(Infinity)).toThrow(InvalidIdentifierError);
      expect(() => parsePositiveSafeIntegerId(null)).toThrow(InvalidIdentifierError);
    });
  });

  describe('3. Descrições Contábeis & Formatação de Reversal', () => {
    it('deve aceitar descrições válidas até 255 caracteres', () => {
      const valid254 = 'a'.repeat(254);
      const valid255 = 'a'.repeat(255);

      expect(FinancialTextPolicy.normalizeSafeDescription(valid254)).toBe(valid254);
      expect(FinancialTextPolicy.normalizeSafeDescription(valid255)).toBe(valid255);
    });

    it('deve rejeitar descrições superiores a 255 caracteres', () => {
      const invalid256 = 'a'.repeat(256);
      expect(() => FinancialTextPolicy.normalizeSafeDescription(invalid256)).toThrow(InvalidLedgerTransactionError);
    });

    it('deve rejeitar caracteres de controle, bidi e zero-width em descrições', () => {
      expect(() => FinancialTextPolicy.normalizeSafeDescription('desc\u202Ereversed')).toThrow(InvalidLedgerTransactionError);
      expect(() => FinancialTextPolicy.normalizeSafeDescription('desc\u200Bhidden')).toThrow(InvalidLedgerTransactionError);
      expect(() => FinancialTextPolicy.normalizeSafeDescription('desc\u0000null')).toThrow(InvalidLedgerTransactionError);
      expect(() => FinancialTextPolicy.normalizeSafeDescription('desc\uFEFFbom')).toThrow(InvalidLedgerTransactionError);
    });

    it('deve formatar deterministicamente a descrição de estorno garantindo limite <= 255', () => {
      const longReason = 'Justificativa '.repeat(10);
      const longOrig = 'Original description '.repeat(20);

      const formatted = FinancialTextPolicy.formatReversalDescription(longReason, longOrig);
      expect(formatted.length).toBeLessThanOrEqual(MAX_LEDGER_DESCRIPTION_LENGTH);
      expect(formatted).toContain('Reversal (');
      expect(formatted).toContain('...');
    });
  });

  describe('4. Idempotency Key Rigorosa', () => {
    it('deve aceitar chave válida e rejeitar modificações silenciosas', () => {
      const key = 'ord_12345:pay_9876';
      expect(FinancialTextPolicy.assertSafeIdentifierText(key, 'idempotencyKey')).toBe(key);
    });

    it('deve rejeitar chaves com caracteres perigosos sem alterar silenciosamente', () => {
      expect(() => FinancialTextPolicy.assertSafeIdentifierText('key\u202Erev', 'idempotencyKey')).toThrow(InvalidIdentifierError);
      expect(() => FinancialTextPolicy.assertSafeIdentifierText('key\u200Binv', 'idempotencyKey')).toThrow(InvalidIdentifierError);
      expect(() => FinancialTextPolicy.assertSafeIdentifierText('key\u0000null', 'idempotencyKey')).toThrow(InvalidIdentifierError);
      expect(() => FinancialTextPolicy.assertSafeIdentifierText('k'.repeat(256), 'idempotencyKey')).toThrow(InvalidIdentifierError);
      expect(() => FinancialTextPolicy.assertSafeIdentifierText('', 'idempotencyKey')).toThrow(InvalidIdentifierError);
    });
  });

  describe('5. Cardinalidade de Ativos por Tipo de Transação', () => {
    const asset1EntryDebit = new LedgerEntry({ accountId: '1', amount: Money256.fromBigInt(100n, 1), type: 'debit' });
    const asset1EntryCredit = new LedgerEntry({ accountId: '2', amount: Money256.fromBigInt(100n, 1), type: 'credit' });

    const asset2EntryDebit = new LedgerEntry({ accountId: '3', amount: Money256.fromBigInt(50n, 2), type: 'debit' });
    const asset2EntryCredit = new LedgerEntry({ accountId: '4', amount: Money256.fromBigInt(50n, 2), type: 'credit' });

    it('deve aceitar deposit com 1 ativo e rejeitar com 2 ativos', () => {
      // 1 ativo: OK
      const txOk = LedgerTransaction.create({
        idempotencyKey: 'dep_1_asset',
        description: 'Depósito monoativo',
        transactionType: 'deposit',
        category: 'deposit',
        entries: [asset1EntryDebit, asset1EntryCredit],
      });
      expect(txOk).toBeDefined();

      // 2 ativos: FAIL
      expect(() => {
        LedgerTransaction.create({
          idempotencyKey: 'dep_2_assets',
          description: 'Depósito multiativo',
          transactionType: 'deposit',
          category: 'deposit',
          entries: [asset1EntryDebit, asset1EntryCredit, asset2EntryDebit, asset2EntryCredit],
        });
      }).toThrowError(/estritamente monoativo/);
    });

    it('deve aceitar transfer com 1 ativo e rejeitar com 2 ativos', () => {
      // 1 ativo: OK
      const txOk = LedgerTransaction.create({
        idempotencyKey: 'transfer_1_asset',
        description: 'Transferência monoativo',
        transactionType: 'transfer',
        category: 'operational',
        entries: [asset1EntryDebit, asset1EntryCredit],
      });
      expect(txOk).toBeDefined();

      // 2 ativos: FAIL
      expect(() => {
        LedgerTransaction.create({
          idempotencyKey: 'transfer_2_assets',
          description: 'Transferência multiativo',
          transactionType: 'transfer',
          category: 'operational',
          entries: [asset1EntryDebit, asset1EntryCredit, asset2EntryDebit, asset2EntryCredit],
        });
      }).toThrowError(/estritamente monoativo/);
    });

    it('deve aceitar reversal de operação monoativo (1 ativo)', () => {
      const tx = LedgerTransaction.create({
        idempotencyKey: 'rev_1_asset',
        description: 'Estorno monoativo',
        transactionType: 'reversal',
        reversalOfTransactionId: 100,
        category: 'operational',
        entries: [asset1EntryDebit, asset1EntryCredit],
      });
      expect(tx.transactionType).toBe('reversal');
      expect(tx.entries.length).toBe(2);
    });

    it('deve aceitar reversal de conversão (2 ativos distintos)', () => {
      const tx = LedgerTransaction.create({
        idempotencyKey: 'rev_2_assets',
        description: 'Estorno de conversão (2 ativos)',
        transactionType: 'reversal',
        reversalOfTransactionId: 200,
        category: 'operational',
        entries: [asset1EntryDebit, asset1EntryCredit, asset2EntryDebit, asset2EntryCredit],
      });
      expect(tx.transactionType).toBe('reversal');
      expect(tx.entries.length).toBe(4);
    });

    it('deve rejeitar reversal com 3 ativos', () => {
      const asset3Debit = new LedgerEntry({ accountId: '5', amount: Money256.fromBigInt(10n, 3), type: 'debit' });
      const asset3Credit = new LedgerEntry({ accountId: '6', amount: Money256.fromBigInt(10n, 3), type: 'credit' });

      expect(() => {
        LedgerTransaction.create({
          idempotencyKey: 'rev_3_assets',
          description: 'Estorno inválido com 3 ativos',
          transactionType: 'reversal',
          reversalOfTransactionId: 300,
          category: 'operational',
          entries: [
            asset1EntryDebit,
            asset1EntryCredit,
            asset2EntryDebit,
            asset2EntryCredit,
            asset3Debit,
            asset3Credit,
          ],
        });
      }).toThrowError(/admitem apenas 1 ou 2 ativos/);
    });
  });

  describe('6. State Machine Terminalidade Estrita', () => {
    it('deve permitir no-op para pending -> pending e processing -> processing', () => {
      const p1 = FinancialTransactionStateMachine.transition('pending', 'pending');
      expect(p1.isSuccess).toBe(true);

      const p2 = FinancialTransactionStateMachine.transition('processing', 'processing');
      expect(p2.isSuccess).toBe(true);
    });

    it('deve rejeitar auto-transição e transições a partir de estados terminais', () => {
      const terminals = ['failed', 'cancelled', 'reversed', 'refunded'] as const;

      for (const t of terminals) {
        const selfRes = FinancialTransactionStateMachine.transition(t, t);
        expect(selfRes.isFailure).toBe(true);
        expect(selfRes.error).toContain('terminal');

        const outRes = FinancialTransactionStateMachine.transition(t, 'completed');
        expect(outRes.isFailure).toBe(true);
        expect(outRes.error).toContain('terminal');
      }
    });

    it('deve rejeitar completed -> completed (reposting proibido)', () => {
      const res = FinancialTransactionStateMachine.transition('completed', 'completed');
      expect(res.isFailure).toBe(true);
      expect(res.error).toContain('completed');
    });

    it('deve permitir completed -> reversed e completed -> refunded', () => {
      expect(FinancialTransactionStateMachine.transition('completed', 'reversed').isSuccess).toBe(true);
      expect(FinancialTransactionStateMachine.transition('completed', 'refunded').isSuccess).toBe(true);
    });

    it('deve proibir transições ilegais backwards', () => {
      expect(FinancialTransactionStateMachine.transition('reversed', 'completed').isFailure).toBe(true);
      expect(FinancialTransactionStateMachine.transition('cancelled', 'processing').isFailure).toBe(true);
    });
  });

  describe('7. extractRefundablePaymentAmount Hardening', () => {
    it('deve rejeitar chamada com array vazio ou nulo', () => {
      expect(() => AccountingEntryPolicy.extractRefundablePaymentAmount([], 1, 10)).toThrow(AccountingMatrixValidationError);
      expect(() => AccountingEntryPolicy.extractRefundablePaymentAmount(null as any, 1, 10)).toThrow(AccountingMatrixValidationError);
    });

    it('deve rejeitar registros contábeis malformados', () => {
      const badEntries = [
        { accountId: 'invalid' as any, assetId: 1, direction: 'credit', amountBaseUnits: '100' },
      ];
      expect(() => AccountingEntryPolicy.extractRefundablePaymentAmount(badEntries as any, 1, 10)).toThrow(AccountingMatrixValidationError);
    });

    it('deve rejeitar quando houver múltiplos créditos de receita para o mesmo ativo e conta', () => {
      const dupEntries = [
        { accountId: 10, assetId: 1, direction: 'credit', amountBaseUnits: '50' },
        { accountId: 10, assetId: 1, direction: 'credit', amountBaseUnits: '50' },
      ];
      expect(() => AccountingEntryPolicy.extractRefundablePaymentAmount(dupEntries as any, 1, 10)).toThrow(/múltiplos lançamentos/);
    });

    it('deve rejeitar quando não houver nenhum crédito de receita correspondente', () => {
      const entries = [
        { accountId: 10, assetId: 1, direction: 'debit', amountBaseUnits: '50' },
      ];
      expect(() => AccountingEntryPolicy.extractRefundablePaymentAmount(entries as any, 1, 10)).toThrow(/não possui lançamento de receita/);
    });

    it('deve extrair montante corretamente quando houver exatamente um crédito correspondente', () => {
      const entries = [
        { accountId: 10, assetId: 1, direction: 'credit', amountBaseUnits: '2500' },
        { accountId: 20, assetId: 1, direction: 'debit', amountBaseUnits: '2500' },
      ];
      const amount = AccountingEntryPolicy.extractRefundablePaymentAmount(entries as any, 1, 10);
      expect(amount.toCanonicalString()).toBe('2500');
    });
  });

  describe('8. Meta-Auditoria Gate Certifications (Economic Identity, Error Details, Aggregate Barriers)', () => {
    it('deve distinguir rigorosamente a identidade econômica entre ativos em Money256 (equals e add)', () => {
      const brl100 = Money256.fromBigInt(100n, 1);
      const btc100 = Money256.fromBigInt(100n, 2);

      // Quantias idênticas de ativos diferentes NUNCA são iguais
      expect(brl100.equals(btc100)).toBe(false);

      // Aritmética entre ativos diferentes é estritamente proibida
      expect(() => brl100.add(btc100)).toThrow(CurrencyMismatchError);
      expect(() => brl100.subtract(btc100)).toThrow(CurrencyMismatchError);
    });

    it('deve sanitizar profundamente details em FinancialError contra retenção de referências mutáveis', () => {
      const maliciousObj = {
        token: 'secret-token-123',
        nested: { role: 'admin' },
      };

      class TestFinancialError extends InvalidMoneyFormatError {}
      const err = new TestFinancialError('Erro de teste', maliciousObj as any);

      // Primitivos são preservados de forma imutável
      expect(err.details).toBeDefined();
      expect(err.details?.token).toBe('secret-token-123');

      // Objetos aninhados são convertidos para string segura e não mantêm ponteiros mutáveis
      expect(typeof err.details?.nested).toBe('string');

      // Modificação externa posterior no objeto de origem NÃO afeta o erro
      maliciousObj.token = 'tampered-token';
      expect(err.details?.token).toBe('secret-token-123');
    });

    it('deve garantir barreira do agregado em LedgerTransaction.create contra caracteres proibidos', () => {
      const validEntryDebit = new LedgerEntry({
        accountId: '1',
        amount: Money256.fromBigInt(100n, 1),
        type: 'debit',
      });
      const validEntryCredit = new LedgerEntry({
        accountId: '2',
        amount: Money256.fromBigInt(100n, 1),
        type: 'credit',
      });

      // Bidi em description
      expect(() =>
        LedgerTransaction.create({
          idempotencyKey: 'valid-idempotency-key-001',
          description: 'Desc \u202E RTL spoof',
          transactionType: 'deposit',
          category: 'deposit',
          entries: [validEntryDebit, validEntryCredit],
        })
      ).toThrow(InvalidLedgerTransactionError);

      // Zero-width em idempotencyKey
      expect(() =>
        LedgerTransaction.create({
          idempotencyKey: 'key\u200Bzero',
          description: 'Valid description',
          transactionType: 'deposit',
          category: 'deposit',
          entries: [validEntryDebit, validEntryCredit],
        })
      ).toThrow(InvalidLedgerTransactionError);
    });

    it('deve classificar tipadamente transições via evaluateTransition (NO_OP / CHANGED / INVALID)', () => {
      const noOpRes = FinancialTransactionStateMachine.evaluateTransition('pending', 'pending');
      expect(noOpRes.kind).toBe('NO_OP');
      if (noOpRes.kind === 'NO_OP') {
        expect(noOpRes.status).toBe('pending');
      }

      const changedRes = FinancialTransactionStateMachine.evaluateTransition('pending', 'processing');
      expect(changedRes.kind).toBe('CHANGED');
      if (changedRes.kind === 'CHANGED') {
        expect(changedRes.status).toBe('processing');
      }

      const invalidRes = FinancialTransactionStateMachine.evaluateTransition('completed', 'processing');
      expect(invalidRes.kind).toBe('INVALID');
      if (invalidRes.kind === 'INVALID') {
        expect(invalidRes.error).toBeDefined();
        expect((invalidRes as any).status).toBeUndefined();
      }
    });
  });

  describe('Domain Freeze — RC2 Hardening & Invariant Specifications', () => {
    describe('[F1] Pre-parser Lexical Limits & Scaled Digits Hardening', () => {
      it('deve aceitar string com exatamente 78 dígitos menor ou igual a MAX_UINT256', () => {
        const maxStr = MAX_UINT256.toString(10);
        expect(maxStr.length).toBe(78);
        const m = Money256.fromString(maxStr, 1);
        expect(m.toBigInt()).toBe(MAX_UINT256);
      });

      it('deve rejeitar string com 78 dígitos que exceda MAX_UINT256', () => {
        const huge78 = '9' + '0'.repeat(77);
        expect(() => Money256.fromString(huge78, 1)).toThrow(Money256OverflowError);
      });

      it('deve rejeitar string com 79 dígitos antes da invocação do BigInt()', () => {
        const str79 = '1' + '0'.repeat(78);
        expect(() => Money256.fromString(str79, 1)).toThrow(Money256OverflowError);
      });

      it('deve rejeitar strings com 1.000 e 100.000 dígitos (DoS / Lexical boundary)', () => {
        const str1k = '1' + '0'.repeat(999);
        expect(() => Money256.fromString(str1k, 1)).toThrow(InvalidMoneyFormatError);

        const str100k = '1' + '0'.repeat(99999);
        expect(() => Money256.fromString(str100k, 1)).toThrow(InvalidMoneyFormatError);

        const str79 = '1' + '0'.repeat(78);
        expect(() => Money256.fromString(str79, 1)).toThrow(Money256OverflowError);
      });

      it('deve validar no BaseUnits.toBaseUnits que o valor escalado não excede 78 dígitos antes de BigInt', () => {
        const int70 = '1' + '0'.repeat(69);
        expect(() => BaseUnits.toBaseUnits(int70, 1, 18)).toThrow(Money256OverflowError);

        const int78 = '1' + '0'.repeat(77);
        expect(() => BaseUnits.toBaseUnits(int78, 1, 6)).toThrow(Money256OverflowError);
      });

      it('deve rejeitar em parsePositiveSafeIntegerId números com mais de 16 dígitos léxicos', () => {
        const safeLimit = String(Number.MAX_SAFE_INTEGER);
        expect(parsePositiveSafeIntegerId(safeLimit)).toBe(Number.MAX_SAFE_INTEGER);

        expect(() => parsePositiveSafeIntegerId('9007199254740992')).toThrow(InvalidIdentifierError);
        expect(() => parsePositiveSafeIntegerId('10000000000000000')).toThrow(InvalidIdentifierError);
      });
    });

    describe('[F2] Reversal Direction Strict Validation', () => {
      it('deve inverter rigorosamente debit -> credit e credit -> debit', () => {
        const origEntries = [
          { accountId: 1, assetId: 1, entryType: 'debit' as const, amount: Money256.fromString('100', 1), description: 'Original debit' },
          { accountId: 2, assetId: 1, entryType: 'credit' as const, amount: Money256.fromString('100', 1), description: 'Original credit' },
        ];

        const revEntries = AccountingEntryPolicy.createReversalEntries(origEntries, 'Estorno contábil auditado');
        expect(revEntries[0].entryType).toBe('credit');
        expect(revEntries[1].entryType).toBe('debit');
      });

      it('deve rejeitar direções inválidas e não cair em fallback perigoso', () => {
        const invalidDirections = [
          null,
          undefined,
          '',
          'DEBIT',
          'Debit',
          'foo',
          0,
          {},
          ['debit'],
          'credit ',
          ' debit',
        ];

        for (const badDir of invalidDirections) {
          const badEntries = [
            { accountId: 1, assetId: 1, entryType: badDir as any, amount: Money256.fromString('100', 1), description: 'Bad dir' },
            { accountId: 2, assetId: 1, entryType: 'credit' as const, amount: Money256.fromString('100', 1), description: 'Credit' },
          ];

          expect(() =>
            AccountingEntryPolicy.createReversalEntries(badEntries as any, 'Justificativa válida')
          ).toThrow(AccountingMatrixValidationError);
        }
      });
    });

    describe('[F3 & F6] Relational & Provenance Invariants no LedgerTransaction', () => {
      const validEntryDebit = new LedgerEntry({
        accountId: '1',
        amount: Money256.fromBigInt(100n, 1),
        type: 'debit',
      });
      const validEntryCredit = new LedgerEntry({
        accountId: '2',
        amount: Money256.fromBigInt(100n, 1),
        type: 'credit',
      });

      it('deve exigir reversalOfTransactionId exclusivamente para reversal', () => {
        expect(() =>
          LedgerTransaction.create({
            idempotencyKey: crypto.randomUUID(),
            description: 'Reversão sem ID',
            transactionType: 'reversal',
            category: 'operational',
            entries: [validEntryDebit, validEntryCredit],
          })
        ).toThrow(InvalidLedgerTransactionError);

        expect(() =>
          LedgerTransaction.create({
            idempotencyKey: crypto.randomUUID(),
            description: 'Reversão com refund ID',
            transactionType: 'reversal',
            category: 'operational',
            reversalOfTransactionId: 10,
            refundOfTransactionId: 20,
            entries: [validEntryDebit, validEntryCredit],
          })
        ).toThrow(InvalidLedgerTransactionError);

        const revTx = LedgerTransaction.create({
          idempotencyKey: crypto.randomUUID(),
          description: 'Reversão válida',
          transactionType: 'reversal',
          category: 'operational',
          reversalOfTransactionId: 10,
          entries: [validEntryDebit, validEntryCredit],
        });
        expect(revTx.reversalOfTransactionId).toBe(10);
        expect(revTx.refundOfTransactionId).toBeUndefined();
      });

      it('deve exigir refundOfTransactionId exclusivamente para refund', () => {
        expect(() =>
          LedgerTransaction.create({
            idempotencyKey: crypto.randomUUID(),
            description: 'Refund sem ID',
            transactionType: 'refund',
            category: 'operational',
            entries: [validEntryDebit, validEntryCredit],
          })
        ).toThrow(InvalidLedgerTransactionError);

        expect(() =>
          LedgerTransaction.create({
            idempotencyKey: crypto.randomUUID(),
            description: 'Refund com reversal ID',
            transactionType: 'refund',
            category: 'operational',
            refundOfTransactionId: 15,
            reversalOfTransactionId: 25,
            entries: [validEntryDebit, validEntryCredit],
          })
        ).toThrow(InvalidLedgerTransactionError);

        const refTx = LedgerTransaction.create({
          idempotencyKey: crypto.randomUUID(),
          description: 'Refund válido',
          transactionType: 'refund',
          category: 'operational',
          refundOfTransactionId: 15,
          entries: [validEntryDebit, validEntryCredit],
        });
        expect(refTx.refundOfTransactionId).toBe(15);
        expect(refTx.reversalOfTransactionId).toBeUndefined();
      });

      it('deve rejeitar reversalOfTransactionId e refundOfTransactionId em operações padrão', () => {
        expect(() =>
          LedgerTransaction.create({
            idempotencyKey: crypto.randomUUID(),
            description: 'Depósito com reversal ID',
            transactionType: 'deposit',
            category: 'deposit',
            reversalOfTransactionId: 123,
            entries: [validEntryDebit, validEntryCredit],
          })
        ).toThrow(InvalidLedgerTransactionError);

        expect(() =>
          LedgerTransaction.create({
            idempotencyKey: crypto.randomUUID(),
            description: 'Saque com refund ID',
            transactionType: 'withdrawal',
            category: 'withdrawal',
            refundOfTransactionId: 123,
            entries: [validEntryDebit, validEntryCredit],
          })
        ).toThrow(InvalidLedgerTransactionError);
      });

      it('deve exigir businessReason não-vazio obrigatoriamente para adjustment', () => {
        expect(() =>
          LedgerTransaction.create({
            idempotencyKey: crypto.randomUUID(),
            description: 'Ajuste sem razão',
            transactionType: 'adjustment',
            category: 'operational',
            entries: [validEntryDebit, validEntryCredit],
          })
        ).toThrow(InvalidLedgerTransactionError);

        expect(() =>
          LedgerTransaction.create({
            idempotencyKey: crypto.randomUUID(),
            description: 'Ajuste com razão em branco',
            transactionType: 'adjustment',
            category: 'operational',
            businessReason: '   ',
            entries: [validEntryDebit, validEntryCredit],
          })
        ).toThrow(InvalidLedgerTransactionError);

        const adjTx = LedgerTransaction.create({
          idempotencyKey: crypto.randomUUID(),
          description: 'Ajuste válido',
          transactionType: 'adjustment',
          category: 'operational',
          businessReason: 'Ajuste de conciliação fiscal auditado',
          entries: [validEntryDebit, validEntryCredit],
        });
        expect(adjTx.businessReason).toBe('Ajuste de conciliação fiscal auditado');
      });

      it('deve aplicar estrita paridade entre providerId e externalEventId (ambos presentes ou ambos ausentes)', () => {
        expect(() =>
          LedgerTransaction.create({
            idempotencyKey: crypto.randomUUID(),
            description: 'Apenas provider',
            transactionType: 'deposit',
            category: 'deposit',
            providerId: 'stripe',
            entries: [validEntryDebit, validEntryCredit],
          })
        ).toThrow(InvalidLedgerTransactionError);

        expect(() =>
          LedgerTransaction.create({
            idempotencyKey: crypto.randomUUID(),
            description: 'Apenas event',
            transactionType: 'deposit',
            category: 'deposit',
            externalEventId: 'evt_123',
            entries: [validEntryDebit, validEntryCredit],
          })
        ).toThrow(InvalidLedgerTransactionError);

        const tx = LedgerTransaction.create({
          idempotencyKey: crypto.randomUUID(),
          description: 'Ambos presentes',
          transactionType: 'deposit',
          category: 'deposit',
          providerId: 'stripe',
          externalEventId: 'evt_123',
          entries: [validEntryDebit, validEntryCredit],
        });
        expect(tx.providerId).toBe('stripe');
        expect(tx.externalEventId).toBe('evt_123');
      });
    });

    describe('[F4] Canonical ID Enforcement', () => {
      it('deve rejeitar IDs não-canônicos em AccountStatusPolicy e AssetStatusPolicy', () => {
        const nonCanonicalIds = ['01', '0x64', ' 100 ', '1e2', 0, -5, NaN, Infinity];

        for (const badId of nonCanonicalIds) {
          expect(() =>
            AccountStatusPolicy.validateActive({ id: badId as any, status: 'active' })
          ).toThrow(AccountInactiveError);

          expect(() =>
            AssetStatusPolicy.validateActive({ id: badId as any, status: 'active' })
          ).toThrow(InvalidIdentifierError);
        }
      });

      it('deve validar FinancialLedgerEntryRecord canonicamente', () => {
        const validRec = {
          accountId: 10,
          assetId: 1,
          direction: 'debit' as const,
          amountBaseUnits: '1000',
        };
        const canonical = validateCanonicalLedgerEntryRecord(validRec);
        expect(canonical.accountId).toBe(10);
        expect(canonical.assetId).toBe(1);

        expect(() =>
          validateCanonicalLedgerEntryRecord({
            ...validRec,
            accountId: '01' as any,
          })
        ).toThrow(InvalidIdentifierError);
      });
    });

    describe('[F5] Opening Balance Accounting Semantics', () => {
      it('deve gerar Dr Target / Cr Equity para Ativo (AssetOpeningBalance)', () => {
        const entries = AccountingEntryPolicy.createAssetOpeningBalanceEntries({
          targetAccountId: 10,
          openingEquityAccountId: 99,
          amount: Money256.fromString('500', 1),
          description: 'Abertura Ativo',
          authorizedByUserId: 1,
        });

        expect(entries[0].accountId).toBe(10);
        expect(entries[0].entryType).toBe('debit');
        expect(entries[1].accountId).toBe(99);
        expect(entries[1].entryType).toBe('credit');
      });

      it('deve gerar Dr Equity / Cr Target para Passivo (LiabilityOpeningBalance)', () => {
        const entries = AccountingEntryPolicy.createLiabilityOpeningBalanceEntries({
          targetAccountId: 20,
          openingEquityAccountId: 99,
          amount: Money256.fromString('500', 1),
          description: 'Abertura Passivo',
          authorizedByUserId: 1,
        });

        expect(entries[0].accountId).toBe(20);
        expect(entries[0].entryType).toBe('credit');
        expect(entries[1].accountId).toBe(99);
        expect(entries[1].entryType).toBe('debit');
      });

      it('deve gerar Dr Equity / Cr Target para Patrimônio Líquido (EquityOpeningBalance)', () => {
        const entries = AccountingEntryPolicy.createEquityOpeningBalanceEntries({
          targetAccountId: 30,
          openingEquityAccountId: 99,
          amount: Money256.fromString('500', 1),
          description: 'Abertura PL',
          authorizedByUserId: 1,
        });

        expect(entries[0].accountId).toBe(30);
        expect(entries[0].entryType).toBe('credit');
        expect(entries[1].accountId).toBe(99);
        expect(entries[1].entryType).toBe('debit');
      });

      it('deve despachar corretamente em createOpeningBalanceEntries por accountNature ou normalBalance', () => {
        const liabEntries = AccountingEntryPolicy.createOpeningBalanceEntries({
          targetAccountId: 20,
          openingEquityAccountId: 99,
          amount: Money256.fromString('500', 1),
          description: 'Despacho Passivo',
          authorizedByUserId: 1,
          accountNature: 'liability',
        });
        expect(liabEntries[0].entryType).toBe('credit');

        const equityEntries = AccountingEntryPolicy.createOpeningBalanceEntries({
          targetAccountId: 30,
          openingEquityAccountId: 99,
          amount: Money256.fromString('500', 1),
          description: 'Despacho Equity',
          authorizedByUserId: 1,
          accountNature: 'equity',
        });
        expect(equityEntries[0].entryType).toBe('credit');

        const normalCreditEntries = AccountingEntryPolicy.createOpeningBalanceEntries({
          targetAccountId: 20,
          openingEquityAccountId: 99,
          amount: Money256.fromString('500', 1),
          description: 'Despacho Normal Credit',
          authorizedByUserId: 1,
          normalBalance: 'credit',
        });
        expect(normalCreditEntries[0].entryType).toBe('credit');

        const defaultAssetEntries = AccountingEntryPolicy.createOpeningBalanceEntries({
          targetAccountId: 10,
          openingEquityAccountId: 99,
          amount: Money256.fromString('500', 1),
          description: 'Despacho Default Asset',
          authorizedByUserId: 1,
        });
        expect(defaultAssetEntries[0].entryType).toBe('debit');
      });
    });

    describe('[F7] Error Hierarchy, Scalar-Safety & Anti-Log-Injection', () => {
      it('deve serializar bigint em details como string decimal sem quebrar JSON.stringify', () => {
        const err = new Money256OverflowError('Overflow test', {
          max: MAX_UINT256,
          zero: 0n,
          arbitrary: 123456789012345678901234567890n,
          scalarStr: 'safe',
          scalarNum: 42,
          scalarBool: true,
          scalarNull: null,
        });

        expect(err.details?.max).toBe(MAX_UINT256.toString(10));
        expect(err.details?.zero).toBe('0');
        expect(err.details?.arbitrary).toBe('123456789012345678901234567890');
        expect(err.details?.scalarStr).toBe('safe');
        expect(err.details?.scalarNum).toBe(42);
        expect(err.details?.scalarBool).toBe(true);

        const json = JSON.stringify(err.details);
        expect(json).toContain('"max":"115792089237316195423570985008687907853269984665640564039457584007913129639935"');
      });

      it('não deve invocar getters ou toString() arbitrários em objetos passados para details', () => {
        let getterCalled = false;
        const dangerousObj = {
          get trap() {
            getterCalled = true;
            throw new Error('Getter perigoso disparado!');
          },
          toString() {
            getterCalled = true;
            throw new Error('toString perigoso disparado!');
          },
        };

        const err = new FinancialValidationError('Validation error', 'FINANCIAL_VALIDATION_ERROR', false, {
          payload: dangerousObj,
        });

        expect(getterCalled).toBe(false);
        expect(err.details?.payload).toBe('[non-serializable]');
        expect(() => JSON.stringify(err.details)).not.toThrow();
      });

      it('deve respeitar a hierarquia canônica de erros sem falsos positivos', () => {
        const moneyFormatErr = new InvalidMoneyFormatError('Formato inválido');
        const validationErr = new FinancialValidationError('Validação geral');

        expect(moneyFormatErr instanceof FinancialValidationError).toBe(true);
        expect(moneyFormatErr instanceof FinancialError).toBe(true);

        expect(validationErr instanceof FinancialValidationError).toBe(true);
        expect(validationErr instanceof InvalidMoneyFormatError).toBe(false);
      });

      it('não deve conter httpStatus no Domínio Puro e deve mapear corretamente na Application', () => {
        const imbalanceErr = new LedgerImbalanceError('Desbalanceado', {
          debits: '100',
          credits: '90',
        });
        expect(imbalanceErr.code).toBe('LEDGER_IMBALANCE');
        expect((imbalanceErr as any).httpStatus).toBeUndefined();
        expect(imbalanceErr.details?.debits).toBe('100');
        expect(mapFinancialErrorToHttpStatus(imbalanceErr)).toBe(422);
      });
    });

    describe('[F8 & F10] Runtime Type Barriers & TransitionResult Discriminated Union', () => {
      it('deve rejeitar duck-typing em BaseUnits.toHumanAmount', () => {
        const fakeMoney = { assetId: 1, amount: 100n } as any;
        expect(() => BaseUnits.toHumanAmount(fakeMoney, 6)).toThrow(InvalidMoneyFormatError);
      });

      it('deve garantir que INVALID em TransitionResult não possua status contaminado', () => {
        const res = FinancialTransactionStateMachine.evaluateTransition('completed', 'processing');
        expect(res.kind).toBe('INVALID');
        if (res.kind === 'INVALID') {
          expect(res.error).toBeDefined();
          expect((res as any).status).toBeUndefined();
        }
      });
    });

    describe('[F9] Decoupled HTTP Transport Mapping (Application Layer)', () => {
      it('deve mapear erros e códigos de domínio para HTTP na camada Application sem poluir o domínio', () => {
        // 403 Forbidden
        expect(mapFinancialErrorToHttpStatus(new AccountOwnershipError())).toBe(403);

        // 422 Unprocessable Entity
        expect(mapFinancialErrorToHttpStatus(new InsufficientBalanceError())).toBe(422);
        expect(mapFinancialErrorToHttpStatus(new Money256OverflowError())).toBe(422);
        expect(mapFinancialErrorToHttpStatus(new MoneyUnderflowError())).toBe(422);
        expect(mapFinancialErrorToHttpStatus(new LedgerImbalanceError())).toBe(422);
        expect(mapFinancialErrorToHttpStatus(new InvalidStateTransitionError())).toBe(422);
        expect(mapFinancialErrorToHttpStatus(new CurrencyMismatchError())).toBe(422);
        expect(mapFinancialErrorToHttpStatus(new InvalidAccountClassError())).toBe(422);
        expect(mapFinancialErrorToHttpStatus(new AccountInactiveError())).toBe(422);
        expect(mapFinancialErrorToHttpStatus(new AssetInactiveError())).toBe(422);
        expect(mapFinancialErrorToHttpStatus(new FinancialArithmeticError())).toBe(422);
        expect(mapFinancialErrorToHttpStatus(new InvalidLedgerTransactionError())).toBe(422);
        expect(mapFinancialErrorToHttpStatus(new AccountingMatrixValidationError('Erro matriz'))).toBe(422);
        expect(mapFinancialErrorToHttpStatus(new InvalidRefundAmountError())).toBe(422);

        // 409 Conflict
        expect(mapFinancialErrorToHttpStatus(new OptimisticConcurrencyError())).toBe(409);
        expect(mapFinancialErrorToHttpStatus(new IdempotencyConflictError())).toBe(409);
        expect(mapFinancialErrorToHttpStatus(new IdempotencyInProgressError())).toBe(409);
        expect(mapFinancialErrorToHttpStatus(new ReversalAlreadyExistsError())).toBe(409);
        expect(mapFinancialErrorToHttpStatus(new ExternalEventPayloadConflictError())).toBe(409);

        // 404 Not Found
        expect(mapFinancialErrorToHttpStatus({ code: 'ACCOUNT_NOT_FOUND' })).toBe(404);
        expect(mapFinancialErrorToHttpStatus({ code: 'ASSET_NOT_FOUND' })).toBe(404);

        // 400 Bad Request
        expect(mapFinancialErrorToHttpStatus(new InvalidMoneyFormatError())).toBe(400);
        expect(mapFinancialErrorToHttpStatus(new InvalidIdentifierError())).toBe(400);
        expect(mapFinancialErrorToHttpStatus(new FinancialValidationError())).toBe(400);
        expect(mapFinancialErrorToHttpStatus(new FinancialRangeError())).toBe(400);
        expect(mapFinancialErrorToHttpStatus(new UnsupportedFinancialOperationError())).toBe(400);
        expect(mapFinancialErrorToHttpStatus(new InvalidFinancialOperationError())).toBe(400);

        // Default fallback
        expect(mapFinancialErrorToHttpStatus(new Error('Generic unknown error'))).toBe(400);
      });
    });

    describe('[RC2 Hardening] Strict Edge Cases & Invariant Protections', () => {
      it('F2: deve rejeitar new String("debit") como direção de entrada contábil', () => {
        const fakeEntry1 = {
          accountId: 1,
          assetId: 1,
          amount: Money256.fromString('100', 1),
          entryType: new String('debit') as any,
          description: 'Teste boxed string',
        };
        const fakeEntry2 = {
          accountId: 2,
          assetId: 1,
          amount: Money256.fromString('100', 1),
          entryType: 'credit' as const,
          description: 'Crédito válido',
        };
        expect(() =>
          AccountingEntryPolicy.createReversalEntries([fakeEntry1, fakeEntry2], 'Estorno teste')
        ).toThrow(AccountingMatrixValidationError);
      });

      const createTestEntries = (amount: Money256 = Money256.fromString('100', 1)) => [
        new LedgerEntry({ accountId: 1, assetId: 1, type: 'debit', amount, description: 'd' }),
        new LedgerEntry({ accountId: 2, assetId: 1, type: 'credit', amount, description: 'c' }),
      ];

      it('F3: deve rejeitar category string vazia sem normalização silenciosa para operational', () => {
        expect(() =>
          LedgerTransaction.create({
            idempotencyKey: 'idem-empty-cat-1',
            transactionType: 'deposit',
            description: 'Depósito cat vazia',
            category: '' as any,
            entries: createTestEntries(),
          })
        ).toThrow(InvalidLedgerTransactionError);
      });

      it('F3 & F6: deve rejeitar businessReason string vazia em transações e ajustes', () => {
        expect(() =>
          LedgerTransaction.create({
            idempotencyKey: 'idem-empty-br-1',
            transactionType: 'adjustment',
            description: 'Ajuste br vazio',
            businessReason: '' as any,
            entries: createTestEntries(),
          })
        ).toThrow(InvalidLedgerTransactionError);

        expect(() =>
          LedgerTransaction.create({
            idempotencyKey: 'idem-empty-br-2',
            transactionType: 'deposit',
            description: 'Depósito br vazio',
            businessReason: '' as any,
            entries: createTestEntries(),
          })
        ).toThrow(InvalidLedgerTransactionError);
      });

      it('F6: deve rejeitar auto-referência em reversalOfTransactionId e refundOfTransactionId', () => {
        expect(() =>
          LedgerTransaction.create({
            id: 100,
            idempotencyKey: 'idem-self-rev-1',
            transactionType: 'reversal',
            description: 'Estorno auto',
            reversalOfTransactionId: 100,
            reversalReason: 'Auto estorno proibido',
            entries: createTestEntries(),
          })
        ).toThrow(InvalidLedgerTransactionError);

        expect(() =>
          LedgerTransaction.create({
            id: 200,
            idempotencyKey: 'idem-self-ref-1',
            transactionType: 'refund',
            description: 'Reembolso auto',
            refundOfTransactionId: 200,
            businessReason: 'Motivo reembolso',
            entries: createTestEntries(),
          })
        ).toThrow(InvalidLedgerTransactionError);
      });

      it('F1: toBaseUnits aceita representação canônica com zeros à esquerda sem consumir limite de 78 dígitos', () => {
        const base = BaseUnits.toBaseUnits('00000001.00', 1, 2);
        expect(base.toBigInt()).toBe(100n);

        // String com > 78 dígitos canônicos após escala deve ser rejeitada
        const seventyNineDigits = '1' + '0'.repeat(78);
        expect(() => BaseUnits.toBaseUnits(seventyNineDigits, 1, 0)).toThrow(Money256OverflowError);

        // String excedendo teto bruto de 256 caracteres deve ser rejeitada
        const overCeiling = '9'.repeat(257);
        expect(() => BaseUnits.toBaseUnits(overCeiling, 1, 2)).toThrow(InvalidMoneyFormatError);
      });

      it('F5: Opening balance semantics para equity suporta abertura de contas de patrimônio líquido', () => {
        const amount = Money256.fromString('50000', 1);
        const entries = AccountingEntryPolicy.createOpeningBalanceEntries({
          openingEquityAccountId: 1,
          targetAccountId: 2,
          accountNature: 'equity',
          authorizedByUserId: 10,
          amount,
          description: 'Abertura de conta de patrimônio líquido',
        });

        expect(entries.length).toBe(2);
        // Regra para equity: Dr Opening Balance Equity, Cr Target (Equity)
        const dr = entries.find((e) => e.entryType === 'debit')!;
        const cr = entries.find((e) => e.entryType === 'credit')!;
        expect(dr.accountId).toBe(1);
        expect(cr.accountId).toBe(2);
        expect(dr.amount.toBigInt()).toBe(amount.toBigInt());
        expect(cr.amount.toBigInt()).toBe(amount.toBigInt());
      });

      it('F5: deve rejeitar accountNature inválida (banana, null, number, objeto) em createOpeningBalanceEntries', () => {
        const amount = Money256.fromString('1000', 1);
        const baseParams = {
          openingEquityAccountId: 1,
          targetAccountId: 2,
          authorizedByUserId: 10,
          amount,
          description: 'Teste rejeição accountNature',
        };

        const invalidNatures = ['banana', null, 123, {}, []];
        for (const invalid of invalidNatures) {
          expect(() =>
            AccountingEntryPolicy.createOpeningBalanceEntries({
              ...baseParams,
              accountNature: invalid as any,
            })
          ).toThrow(AccountingMatrixValidationError);
        }

        // Garante que objetos com toString() ou Symbol.toPrimitive customizados
        // NÃO são executados durante a rejeição (sem coerção não-segura)
        const maliciousObj = {
          toString() {
            throw new Error('MALICIOUS_TO_STRING_CALLED');
          },
          [Symbol.toPrimitive]() {
            throw new Error('MALICIOUS_SYMBOL_CALLED');
          },
        };
        expect(() =>
          AccountingEntryPolicy.createOpeningBalanceEntries({
            ...baseParams,
            accountNature: maliciousObj as any,
          })
        ).toThrow(AccountingMatrixValidationError);
      });

      it('Segurança Textual: stripDangerousCharacters é restrita a logs e diagnósticos, dados de negócio com controle são REJEITADOS', () => {
        const dangerousText = 'Pagamento \u0000 fraudulento';
        // stripDangerousCharacters sanitiza para logs
        const sanitizedForLog = FinancialTextPolicy.stripDangerousCharacters(dangerousText);
        expect(sanitizedForLog).toBe('Pagamento  fraudulento');

        // MAS a política de validação de negócio estritamente REJEITA, sem aceitar silenciosamente
        expect(() =>
          FinancialTextPolicy.normalizeSafeDescription(dangerousText)
        ).toThrow(InvalidLedgerTransactionError);

        expect(() =>
          FinancialTextPolicy.assertSafeIdentifierText(dangerousText)
        ).toThrow(InvalidIdentifierError);
      });

      it('Mutation Resistance: Money256, LedgerEntry, LedgerTransaction, error.details e listas de entries são imutáveis', () => {
        const money = Money256.fromString('100', 1);
        expect(Object.isFrozen(money)).toBe(true);
        expect(() => {
          (money as any).assetId = 999;
        }).toThrow();

        const entries = AccountingEntryPolicy.createDepositEntries({
          treasuryAccountId: 10,
          userAccountId: 20,
          amount: money,
          description: 'Depósito congelado',
        });
        expect(Object.isFrozen(entries)).toBe(true);
        expect(Object.isFrozen(entries[0])).toBe(true);
        expect(Object.isFrozen(entries[1])).toBe(true);
        expect(() => {
          (entries as any).push({} as any);
        }).toThrow();
        expect(() => {
          (entries[0] as any).amount = Money256.fromString('999', 1);
        }).toThrow();

        const le1 = new LedgerEntry({
          accountId: 10,
          assetId: 1,
          type: 'debit',
          amount: money,
          description: 'Depósito Dr',
        });
        const le2 = new LedgerEntry({
          accountId: 20,
          assetId: 1,
          type: 'credit',
          amount: money,
          description: 'Depósito Cr',
        });
        expect(Object.isFrozen(le1)).toBe(true);
        expect(Object.isFrozen(le2)).toBe(true);

        const tx = LedgerTransaction.create({
          idempotencyKey: 'idem-frozen-tx-1',
          transactionType: 'deposit',
          description: 'Depósito congelado',
          entries: [le1, le2],
        });
        expect(Object.isFrozen(tx)).toBe(true);
        expect(Object.isFrozen(tx.entries)).toBe(true);
        expect(() => {
          (tx as any).status = 'completed';
        }).toThrow();

        const err = new FinancialValidationError('Erro de validação', 'VAL_ERR', false, { foo: 'bar' });
        expect(Object.isFrozen(err.details)).toBe(true);
        expect(() => {
          (err.details as any).foo = 'baz';
        }).toThrow();
      });

      it('Multi-Asset Reversal Invariant: preserva partição exata de ativos e inverte direções por ativo', () => {
        const usd100 = Money256.fromString('100', 1);
        const brl50 = Money256.fromString('50', 2);

        const multiAssetEntries: LedgerEntry[] = [
          AccountingEntryPolicy.createEntry({ accountId: 1, assetId: 1, entryType: 'debit', amount: usd100, description: 'USD Dr' }),
          AccountingEntryPolicy.createEntry({ accountId: 2, assetId: 1, entryType: 'credit', amount: usd100, description: 'USD Cr' }),
          AccountingEntryPolicy.createEntry({ accountId: 3, assetId: 2, entryType: 'debit', amount: brl50, description: 'BRL Dr' }),
          AccountingEntryPolicy.createEntry({ accountId: 4, assetId: 2, entryType: 'credit', amount: brl50, description: 'BRL Cr' }),
        ];

        AccountingEntryPolicy.validateEntriesBalance(multiAssetEntries);

        const reversed = AccountingEntryPolicy.createReversalEntries(multiAssetEntries, 'Estorno multi-ativo');
        expect(reversed.length).toBe(4);
        expect(Object.isFrozen(reversed)).toBe(true);

        // Verifica cada entrada revertida uma a uma
        for (let i = 0; i < multiAssetEntries.length; i++) {
          expect(reversed[i].accountId).toBe(multiAssetEntries[i].accountId);
          expect(reversed[i].assetId).toBe(multiAssetEntries[i].assetId);
          expect(reversed[i].amount.toBigInt()).toBe(multiAssetEntries[i].amount.toBigInt());
          expect(reversed[i].entryType).toBe(multiAssetEntries[i].entryType === 'debit' ? 'credit' : 'debit');
        }

        // Valida que o estorno multi-ativo também satisfaz partidas dobradas por ativo
        expect(() => AccountingEntryPolicy.validateEntriesBalance(reversed as LedgerEntry[])).not.toThrow();
      });
    });

    describe('[G5] Invariant & Property Consistency Tests', () => {
      it('Invariante de partida dobrada: soma(debits) === soma(credits) para qualquer conjunto válido', () => {
        const m1 = Money256.fromString('1500', 1);
        const depEntries = AccountingEntryPolicy.createDepositEntries({
          treasuryAccountId: 1,
          userAccountId: 2,
          amount: m1,
          description: 'Depósito invariante',
        });

        let debits = 0n;
        let credits = 0n;
        for (const e of depEntries) {
          if (e.entryType === 'debit') debits += e.amount.toBigInt();
          if (e.entryType === 'credit') credits += e.amount.toBigInt();
        }
        expect(debits).toBe(credits);
        expect(debits).toBe(1500n);
      });

      it('Invariante de estorno: reversal(original) produz mesmos accounts, assets, amounts e direções invertidas', () => {
        const m = Money256.fromString('750', 2);
        const original = AccountingEntryPolicy.createTransferEntries({
          sourceAccountId: 10,
          destinationAccountId: 20,
          amount: m,
          description: 'Transferência teste',
        });

        const reversed = AccountingEntryPolicy.createReversalEntries(original, 'Estorno auditado');

        expect(reversed.length).toBe(original.length);
        for (let i = 0; i < original.length; i++) {
          expect(reversed[i].accountId).toBe(original[i].accountId);
          expect(reversed[i].assetId).toBe(original[i].assetId);
          expect(reversed[i].amount.toBigInt()).toBe(original[i].amount.toBigInt());
          expect(reversed[i].entryType).toBe(original[i].entryType === 'debit' ? 'credit' : 'debit');
        }
      });

      it('Invariante de Money256: add e subtract preservam assetId e limites de uint256', () => {
        const testValues = [0n, 1n, 100n, 999999999n, MAX_UINT256 / 2n, MAX_UINT256 - 1n];

        for (const val of testValues) {
          const money = Money256.fromBigInt(val, 5);
          expect(money.assetId).toBe(5);
          expect(money.toBigInt()).toBe(val);

          const added = money.add(Money256.zero(5));
          expect(added.toBigInt()).toBe(val);
          expect(added.assetId).toBe(5);

          const subbed = money.subtract(Money256.zero(5));
          expect(subbed.toBigInt()).toBe(val);
          expect(subbed.assetId).toBe(5);
        }
      });
    });
  });
});

