import { describe, it, expect } from 'vitest';
import {
  freezeAuthorizationContext,
  CustodyAuthorizationPolicy,
  isPrincipalType,
} from '../../src/domains/finance/contracts/AuthorizationContext';
import { DeterministicIdGenerator } from '../../src/domains/finance/contracts/DeterministicIdGenerator';
import { validateCanonicalLedgerEntryRecord } from '../../src/domains/finance/contracts/FinancialLedgerEntryRecord';
import { IdempotencyScope } from '../../src/domains/finance/contracts/IdempotencyScope';
import {
  sealPostingPlan,
  isAuthenticPostingPlan,
  POSTING_PLAN_SEAL,
  PostingPlan,
} from '../../src/domains/finance/contracts/PostingPlan';
import { PostingSession } from '../../src/domains/finance/contracts/PostingSession';
import { InvalidIdentifierError } from '../../src/domains/finance/errors/FinancialErrors';

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
        /Segmentos de IdempotencyScope não podem conter o delimitador dois-pontos/
      );

      expect(() => IdempotencyScope.create('.finance', 'user', 'ctx')).toThrow(
        /Namespace de IdempotencyScope contém formato de pontos inválido/
      );

      expect(() => IdempotencyScope.create('finance..core', 'user', 'ctx')).toThrow(
        /Namespace de IdempotencyScope contém formato de pontos inválido/
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
      const session = new PostingSession(fakeDb, 'd1-batch', 'bound_01');

      expect(session.isValid()).toBe(true);
      expect(session.isConsumed()).toBe(false);
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
      expect(() => new PostingSession(null as any, 'd1-batch', 'b1')).toThrow(
        /fronteira transacional válida/
      );

      expect(() => new PostingSession({}, 'invalido' as any, 'b1')).toThrow(
        /Modo de execução inválido/
      );

      expect(() => new PostingSession({}, 'd1-batch', '   ')).toThrow(
        /Identificador de fronteira física não-vazio/
      );
    });
  });
});
