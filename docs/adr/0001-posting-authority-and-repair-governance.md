# ADR 0001: Alçada Contábil, Autoridade Física de Postagem e Governança de Reparo Financeiro

- **Status:** Proposto / Em Avaliação
- **Data:** 2026-09-16
- **Autor:** Antigravity Pairing Assistant
- **Aprovador / Decisor:** Tech Lead & Arquiteto do Domínio Financeiro (Sandro)
- **Contexto:** Núcleo Financeiro de Dupla Entrada, Imutabilidade do Ledger e Reconciliação Tripla

---

## 1. Contexto e Problema

O sistema financeiro da plataforma opera sobre princípios estritos de contabilidade de dupla entrada (*Double-Entry Bookkeeping*), precisão de 256 bits com representação decimal em ponto fixo (`Money256`), idempotência canônica via hash de requisição e persistência atômica via `UnitOfWork` no Cloudflare D1 / SQLite.

Atualmente, embora existam testes robustos de blindagem contábil ([`tests/architecture/finance_posting_authority.test.ts`](../../tests/architecture/finance_posting_authority.test.ts) e [`tests/finance/posting_authority_hardening.test.ts`](../../tests/finance/posting_authority_hardening.test.ts)):
1. A **autoridade física de posting** é garantida apenas no nível de assertividade de testes de arquitetura e validação interna no repositório, sem um tipo explícito no domínio que materialize o contrato em tempo de compilação.
2. O caso de uso [`RepairFinanceUseCase.ts`](../../src/application/finance/use-cases/RepairFinanceUseCase.ts) possui capacidade de reconciliação forçada e ajuste direto de saldos/entradas, convivendo na mesma camada e convenção que use cases operacionais ordinários (`RecordDepositUseCase`, `GetTreasuryBalanceUseCase`), sem um guardião administrativo explícito (*two-man rule* ou permissão de alçada restrita com auditoria criptográfica).
3. A rotina de reconciliação de 3 vias ([`tests/finance/reconciliation_3way.test.ts`](../../tests/finance/reconciliation_3way.test.ts)) reside apenas como uma suíte de testes de validação retroativa, sem um serviço canônico na camada de aplicação que possa ser invocado periodicamente por cron/tarefas agendadas.

---

## 2. Decisão Arquitetural Proposta

### 2.1. Formalização da Entidade `PostingAuthority` no Domínio
Criar em `src/domains/finance/policies/PostingAuthority.ts` uma classe de alçada estrita:
- Uma transação contábil só pode emitir e persistir lançamentos no ledger (`LedgerTransaction`) se for acompanhada por um `PostingAuthorizationToken` assinado ou validado pela máquina de estados (`FinancialTransactionStateMachine`).
- Impede estruturalmente qualquer tentativa de gravação física no D1 sem passagem pelas políticas de domínio (`AccountStatusPolicy`, `AccountingEntryPolicy`, `AccountClassPolicy`).

### 2.2. Isolamento de `RepairFinanceUseCase` via `AdminFinanceGuard`
Criar em `src/application/finance/services/AdminFinanceGuard.ts`:
- Nenhuma execução de reparo contábil pode ser invocada sem validação de privilégio administrativo (`requireAdminRole`), auditoria imutável prévia no `ISecurityAuditPort` e verificação de não-divergência de soma zero antes do commit.
- O reparo gera obrigatoriamente um evento de outbox de alta prioridade (`FinanceLedgerRepairedEvent`).

### 2.3. Institucionalização do `LedgerReconciliationService`
Criar em `src/application/finance/services/LedgerReconciliationService.ts`:
- Promover o algoritmo do teste `reconciliation_3way.test.ts` para um serviço de aplicação reutilizável, capaz de reconciliar:
  1. Soma das entradas do Razão (`ledger_entries`);
  2. Saldos materializados nas contas (`account_balances`);
  3. Extratos de provedores bancários e custodiantes externos.

---

## 3. Consequências e Invariantes Preservadas

- **Positivas:**
  - Impossibilidade de desvio de fluxo ou bypass de posting mesmo em refatorações futuras;
  - Rastreabilidade forense total de intervenções de reparo;
  - Capacidade nativa de agendamento de conciliação diária no Cloudflare Workers via Cron Triggers.
- **Riscos / Mitigações:**
  - Nenhuma alteração pode introduzir overhead de I/O em transações ordinárias de alta frequência;
  - Toda a checagem de alçada de `PostingAuthority` opera puramente em memória no domínio.

---

## 4. Estado de Aprovação

- [ ] Aprovado pelo Tech Lead / Arquiteto do Domínio Financeiro para implementação de código
- [ ] Rejeitado / Necessita Revisão
