import { describe, it, expect } from 'vitest';
import {
  freezeAuthorizationContext,
  CustodyAuthorizationPolicy,
  isPrincipalType,
} from '../../src/domains/finance/contracts/AuthorizationContext';
import { DeterministicIdGenerator } from '../../src/domains/finance/contracts/DeterministicIdGenerator';
import { validateCanonicalLedgerEntryRecord } from '../../src/domains/finance/contracts/FinancialLedgerEntryRecord';
import {
  IdempotencyScope,
  MAX_SCOPE_SEGMENT_LENGTH,
} from '../../src/domains/finance/contracts/IdempotencyScope';
import {
  sealPostingPlan,
  isAuthenticPostingPlan,
  POSTING_PLAN_SEAL,
  PostingPlan,
} from '../../src/domains/finance/contracts/PostingPlan';
import { PostingSession } from '../../src/domains/finance/contracts/PostingSession';
import {
  PostingPlanBuilder,
  type PostingLegEntryInput,
} from '../../src/domains/finance/services/PostingPlanBuilder';
import { AccountingEntryPolicy } from '../../src/domains/finance/policies/AccountingEntryPolicy';
import {
  LedgerTransaction,
  LedgerEntry,
} from '../../src/domains/finance/entities/LedgerTransaction';
import { Money256 } from '../../src/domains/finance/value-objects/Money256';

describe('Gate 0 / Lote 1B: Contracts P0 Hardening & OCaps Certification', () => {
  describe('1. AuthorizationContext & CustodyAuthorizationPolicy', () => {
    it('deve validar tipo de principal via type guard', () => {
      expect(isPrincipalType('user')).toBe(true);
      expect(isPrincipalType('system')).toBe(true);
      expect(isPrincipalType('service_account')).toBe(true);
      expect(isPrincipalType('admin')).toBe(false);
      expect(isPrincipalType(null)).toBe(false);
    });

    it('deve falhar fechado ao receber correlationId vazio ou whitespace', () => {
      expect(() =>
        freezeAuthorizationContext({
          principalId: 1,
          principalType: 'user',
          capabilities: [],
          correlationId: '   ',
        })
      ).toThrow(/correlationId deve ser uma string não-vazia/);
    });

    it('deve falhar fechado se capabilities não for array ou possuir elementos vazios', () => {
      expect(() =>
        freezeAuthorizationContext({
          principalId: 1,
          principalType: 'user',
          capabilities: null as any,
          correlationId: 'tx_123',
        })
      ).toThrow(/context.capabilities deve ser uma lista/);

      expect(() =>
        freezeAuthorizationContext({
          principalId: 1,
          principalType: 'user',
          capabilities: ['  ', 'finance.system.operate'],
          correlationId: 'tx_123',
        })
      ).toThrow(/Capability no índice #0 deve ser uma string não-vazia/);
    });

    it('deve retornar decisão imutável (Object.freeze) e validar quantia estritamente positiva', () => {
      const authCtx = freezeAuthorizationContext({
        principalId: 10,
        principalType: 'user',
        capabilities: ['finance.transfer.delegate'],
        correlationId: 'tx_001',
      });

      expect(Object.isFrozen(authCtx)).toBe(true);
      expect(Object.isFrozen(authCtx.capabilities)).toBe(true);

      const decisionBadAmount = CustodyAuthorizationPolicy.canDebitSourceAccount(authCtx, {
        operationType: 'transfer',
        sourceAccountId: 1,
        sourceAccountOwnerId: 10,
        assetId: 1,
        amountBaseUnits: 0n,
      });

      expect(decisionBadAmount.allowed).toBe(false);
      expect(Object.isFrozen(decisionBadAmount)).toBe(true);
      expect(decisionBadAmount.errorCode).toBe('FORBIDDEN_OPERATION');
    });

    it('deve PROIBIR que titular da conta autorize operações privilegiadas via SELF (reversal, refund, adjustment, fee, etc.)', () => {
      const userCtx = freezeAuthorizationContext({
        principalId: 10,
        principalType: 'user',
        capabilities: [],
        correlationId: 'tx_priv_01',
      });

      // Tentativa de reversal por titular comum
      const reversalDecision = CustodyAuthorizationPolicy.canDebitSourceAccount(userCtx, {
        operationType: 'reversal',
        sourceAccountId: 100,
        sourceAccountOwnerId: 10,
        assetId: 1,
        amountBaseUnits: 500n,
      });
      expect(reversalDecision.allowed).toBe(false);
      expect(reversalDecision.errorCode).toBe('FORBIDDEN_OPERATION');

      // Tentativa de refund por titular comum
      const refundDecision = CustodyAuthorizationPolicy.canDebitSourceAccount(userCtx, {
        operationType: 'refund',
        sourceAccountId: 100,
        sourceAccountOwnerId: 10,
        assetId: 1,
        amountBaseUnits: 500n,
      });
      expect(refundDecision.allowed).toBe(false);
      expect(refundDecision.errorCode).toBe('FORBIDDEN_OPERATION');
    });
  });

  describe('2. DeterministicIdGenerator', () => {
    it('deve gerar identificadores numéricos monotônicos seguros', () => {
      DeterministicIdGenerator.resetForTesting(100);
      const id1 = DeterministicIdGenerator.nextTransactionId();
      const id2 = DeterministicIdGenerator.nextTransactionId();

      expect(Number.isSafeInteger(id1)).toBe(true);
      expect(Number.isSafeInteger(id2)).toBe(true);
      expect(id2).toBeGreaterThan(id1);
    });

    it('deve impedir alteração de workerId após emissão de identificadores', () => {
      DeterministicIdGenerator.resetForTesting();
      DeterministicIdGenerator.nextTransactionId();
      expect(() => DeterministicIdGenerator.setWorkerId(2)).toThrow(
        /workerId não pode ser modificado após o início da emissão/
      );
    });
  });

  describe('3. FinancialLedgerEntryRecord', () => {
    it('deve rejeitar montantes de base units iguais a zero ("0")', () => {
      expect(() =>
        validateCanonicalLedgerEntryRecord({
          accountId: 1,
          assetId: 1,
          direction: 'debit',
          amountBaseUnits: '0',
        })
      ).toThrow(/amountBaseUnits contém formato não-canônico/);
    });

    it('deve rejeitar montantes não-canônicos com zeros à esquerda ou sinais', () => {
      expect(() =>
        validateCanonicalLedgerEntryRecord({
          accountId: 1,
          assetId: 1,
          direction: 'credit',
          amountBaseUnits: '0100',
        })
      ).toThrow(/formato não-canônico/);

      expect(() =>
        validateCanonicalLedgerEntryRecord({
          accountId: 1,
          assetId: 1,
          direction: 'credit',
          amountBaseUnits: '-500',
        })
      ).toThrow(/formato não-canônico/);
    });

    it('deve validar e congelar registro canônico positivo', () => {
      const rec = validateCanonicalLedgerEntryRecord({
        accountId: 100,
        assetId: 1,
        direction: 'debit',
        amountBaseUnits: '500000',
      });
      expect(Object.isFrozen(rec)).toBe(true);
      expect(rec.amountBaseUnits).toBe('500000');
    });
  });

  describe('4. IdempotencyScope', () => {
    it('deve proibir delimitadores (:) e formatações espúrias de namespace', () => {
      expect(() => IdempotencyScope.create('finance:core', 'user', 'ctx')).toThrow(
        /não pode conter o delimitador dois-pontos/
      );

      expect(() => IdempotencyScope.create('.finance', 'user', 'ctx')).toThrow(
        /contém formato de pontos espúrio ou inválido/
      );

      expect(() => IdempotencyScope.create('finance..core', 'user', 'ctx')).toThrow(
        /contém formato de pontos espúrio ou inválido/
      );
    });

    it('deve aplicar validação simétrica a todos os 3 segmentos e impor limite de tamanho', () => {
      expect(() => IdempotencyScope.create('finance.transfer', 'user:attack', 'ctx')).toThrow(
        /não pode conter o delimitador dois-pontos/
      );

      expect(() => IdempotencyScope.create('finance.transfer', 'user', 'ctx..bad')).toThrow(
        /contém formato de pontos espúrio ou inválido/
      );

      const hugeSegment = 'a'.repeat(MAX_SCOPE_SEGMENT_LENGTH + 1);
      expect(() => IdempotencyScope.create(hugeSegment, 'user', 'ctx')).toThrow(
        /excede o limite máximo/
      );
    });

    it('deve rejeitar nomes de operação vazios em helpers de escopo', () => {
      expect(() => IdempotencyScope.forUser('   ', 10)).toThrow(
        /IdempotencyScope.forUser exige um nome de operação não-vazio/
      );

      expect(() => IdempotencyScope.forProvider('', 5)).toThrow(
        /IdempotencyScope.forProvider exige um nome de operação não-vazio/
      );

      expect(() => IdempotencyScope.forSystem('')).toThrow(
        /IdempotencyScope.forSystem exige um nome de operação não-vazio/
      );
    });
  });

  describe('5. PostingPlan (FIN-001 Double-Entry Balance & OCaps Seal)', () => {
    const validPlanSample: PostingPlan = {
      [POSTING_PLAN_SEAL]: POSTING_PLAN_SEAL,
      planId: 'plan_test_01',
      scope: 'finance.transfer:user:10',
      idempotencyKey: 'idem_key_01',
      requestHash: 'hash_abc',
      transactionId: 1000,
      authorizationDecision: {
        allowed: true,
        type: 'SELF',
        actorUserId: 10,
        authorizedByUserId: null,
      },
      transactionRecord: {
        id: 1000,
        publicId: 'tx_pub_01',
        type: 'transfer',
        category: 'standard',
        description: 'Transferência de teste',
        actorUserId: 10,
        authorizedByUserId: null,
        sourceType: null,
        sourceId: null,
        correlationId: 'tx_corr_01',
      },
      ledgerEntries: [
        {
          transactionId: 1000,
          entryOrdinal: 1,
          accountId: 10,
          assetId: 1,
          direction: 'debit',
          amountBaseUnits: '100',
          description: 'Debit',
        },
        {
          transactionId: 1000,
          entryOrdinal: 2,
          accountId: 20,
          assetId: 1,
          direction: 'credit',
          amountBaseUnits: '100',
          description: 'Credit',
        },
      ],
      balanceMutations: [
        {
          accountId: 10,
          assetId: 1,
          signedDeltaBaseUnits: -100n,
          expectedVersion: 1,
          newAvailableBaseUnits: '900',
        },
        {
          accountId: 20,
          assetId: 1,
          signedDeltaBaseUnits: 100n,
          expectedVersion: 1,
          newAvailableBaseUnits: '1100',
        },
      ],
      outboxEvent: {
        eventId: 'evt_01',
        eventName: 'transfer.completed',
        aggregateId: 'tx_1000',
        aggregateVersion: 1,
        payload: '{}',
      },
      leaseOwner: 'worker_01',
      leaseGeneration: 1,
      responseStatus: 200,
      responsePayload: '{}',
    };

    it('deve selar e autenticar plano equilibrado em partidas dobradas', () => {
      const sealed = sealPostingPlan(validPlanSample);
      expect(isAuthenticPostingPlan(sealed)).toBe(true);
      expect(Object.isFrozen(sealed)).toBe(true);
      expect(Object.isFrozen(sealed.ledgerEntries)).toBe(true);
      expect(Object.isFrozen(sealed.balanceMutations)).toBe(true);
      expect(Object.isFrozen(sealed.authorizationDecision)).toBe(true);
    });

    it('deve rejeitar plano com autorização negada (allowed === false)', () => {
      const deniedPlan: PostingPlan = {
        ...validPlanSample,
        authorizationDecision: {
          allowed: false,
          reason: 'Custody violation',
          errorCode: 'UNAUTHORIZED_CUSTODY',
        },
      };

      expect(() => sealPostingPlan(deniedPlan)).toThrow(
        /plano não pode ser selado com autorização recusada ou ausente/
      );
    });

    it('deve rejeitar plano com mutação de saldo em conta que não consta nas pernas contábeis', () => {
      const ghostAccountPlan: PostingPlan = {
        ...validPlanSample,
        balanceMutations: [
          ...validPlanSample.balanceMutations,
          {
            accountId: 999, // Conta fantasma não presente em ledgerEntries
            assetId: 1,
            signedDeltaBaseUnits: 1000n,
            expectedVersion: 0,
            newAvailableBaseUnits: '1000',
          },
        ],
      };

      expect(() => sealPostingPlan(ghostAccountPlan)).toThrow(
        /não possui perna contábil correspondente/
      );
    });

    it('deve rejeitar plano com desbalanceamento contábil (FIN-001)', () => {
      const imbalancedPlan: PostingPlan = {
        ...validPlanSample,
        ledgerEntries: [
          {
            transactionId: 1000,
            entryOrdinal: 1,
            accountId: 10,
            assetId: 1,
            direction: 'debit',
            amountBaseUnits: '100',
            description: 'Debit',
          },
          {
            transactionId: 1000,
            entryOrdinal: 2,
            accountId: 20,
            assetId: 1,
            direction: 'credit',
            amountBaseUnits: '90', // Diverge de 100!
            description: 'Credit',
          },
        ],
      };

      expect(() => sealPostingPlan(imbalancedPlan)).toThrow(
        /Desbalanceamento contábil no plano para o ativo #1/
      );
    });

    it('deve rejeitar planos forjados que não passaram pelo registro soberano (WeakSet)', () => {
      const forgedDuckTypedPlan = {
        ...validPlanSample,
        [POSTING_PLAN_SEAL]: POSTING_PLAN_SEAL,
      };

      // Não chamou sealPostingPlan
      expect(isAuthenticPostingPlan(forgedDuckTypedPlan)).toBe(false);
    });
  });

  describe('6. PostingSession (OCaps Single-Use & Concurrency Guard)', () => {
    it('deve assegurar uso único (single-use) via tryConsume()', () => {
      const fakeDb = {};
      const session = new PostingSession(fakeDb, 'atomic-batch', 'bound_01');

      expect(session.isValid()).toBe(true);
      expect(session.isConsumed()).toBe(false);
      expect(session.verifyBoundary(fakeDb)).toBe(true);
      expect(session.verifyBoundary({})).toBe(false);
      expect(Object.isFrozen(session)).toBe(true);

      // Primeiro consumo: sucesso
      const firstConsume = session.tryConsume();
      expect(firstConsume).toBe(true);
      expect(session.isConsumed()).toBe(true);
      expect(session.isValid()).toBe(false);

      // Segundo consumo: proibido (race condition guard)
      const secondConsume = session.tryConsume();
      expect(secondConsume).toBe(false);
    });

    it('deve rejeitar referências de fronteira física nulas ou modos inválidos', () => {
      expect(() => new PostingSession(null as any, 'atomic-batch', 'b1')).toThrow(
        /fronteira transacional válida/
      );

      expect(() => new PostingSession({}, 'invalido' as any, 'b1')).toThrow(
        /Modo de execução inválido/
      );

      expect(() => new PostingSession({}, 'atomic-batch', '   ')).toThrow(
        /Identificador de fronteira física não-vazio/
      );
    });
  });

  describe('7. Hardening Audit P0: Permutation Invariance, String-Number Normalization & Anti-DoS', () => {
    it('deve assegurar invariância estrita de entryOrdinal sob qualquer permutação da entrada em PostingPlanBuilder', () => {
      const authDecision = {
        allowed: true,
        type: 'SELF' as const,
        actorUserId: 10,
        authorizedByUserId: null,
      };

      const entryA: PostingLegEntryInput = {
        accountId: 10,
        assetId: 1,
        accountClass: 'asset',
        accountStatus: 'active',
        direction: 'debit',
        amount: 50n,
        description: 'Debit Leg A',
        currentAvailableBaseUnits: 1000n,
        currentVersion: 1,
      };

      const entryB: PostingLegEntryInput = {
        accountId: 10,
        assetId: 1,
        accountClass: 'asset',
        accountStatus: 'active',
        direction: 'debit',
        amount: 50n,
        description: 'Debit Leg B',
        currentAvailableBaseUnits: 1000n,
        currentVersion: 1,
      };

      const entryC: PostingLegEntryInput = {
        accountId: 20,
        assetId: 1,
        accountClass: 'liability',
        accountStatus: 'active',
        direction: 'credit',
        amount: 100n,
        description: 'Credit Leg Combined',
        currentAvailableBaseUnits: 500n,
        currentVersion: 2,
      };

      const plan1 = PostingPlanBuilder.build({
        scope: 'finance.transfer:user:10',
        idempotencyKey: 'idemp_perm_1',
        requestHash: 'hash_perm_1',
        transactionType: 'transfer',
        category: 'operational',
        description: 'Permutation Test 1',
        actorUserId: 10,
        authorizedByUserId: null,
        authorizationDecision: authDecision,
        entries: [entryA, entryB, entryC],
      });

      // Permutação inversa da coleção de entrada
      const plan2 = PostingPlanBuilder.build({
        scope: 'finance.transfer:user:10',
        idempotencyKey: 'idemp_perm_2',
        requestHash: 'hash_perm_2',
        transactionType: 'transfer',
        category: 'operational',
        description: 'Permutation Test 2',
        actorUserId: 10,
        authorizedByUserId: null,
        authorizationDecision: authDecision,
        entries: [entryC, entryB, entryA],
      });

      // Os ordinais e a ordem canônica das pernas devem ser rigorosamente IDÊNTICOS
      expect(plan1.ledgerEntries.length).toBe(3);
      expect(plan2.ledgerEntries.length).toBe(3);

      for (let i = 0; i < 3; i++) {
        expect(plan1.ledgerEntries[i].entryOrdinal).toBe(i + 1);
        expect(plan2.ledgerEntries[i].entryOrdinal).toBe(i + 1);
        expect(plan1.ledgerEntries[i].accountId).toBe(plan2.ledgerEntries[i].accountId);
        expect(plan1.ledgerEntries[i].direction).toBe(plan2.ledgerEntries[i].direction);
        expect(plan1.ledgerEntries[i].amountBaseUnits).toBe(plan2.ledgerEntries[i].amountBaseUnits);
        expect(plan1.ledgerEntries[i].description).toBe(plan2.ledgerEntries[i].description);
      }
    });

    it('deve extrair valor reembolsável com accountId e assetId fornecidos como string ou número em AccountingEntryPolicy', () => {
      const entries = [
        {
          accountId: '10', // String "10"
          assetId: '1',    // String "1"
          direction: 'debit',
          amountBaseUnits: '500',
        },
        {
          accountId: '20', // String "20"
          assetId: '1',    // String "1"
          direction: 'credit',
          amountBaseUnits: '500',
        },
      ];

      // Busca passando números (ou strings)
      const refundable = AccountingEntryPolicy.extractRefundablePaymentAmount(
        entries,
        1,   // assetId number
        20   // revenueAccountId number
      );

      expect(refundable.amount).toBe(500n);
      expect(refundable.assetId).toBe(1);
    });

    it('deve rejeitar LedgerEntry com descrição bruta excedendo MAX_RAW_TEXT_CEILING antes de NFC', () => {
      const hugeDescription = 'a'.repeat(4097);
      expect(() => {
        new LedgerEntry({
          accountId: 1,
          assetId: 1,
          type: 'debit',
          amount: new Money256(100n, 1),
          description: hugeDescription,
        });
      }).toThrow(/exceeds maximum raw length ceiling/);
    });

    it('deve rejeitar auto-referência explícita em sourceId ou correlationId de LedgerTransaction', () => {
      const entries = [
        new LedgerEntry({
          accountId: 1,
          assetId: 1,
          type: 'debit',
          amount: new Money256(100n, 1),
        }),
        new LedgerEntry({
          accountId: 2,
          assetId: 1,
          type: 'credit',
          amount: new Money256(100n, 1),
        }),
      ];

      expect(() => {
        LedgerTransaction.create({
          id: 'tx_self_1',
          idempotencyKey: 'idemp_self_1',
          description: 'Self-ref test',
          entries,
          transactionType: 'transfer',
          sourceId: 'tx_self_1', // Auto-referência
        });
      }).toThrow(/cannot reference itself as sourceId/);

      expect(() => {
        LedgerTransaction.create({
          id: 'tx_self_2',
          idempotencyKey: 'idemp_self_2',
          description: 'Self-ref test 2',
          entries,
          transactionType: 'transfer',
          correlationId: 'tx_self_2', // Auto-referência
        });
      }).toThrow(/cannot reference itself as correlationId/);
    });
  });
});
