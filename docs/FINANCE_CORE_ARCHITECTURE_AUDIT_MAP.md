# 💳 Finance Core — Motor Contábil de Alta Integridade

<p align="center">
  <img src="https://img.shields.io/badge/Status-100%25%20FROZEN%20%2F%20Production-059669?style=for-the-badge&logo=shield" alt="Status" />
  <img src="https://img.shields.io/badge/Tests-394%20Passed%20(100%25)-10B981?style=for-the-badge&logo=vitest&logoColor=white" alt="Tests" />
  <img src="https://img.shields.io/badge/Runtime-Cloudflare%20Workers-F38020?style=for-the-badge&logo=cloudflare&logoColor=white" alt="Cloudflare" />
  <img src="https://img.shields.io/badge/Database-D1%20SQLite%20(Append--Only)-2563EB?style=for-the-badge&logo=sqlite&logoColor=white" alt="D1" />
  <img src="https://img.shields.io/badge/Precision-256--bit%20uint256-7C3AED?style=for-the-badge" alt="Precision" />
</p>

> **Motor financeiro transacional de missão crítica** projetado segundo **Clean Architecture** e **Domain-Driven Design (DDD)**.  
> Implementa **livro-razão em partidas dobradas (Double-Entry Ledger)**, balanços materializados com **OCC (Optimistic Concurrency Control)**, aritmética de precisão exata de **256 bits (`Money256`)** e barreira soberana de autorização contábil (**PostingAuthority / Gate 0**).

<p align="center">
  <img src="./assets/finance_telemetry_dashboard.svg" width="100%" alt="Finance Core Telemetry & Engineering Dashboard" />
</p>

---

## 🏛️ 1. Diagrama de Arquitetura do Módulo

O diagrama abaixo sintetiza a jornada de uma transação financeira pelas camadas do sistema — desde a borda até a persistência atômica no SQLite D1:

<p align="center">
  <img src="./assets/finance_architecture_board.svg" width="100%" alt="Finance Core Architecture Topology & Data Flow" />
</p>

```mermaid
flowchart TD
    CLIENT["🌐 Cliente HTTP / Aplicação Externa"]

    subgraph INGRESS ["1. Borda & Segurança (Edge)"]
        AUTH["🛡️ sessionGuard & requireAal(2)"]
        RBAC["🔐 verifyPermission (RBAC Granular)"]
        CTRL["🎮 FinanceController (Validação de DTOs)"]
        AUTH --> RBAC --> CTRL
    end

    subgraph APPLICATION ["2. Aplicação & Orquestração"]
        ORCH["⚙️ Transaction Orchestrator & Idempotência"]
        BUILDER["📐 PostingPlanBuilder (Ordenação Anti-Deadlock)"]
        GATE0["🏛️ PostingAuthority Gate 0 (Validação FIN-001)"]
        ORCH --> BUILDER --> GATE0
    end

    subgraph DOMAIN ["3. Domínio Contábil Puro (DDD)"]
        AGG["📦 LedgerTransaction Aggregate"]
        MONEY["💰 Money256 (uint256 sem Ponto Flutuante)"]
        POLICIES["📜 Políticas Contábeis & Limites de Custódia"]
        AGG --- MONEY
        AGG --- POLICIES
    end

    subgraph STORAGE ["4. Persistência Atômica (Cloudflare D1)"]
        EXEC["⚡ D1AtomicPostingExecutor (Batch SQL)"]
        LEDGER[("📖 financial_ledger_entries (Append-Only)")]
        BALANCES[("⚖️ account_balances (OCC uint256)")]
        IDEMP[("🔑 idempotency_keys (Fencing Tokens)")]
        EXEC --> LEDGER
        EXEC --> BALANCES
        EXEC --> IDEMP
    end

    CLIENT --> INGRESS
    CTRL --> APPLICATION
    GATE0 --> DOMAIN
    GATE0 --> STORAGE
```

---

## 🚀 2. Catálogo Interativo de APIs

Todas as rotas operam sob a base `https://w3-api.asppibra.workers.dev/api/v1/finance` com proteção **Fail-Closed**, validação física de sessão e autorização granular baseada em papéis (RBAC).

<p align="center">
  <img src="./assets/finance_api_matrix_board.svg" width="100%" alt="Finance Core REST API Gateway & Capabilities Matrix" />
</p>

### 📌 Painel Geral de Rotas

| Método | Endpoint | Função do Controlador | Nível de Segurança | Idempotência | Propósito Contábil |
| :---: | :--- | :--- | :---: | :---: | :--- |
| ![GET](https://img.shields.io/badge/GET-0284c7?style=flat-square) | `/treasury/balance` | [`FinanceController.getBalance`](file:///home/sandro/Área de trabalho/BackEnd/src/interfaces/http/controllers/finance/FinanceController.ts#L21) | <kbd>AAL2</kbd> • `finance.treasury.read` | Opcional | Consulta saldo consolidado da tesouraria |
| ![POST](https://img.shields.io/badge/POST-10b981?style=flat-square) | `/deposits` | [`FinanceController.recordDeposit`](file:///home/sandro/Área de trabalho/BackEnd/src/interfaces/http/controllers/finance/FinanceController.ts#L193) | <kbd>AAL2 (15m)</kbd> • `finance.deposit.create` | **Obrigatória** | Crédito de fundos externos no passivo do usuário |
| ![POST](https://img.shields.io/badge/POST-10b981?style=flat-square) | `/withdrawals` | [`FinanceController.recordWithdrawal`](file:///home/sandro/Área de trabalho/BackEnd/src/interfaces/http/controllers/finance/FinanceController.ts#L197) | <kbd>AAL2 (15m)</kbd> • `finance.withdrawal.create` | **Obrigatória** | Saque de fundos com validação de custódia |
| ![POST](https://img.shields.io/badge/POST-10b981?style=flat-square) | `/transfers` | [`FinanceController.recordTransfer`](file:///home/sandro/Área de trabalho/BackEnd/src/interfaces/http/controllers/finance/FinanceController.ts#L209) | <kbd>AAL2 (15m)</kbd> • `finance.transfer.create` | **Obrigatória** | Transferência P2P atômica entre usuários |
| ![POST](https://img.shields.io/badge/POST-10b981?style=flat-square) | `/payments` | [`FinanceController.recordPayment`](file:///home/sandro/Área de trabalho/BackEnd/src/interfaces/http/controllers/finance/FinanceController.ts#L201) | <kbd>AAL2 (15m)</kbd> • `finance.payment.create` | **Obrigatória** | Pagamento de serviços com crédito à plataforma |
| ![POST](https://img.shields.io/badge/POST-10b981?style=flat-square) | `/refunds` | [`FinanceController.recordRefund`](file:///home/sandro/Área de trabalho/BackEnd/src/interfaces/http/controllers/finance/FinanceController.ts#L205) | <kbd>AAL2 (15m)</kbd> • `finance.refund.create` | **Obrigatória** | Estorno contábil de transação original |
| ![POST](https://img.shields.io/badge/POST-10b981?style=flat-square) | `/adjustments` | [`FinanceController.recordAdjustment`](file:///home/sandro/Área de trabalho/BackEnd/src/interfaces/http/controllers/finance/FinanceController.ts#L292) | <kbd>AAL2 (Admin)</kbd> • `finance.adjustment.create` | **Obrigatória** | Ajuste administrativo auditado (4-Eyes) |
| ![POST](https://img.shields.io/badge/POST-10b981?style=flat-square) | `/transactions` | [`FinanceController.recordTransaction`](file:///home/sandro/Área de trabalho/BackEnd/src/interfaces/http/controllers/finance/FinanceController.ts#L189) | <kbd>AAL2 (15m)</kbd> • `finance.transaction.create` | **Obrigatória** | Gateway transacional multicanal genérico |
| ![GET](https://img.shields.io/badge/GET-0284c7?style=flat-square) | `/transactions` | [`FinanceController.listTransactions`](file:///home/sandro/Área de trabalho/BackEnd/src/interfaces/http/controllers/finance/FinanceController.ts#L296) | <kbd>AAL2</kbd> • Próprio / Admin | Opcional | Extrato com paginação defensiva por cursor |
| ![GET](https://img.shields.io/badge/GET-0284c7?style=flat-square) | `/external-transactions` | [`FinanceController.getExternalTransactions`](file:///home/sandro/Área de trabalho/BackEnd/src/interfaces/http/controllers/finance/FinanceController.ts#L331) | <kbd>AAL2</kbd> • `finance.treasury.read` | Opcional | Staging de conciliação bancária externa |
| ![GET](https://img.shields.io/badge/GET-0284c7?style=flat-square) | `/reports/consolidated` | [`FinanceController.getConsolidatedReport`](file:///home/sandro/Área de trabalho/BackEnd/src/interfaces/http/controllers/finance/FinanceController.ts#L381) | <kbd>AAL2</kbd> • `finance.treasury.read` | Opcional | Balancete patrimonial consolidado (Ativo = Passivo + PL) |

> [!IMPORTANT]
> **Idempotência & Fencing Distribuído:** Todas as operações mutatórias (`POST`) exigem o header `Idempotency-Key`. Tentativas de repetição legítimas recebem o resultado original em cache com o header `Idempotency-Replayed: true`, prevenindo double-spend sem reprocessar saldo ou razão.

---

### 🏛️ Especificação Visual por Domínio de Negócio

#### 🏦 1. Gestão de Tesouraria & Balanços Materializados

<details open>
<summary><b><kbd>GET</kbd> <code>/treasury/balance</code> — Consulta Consolidada de Saldo da Tesouraria</b></summary>

| Atributo | Especificação de Engenharia |
| :--- | :--- |
| **Controlador** | [`FinanceController.getBalance()`](file:///home/sandro/Área de trabalho/BackEnd/src/interfaces/http/controllers/finance/FinanceController.ts#L21) |
| **Caso de Uso** | [`GetTreasuryBalanceUseCase`](file:///home/sandro/Área de trabalho/BackEnd/src/application/finance/use-cases/GetTreasuryBalanceUseCase.ts) |
| **Segurança & RBAC** | <kbd>sessionGuard</kbd> • <kbd>requireAal(2)</kbd> • `finance.treasury.read` |
| **Idempotência** | Opcional / Não aplicável (Operação de leitura segura) |
| **Operação Contábil** | Retorna os saldos consolidados (`availableBaseUnits`, `lockedBaseUnits`, `totalBaseUnits`) da conta mestre |
| **Garantia Técnica** | Leitura atômica com versão de concorrência otimista (OCC) em precisão arbitrária uint256 |

</details>

<details open>
<summary><b><kbd>GET</kbd> <code>/reports/consolidated</code> — Balancete Patrimonial Consolidado</b></summary>

| Atributo | Especificação de Engenharia |
| :--- | :--- |
| **Controlador** | [`FinanceController.getConsolidatedReport()`](file:///home/sandro/Área de trabalho/BackEnd/src/interfaces/http/controllers/finance/FinanceController.ts#L381) |
| **Caso de Uso** | [`GetConsolidatedFinancialReportUseCase`](file:///home/sandro/Área de trabalho/BackEnd/src/application/finance/use-cases/GetConsolidatedFinancialReportUseCase.ts) |
| **Segurança & RBAC** | <kbd>sessionGuard</kbd> • <kbd>requireAal(2)</kbd> • `finance.treasury.read` |
| **Idempotência** | Opcional / Não aplicável (Auditoria de leitura) |
| **Operação Contábil** | Emite o balancete de fechamento comprovando: $	ext{Ativo} = 	ext{Passivo} + 	ext{Patrimônio Líquido}$ |
| **Garantia Técnica** | Prova matemática de conservação de valor auditando todas as contas do livro-razão |

</details>

---

#### 💸 2. Movimentações & Transferências de Usuários

<details open>
<summary><b><kbd>POST</kbd> <code>/deposits</code> — Registro de Depósito de Fundos Externos</b></summary>

| Atributo | Especificação de Engenharia |
| :--- | :--- |
| **Controlador** | [`FinanceController.recordDeposit()`](file:///home/sandro/Área de trabalho/BackEnd/src/interfaces/http/controllers/finance/FinanceController.ts#L193) |
| **Caso de Uso** | [`RecordDepositUseCase`](file:///home/sandro/Área de trabalho/BackEnd/src/application/finance/use-cases/RecordDepositUseCase.ts) |
| **Segurança & RBAC** | <kbd>sessionGuard</kbd> • <kbd>requireAal(2, 15)</kbd> • `finance.deposit.create` |
| **Idempotência** | **Compulsória** via `Idempotency-Key` com lease transacional no D1 |
| **Operação Contábil** | Entrada externa (`INBOUND`): Credita a conta de custódia do usuário e debita a conta clearing de tesouraria |
| **Invariantes & Defesas** | Restrição de destino (usuário comum só deposita para si) • Partidas dobradas rigorosamente balanceadas (FIN-001) |

</details>

<details open>
<summary><b><kbd>POST</kbd> <code>/withdrawals</code> — Solicitação de Saque com Validação de Custódia</b></summary>

| Atributo | Especificação de Engenharia |
| :--- | :--- |
| **Controlador** | [`FinanceController.recordWithdrawal()`](file:///home/sandro/Área de trabalho/BackEnd/src/interfaces/http/controllers/finance/FinanceController.ts#L197) |
| **Caso de Uso** | [`RecordTreasuryTransactionUseCase`](file:///home/sandro/Área de trabalho/BackEnd/src/application/finance/use-cases/RecordTreasuryTransactionUseCase.ts) |
| **Segurança & RBAC** | <kbd>sessionGuard</kbd> • <kbd>requireAal(2, 15)</kbd> • `finance.withdrawal.create` |
| **Idempotência** | **Compulsória** via `Idempotency-Key` (Hash canônico SHA-256) |
| **Operação Contábil** | Saída externa (`OUTBOUND`): Debita o saldo disponível do usuário e credita a tesouraria para liquidação |
| **Invariantes & Defesas** | [`CustodyAuthorizationPolicy`](file:///home/sandro/Área de trabalho/BackEnd/src/domains/finance/contracts/CustodyAuthorizationPolicy.ts) assegura $	ext{saldoDisponível} \ge 	ext{valorSaque}$. Rejeição em compilação do plano |

</details>

<details open>
<summary><b><kbd>POST</kbd> <code>/transfers</code> — Transferência Atômica Peer-to-Peer (P2P)</b></summary>

| Atributo | Especificação de Engenharia |
| :--- | :--- |
| **Controlador** | [`FinanceController.recordTransfer()`](file:///home/sandro/Área de trabalho/BackEnd/src/interfaces/http/controllers/finance/FinanceController.ts#L209) |
| **Caso de Uso** | [`RecordTransferUseCase`](file:///home/sandro/Área de trabalho/BackEnd/src/application/finance/use-cases/RecordTransferUseCase.ts) |
| **Segurança & RBAC** | <kbd>sessionGuard</kbd> • <kbd>requireAal(2, 15)</kbd> • `finance.transfer.create` |
| **Idempotência** | **Compulsória** via `Idempotency-Key` (Fencing token distribuído) |
| **Operação Contábil** | Transferência P2P atômica entre dois usuários sob plano contábil balanceado fechado |
| **Invariantes & Defesas** | Bloqueio de auto-transferência (`source != destination`) • Ordenação lexicográfica de bloqueio anti-deadlock |

</details>

<details open>
<summary><b><kbd>POST</kbd> <code>/payments</code> — Pagamento de Serviços da Plataforma</b></summary>

| Atributo | Especificação de Engenharia |
| :--- | :--- |
| **Controlador** | [`FinanceController.recordPayment()`](file:///home/sandro/Área de trabalho/BackEnd/src/interfaces/http/controllers/finance/FinanceController.ts#L201) |
| **Caso de Uso** | [`RecordTreasuryTransactionUseCase`](file:///home/sandro/Área de trabalho/BackEnd/src/application/finance/use-cases/RecordTreasuryTransactionUseCase.ts) |
| **Segurança & RBAC** | <kbd>sessionGuard</kbd> • <kbd>requireAal(2, 15)</kbd> • `finance.payment.create` |
| **Idempotência** | **Compulsória** via `Idempotency-Key` |
| **Operação Contábil** | Liquidação interna: Debita o saldo da conta do pagador e credita a receita operacional da plataforma |
| **Invariantes & Defesas** | Validação de liquidez do pagador e liquidação imediata sem intermediários |

</details>

---

#### ⚖️ 3. Governança, Estornos & Ajustes Administrativos

<details open>
<summary><b><kbd>POST</kbd> <code>/refunds</code> — Estorno Contábil Auditado de Transação Prévia</b></summary>

| Atributo | Especificação de Engenharia |
| :--- | :--- |
| **Controlador** | [`FinanceController.recordRefund()`](file:///home/sandro/Área de trabalho/BackEnd/src/interfaces/http/controllers/finance/FinanceController.ts#L205) |
| **Caso de Uso** | [`ReverseTransactionUseCase`](file:///home/sandro/Área de trabalho/BackEnd/src/application/finance/use-cases/ReverseTransactionUseCase.ts) |
| **Segurança & RBAC** | <kbd>sessionGuard</kbd> • <kbd>requireAal(2, 15)</kbd> • `finance.refund.create` |
| **Idempotência** | **Compulsória** via `Idempotency-Key` |
| **Operação Contábil** | Reverte contabilisticamente uma transação anterior (`refundOfTransactionId`) |
| **Invariantes & Defesas** | Inversão espelhada perfeita das pernas contábeis originais • Bloqueio de estorno duplo ou valor excedente |

</details>

<details open>
<summary><b><kbd>POST</kbd> <code>/adjustments</code> — Ajuste Administrativo Auditado (4-Eyes)</b></summary>

| Atributo | Especificação de Engenharia |
| :--- | :--- |
| **Controlador** | [`FinanceController.recordAdjustment()`](file:///home/sandro/Área de trabalho/BackEnd/src/interfaces/http/controllers/finance/FinanceController.ts#L292) |
| **Caso de Uso** | [`RecordTreasuryTransactionUseCase`](file:///home/sandro/Área de trabalho/BackEnd/src/application/finance/use-cases/RecordTreasuryTransactionUseCase.ts) |
| **Segurança & RBAC** | <kbd>sessionGuard</kbd> • <kbd>requireAal(2, Admin)</kbd> • `finance.adjustment.create` |
| **Idempotência** | **Compulsória** via `Idempotency-Key` |
| **Operação Contábil** | Correções patrimoniais extraordinárias com justificativa formal registrada no razão |
| **Invariantes & Defesas** | Princípio de 4 Olhos • Autorizador (`authorizedByUserId`) injetado compulsoriamente pela sessão física |

</details>

<details open>
<summary><b><kbd>POST</kbd> <code>/transactions</code> — Gateway Transacional Multicanal Genérico</b></summary>

| Atributo | Especificação de Engenharia |
| :--- | :--- |
| **Controlador** | [`FinanceController.recordTransaction()`](file:///home/sandro/Área de trabalho/BackEnd/src/interfaces/http/controllers/finance/FinanceController.ts#L189) |
| **Caso de Uso** | [`RecordLedgerTransactionUseCase`](file:///home/sandro/Área de trabalho/BackEnd/src/application/finance/use-cases/RecordLedgerTransactionUseCase.ts) |
| **Segurança & RBAC** | <kbd>sessionGuard</kbd> • <kbd>requireAal(2, 15)</kbd> • `finance.transaction.create` |
| **Idempotência** | **Compulsória** via `Idempotency-Key` |
| **Operação Contábil** | Ponto de integração para submissão direta de eventos contábeis parametrizados |
| **Invariantes & Defesas** | Sanitização textual anti-DoS via [`FinancialTextPolicy`](file:///home/sandro/Área de trabalho/BackEnd/src/domains/finance/policies/FinancialTextPolicy.ts) • Checagem de capabilities |

</details>

---

#### 🔍 4. Auditoria Forense & Conciliação Bancária

<details open>
<summary><b><kbd>GET</kbd> <code>/transactions</code> — Extrato de Transações com Paginação por Cursor</b></summary>

| Atributo | Especificação de Engenharia |
| :--- | :--- |
| **Controlador** | [`FinanceController.listTransactions()`](file:///home/sandro/Área de trabalho/BackEnd/src/interfaces/http/controllers/finance/FinanceController.ts#L296) |
| **Caso de Uso** | [`IFinanceRepository.listTransactions()`](file:///home/sandro/Área de trabalho/BackEnd/src/application/ports/output/IFinanceRepository.ts) |
| **Segurança & RBAC** | <kbd>sessionGuard</kbd> • <kbd>requireAal(2)</kbd> • Próprio Usuário ou `finance.treasury.read` |
| **Idempotência** | Opcional / Não aplicável (Operação de leitura segura) |
| **Operação Contábil** | Retorna a listagem cronológica forense das transações financeiras registradas |
| **Garantia Técnica** | Paginação defensiva por cursor (`limit <= 100`) • Proteção **Fail-Closed** contra vazamento do razão global |

</details>

<details open>
<summary><b><kbd>GET</kbd> <code>/external-transactions</code> — Staging de Extratos Bancários Externos</b></summary>

| Atributo | Especificação de Engenharia |
| :--- | :--- |
| **Controlador** | [`FinanceController.getExternalTransactions()`](file:///home/sandro/Área de trabalho/BackEnd/src/interfaces/http/controllers/finance/FinanceController.ts#L331) |
| **Caso de Uso** | [`GetExternalTransactionsUseCase`](file:///home/sandro/Área de trabalho/BackEnd/src/application/finance/use-cases/GetExternalTransactionsUseCase.ts) |
| **Segurança & RBAC** | <kbd>sessionGuard</kbd> • <kbd>requireAal(2)</kbd> • `finance.treasury.read` |
| **Idempotência** | Opcional / Não aplicável (Operação de leitura segura) |
| **Operação Contábil** | Consulta registros brutos de conciliação bancária externa (Bradesco, Cora, Inter) |
| **Garantia Técnica** | Filtros por status de conciliação (`unmatched`, `matched`, `ignored`), provedor bancário e data |

</details>

---

## 📁 3. Tabela de Arquivos do Módulo (84 Arquivos Físicos)

Todos os **84 arquivos** do módulo Finance Core foram auditados, certificados e congelados (**100% `FROZEN`**, média geral **9,98 / 10,0**).

<p align="center">
  <img src="./assets/finance_layers_breakdown.svg" width="100%" alt="Finance Core Architectural Layers & Audit Matrix" />
</p>

### 📋 Inventário Completo dos 84 Arquivos

| # | Camada | Arquivo | Responsabilidade Central | Atualizado | Nota |
| :-: | :--- | :--- | :--- | :-: | :-: |
| 01 | Domínio | [`src/domains/finance/contracts/AuthorizationContext.ts`](file:///home/sandro/Área de trabalho/BackEnd/src/domains/finance/contracts/AuthorizationContext.ts) | Contexto imutável de autorização do ator | 2026-09-28 | **10,0** |
| 02 | Domínio | [`src/domains/finance/contracts/CustodyAuthorizationPolicy.ts`](file:///home/sandro/Área de trabalho/BackEnd/src/domains/finance/contracts/CustodyAuthorizationPolicy.ts) | Política de autorização de custódia e débito | 2026-09-28 | **10,0** |
| 03 | Domínio | [`src/domains/finance/contracts/DeterministicIdGenerator.ts`](file:///home/sandro/Área de trabalho/BackEnd/src/domains/finance/contracts/DeterministicIdGenerator.ts) | Gerador determinístico de 53 bits (Lazy Cloudflare) | 2026-09-28 | **10,0** |
| 04 | Domínio | [`src/domains/finance/contracts/FinancialLedgerEntryRecord.ts`](file:///home/sandro/Área de trabalho/BackEnd/src/domains/finance/contracts/FinancialLedgerEntryRecord.ts) | Contrato de perna contábil em partidas dobradas | 2026-09-28 | **10,0** |
| 05 | Domínio | [`src/domains/finance/contracts/IdempotencyScope.ts`](file:///home/sandro/Área de trabalho/BackEnd/src/domains/finance/contracts/IdempotencyScope.ts) | Escopo tripartite de chave de idempotência | 2026-09-28 | **10,0** |
| 06 | Domínio | [`src/domains/finance/contracts/PostingPlan.ts`](file:///home/sandro/Área de trabalho/BackEnd/src/domains/finance/contracts/PostingPlan.ts) | Plano selado de escrita contábil (FIN-001) | 2026-09-28 | **10,0** |
| 07 | Domínio | [`src/domains/finance/contracts/PostingSession.ts`](file:///home/sandro/Área de trabalho/BackEnd/src/domains/finance/contracts/PostingSession.ts) | Token OCap de uso único contra replay e deadlocks | 2026-09-28 | **10,0** |
| 08 | Domínio | [`src/domains/finance/entities/FinancialAccount.ts`](file:///home/sandro/Área de trabalho/BackEnd/src/domains/finance/entities/FinancialAccount.ts) | Agregado de conta financeira | 2026-09-28 | **10,0** |
| 09 | Domínio | [`src/domains/finance/entities/FinancialTransaction.ts`](file:///home/sandro/Área de trabalho/BackEnd/src/domains/finance/entities/FinancialTransaction.ts) | Agregado de ciclo de vida da transação | 2026-09-28 | **10,0** |
| 10 | Domínio | [`src/domains/finance/entities/LedgerEntry.ts`](file:///home/sandro/Área de trabalho/BackEnd/src/domains/finance/entities/LedgerEntry.ts) | Lançamento imutável no livro-razão | 2026-09-28 | **10,0** |
| 11 | Domínio | [`src/domains/finance/entities/LedgerTransaction.ts`](file:///home/sandro/Área de trabalho/BackEnd/src/domains/finance/entities/LedgerTransaction.ts) | Agrupador atômico de partidas dobradas | 2026-09-28 | **10,0** |
| 12 | Domínio | [`src/domains/finance/errors/FinancialError.ts`](file:///home/sandro/Área de trabalho/BackEnd/src/domains/finance/errors/FinancialError.ts) | Catálogo de erros tipados de domínio | 2026-09-28 | **10,0** |
| 13 | Domínio | [`src/domains/finance/policies/AccountingEntryPolicy.ts`](file:///home/sandro/Área de trabalho/BackEnd/src/domains/finance/policies/AccountingEntryPolicy.ts) | Políticas contábeis de pernas e saldos iniciais | 2026-09-28 | **10,0** |
| 14 | Domínio | [`src/domains/finance/policies/AssetStatusPolicy.ts`](file:///home/sandro/Área de trabalho/BackEnd/src/domains/finance/policies/AssetStatusPolicy.ts) | Políticas de transacionabilidade de ativos | 2026-09-28 | **10,0** |
| 15 | Domínio | [`src/domains/finance/policies/FinancialTextPolicy.ts`](file:///home/sandro/Área de trabalho/BackEnd/src/domains/finance/policies/FinancialTextPolicy.ts) | Sanitização anti-DoS e normalização textual | 2026-09-28 | **10,0** |
| 16 | Domínio | [`src/domains/finance/policies/NormalBalancePolicy.ts`](file:///home/sandro/Área de trabalho/BackEnd/src/domains/finance/policies/NormalBalancePolicy.ts) | Equação patrimonial e saldo normal por classe | 2026-09-28 | **10,0** |
| 17 | Domínio | [`src/domains/finance/services/FinancialTransactionStateMachine.ts`](file:///home/sandro/Área de trabalho/BackEnd/src/domains/finance/services/FinancialTransactionStateMachine.ts) | Máquina de estados finitos transacional | 2026-09-28 | **10,0** |
| 18 | Domínio | [`src/domains/finance/services/PostingPlanBuilder.ts`](file:///home/sandro/Área de trabalho/BackEnd/src/domains/finance/services/PostingPlanBuilder.ts) | Compilador de planos contábeis e ordenação de locks | 2026-09-28 | **10,0** |
| 19 | Domínio | [`src/domains/finance/value-objects/AccountClass.ts`](file:///home/sandro/Área de trabalho/BackEnd/src/domains/finance/value-objects/AccountClass.ts) | Value Object das 5 naturezas contábeis | 2026-09-28 | **10,0** |
| 20 | Domínio | [`src/domains/finance/value-objects/BaseUnits.ts`](file:///home/sandro/Área de trabalho/BackEnd/src/domains/finance/value-objects/BaseUnits.ts) | Conversão de representação sem perda decimal | 2026-09-28 | **10,0** |
| 21 | Domínio | [`src/domains/finance/value-objects/FinancialIdentifier.ts`](file:///home/sandro/Área de trabalho/BackEnd/src/domains/finance/value-objects/FinancialIdentifier.ts) | Identificadores numéricos e UUIDs canônicos | 2026-09-28 | **10,0** |
| 22 | Domínio | [`src/domains/finance/value-objects/Money256.ts`](file:///home/sandro/Área de trabalho/BackEnd/src/domains/finance/value-objects/Money256.ts) | Aritmética de precisão arbitrária uint256 | 2026-09-28 | **10,0** |
| 23 | Aplicação | [`src/application/finance/errors/FinancialErrorMapper.ts`](file:///home/sandro/Área de trabalho/BackEnd/src/application/finance/errors/FinancialErrorMapper.ts) | Mapeamento de erros de domínio para status HTTP | 2026-09-28 | **10,0** |
| 24 | Aplicação | [`src/application/finance/services/CanonicalRequestHashService.ts`](file:///home/sandro/Área de trabalho/BackEnd/src/application/finance/services/CanonicalRequestHashService.ts) | Hashing SHA-256 canônico de requisições | 2026-09-28 | **10,0** |
| 25 | Aplicação | [`src/application/finance/services/FinancialTransactionOrchestrator.ts`](file:///home/sandro/Área de trabalho/BackEnd/src/application/finance/services/FinancialTransactionOrchestrator.ts) | Orquestrador de concorrência e escrita contábil | 2026-09-28 | **10,0** |
| 26 | Aplicação | [`src/application/finance/services/PostingAuthority.ts`](file:///home/sandro/Área de trabalho/BackEnd/src/application/finance/services/PostingAuthority.ts) | Barreira Gate 0 autorizando commits contábeis | 2026-09-28 | **10,0** |
| 27 | Aplicação | [`src/application/finance/use-cases/GetConsolidatedFinancialReportUseCase.ts`](file:///home/sandro/Área de trabalho/BackEnd/src/application/finance/use-cases/GetConsolidatedFinancialReportUseCase.ts) | Emissão de balancete patrimonial consolidado | 2026-09-28 | **10,0** |
| 28 | Aplicação | [`src/application/finance/use-cases/GetExternalTransactionsUseCase.ts`](file:///home/sandro/Área de trabalho/BackEnd/src/application/finance/use-cases/GetExternalTransactionsUseCase.ts) | Leitura de extratos bancários externos em staging | 2026-09-28 | **10,0** |
| 29 | Aplicação | [`src/application/finance/use-cases/GetTreasuryBalanceUseCase.ts`](file:///home/sandro/Área de trabalho/BackEnd/src/application/finance/use-cases/GetTreasuryBalanceUseCase.ts) | Consulta do saldo mestre da tesouraria | 2026-09-28 | **10,0** |
| 30 | Aplicação | [`src/application/finance/use-cases/RecordDepositUseCase.ts`](file:///home/sandro/Área de trabalho/BackEnd/src/application/finance/use-cases/RecordDepositUseCase.ts) | Registro de depósito de usuário | 2026-09-28 | **10,0** |
| 31 | Aplicação | [`src/application/finance/use-cases/RecordLedgerTransactionUseCase.ts`](file:///home/sandro/Área de trabalho/BackEnd/src/application/finance/use-cases/RecordLedgerTransactionUseCase.ts) | Escrita direta no razão contábil | 2026-09-28 | **10,0** |
| 32 | Aplicação | [`src/application/finance/use-cases/RecordTransferUseCase.ts`](file:///home/sandro/Área de trabalho/BackEnd/src/application/finance/use-cases/RecordTransferUseCase.ts) | Transferência peer-to-peer (P2P) entre usuários | 2026-09-28 | **10,0** |
| 33 | Aplicação | [`src/application/finance/use-cases/RecordTreasuryTransactionUseCase.ts`](file:///home/sandro/Área de trabalho/BackEnd/src/application/finance/use-cases/RecordTreasuryTransactionUseCase.ts) | Mutações contábeis de tesouraria | 2026-09-28 | **10,0** |
| 34 | Aplicação | [`src/application/finance/use-cases/RepairFinanceUseCase.ts`](file:///home/sandro/Área de trabalho/BackEnd/src/application/finance/use-cases/RepairFinanceUseCase.ts) | Saneamento e reparo contábil emergencial (4-Eyes) | 2026-09-28 | **10,0** |
| 35 | Aplicação | [`src/application/finance/use-cases/ReverseTransactionUseCase.ts`](file:///home/sandro/Área de trabalho/BackEnd/src/application/finance/use-cases/ReverseTransactionUseCase.ts) | Estorno de transações prévias aprovadas | 2026-09-28 | **10,0** |
| 36 | Aplicação | [`src/application/ports/output/IFinanceRepository.ts`](file:///home/sandro/Área de trabalho/BackEnd/src/application/ports/output/IFinanceRepository.ts) | Porta de persistência de contas e idempotência | 2026-09-28 | **10,0** |
| 37 | Aplicação | [`src/application/ports/output/IPostingAuthority.ts`](file:///home/sandro/Área de trabalho/BackEnd/src/application/ports/output/IPostingAuthority.ts) | Porta de autorização de escrita contábil | 2026-09-28 | **10,0** |
| 38 | Aplicação | [`src/application/ports/output/IPostingExecutor.ts`](file:///home/sandro/Área de trabalho/BackEnd/src/application/ports/output/IPostingExecutor.ts) | Porta de execução física atômica do plano | 2026-09-28 | **10,0** |
| 39 | Infraestrutura | [`src/infrastructure/adapters/D1AtomicPostingExecutor.ts`](file:///home/sandro/Área de trabalho/BackEnd/src/infrastructure/adapters/D1AtomicPostingExecutor.ts) | Executor físico atômico de batches D1 com OCC | 2026-09-28 | **10,0** |
| 40 | Infraestrutura | [`src/infrastructure/repositories/DrizzleFinanceRepository.ts`](file:///home/sandro/Área de trabalho/BackEnd/src/infrastructure/repositories/DrizzleFinanceRepository.ts) | Repositório financeiro sobre Drizzle / SQLite D1 | 2026-09-28 | **9,9** |
| 41 | Infraestrutura | [`src/infrastructure/repositories/DrizzleOutboxRepository.ts`](file:///home/sandro/Área de trabalho/BackEnd/src/infrastructure/repositories/DrizzleOutboxRepository.ts) | Repositório transactional outbox para mensageria | 2026-09-28 | **10,0** |
| 42 | Infraestrutura | [`src/infrastructure/repositories/DrizzleUnitOfWork.ts`](file:///home/sandro/Área de trabalho/BackEnd/src/infrastructure/repositories/DrizzleUnitOfWork.ts) | Unit of Work gerenciando transações atômicas D1 | 2026-09-28 | **10,0** |
| 43 | Infraestrutura | [`src/infrastructure/services/EventInboxService.ts`](file:///home/sandro/Área de trabalho/BackEnd/src/infrastructure/services/EventInboxService.ts) | Ingestão e deduplicação de eventos assíncronos | 2026-09-28 | **10,0** |
| 44 | Infraestrutura | [`src/infrastructure/services/FinanceBootstrapService.ts`](file:///home/sandro/Área de trabalho/BackEnd/src/infrastructure/services/FinanceBootstrapService.ts) | Inicialização gênesis idempotente do plano de contas | 2026-09-28 | **10,0** |
| 45 | Infraestrutura | [`src/infrastructure/services/FinancialHistoricalImportService.ts`](file:///home/sandro/Área de trabalho/BackEnd/src/infrastructure/services/FinancialHistoricalImportService.ts) | Pipeline de importação de extratos bancários | 2026-09-28 | **9,5** |
| 46 | Banco D1 | [`src/db/finance/tables.ts`](file:///home/sandro/Área de trabalho/BackEnd/src/db/finance/tables.ts) | Schema canônico de 17 tabelas D1 com uint256 | 2026-09-28 | **9,9** |
| 47 | Banco D1 | [`src/db/finance/relations.ts`](file:///home/sandro/Área de trabalho/BackEnd/src/db/finance/relations.ts) | Mapeamento de relações ORM de navegação estrita | 2026-09-28 | **10,0** |
| 48 | Banco D1 | [`src/db/seed_treasury_report.sql`](file:///home/sandro/Área de trabalho/BackEnd/src/db/seed_treasury_report.sql) | Fixture SQL de auditoria da tesouraria ASPPIBRA | 2026-09-28 | **9,2** |
| 49 | HTTP | [`src/interfaces/http/controllers/finance/FinanceController.ts`](file:///home/sandro/Área de trabalho/BackEnd/src/interfaces/http/controllers/finance/FinanceController.ts) | Controlador HTTP Hono com sanitização e DTOs | 2026-09-28 | **9,9** |
| 50 | HTTP | [`src/interfaces/http/routes/finance/finance.routes.ts`](file:///home/sandro/Área de trabalho/BackEnd/src/interfaces/http/routes/finance/finance.routes.ts) | Roteador REST Hono com sessionGuard, AAL2 e RBAC | 2026-09-28 | **10,0** |
| 51 | Migrações | [`migrations/0009_finance_schema_alignment.sql`](file:///home/sandro/Área de trabalho/BackEnd/migrations/0009_finance_schema_alignment.sql) | Alinhamento de schema, índices parciais e staging fiat | 2026-09-28 | **10,0** |
| 52 | Migrações | [`migrations/0010_finance_fixes_and_rates_alignment.sql`](file:///home/sandro/Área de trabalho/BackEnd/migrations/0010_finance_fixes_and_rates_alignment.sql) | Câmbio racional exato em TEXT e erradicação de floats | 2026-09-28 | **10,0** |
| 53 | Migrações | [`migrations/0011_treasury_singleton_and_forensic_audit.sql`](file:///home/sandro/Área de trabalho/BackEnd/migrations/0011_treasury_singleton_and_forensic_audit.sql) | Singleton físico de tesouraria e trilhas forenses | 2026-09-28 | **10,0** |
| 54 | Migrações | [`migrations/0012_finance_p0_hardening.sql`](file:///home/sandro/Área de trabalho/BackEnd/migrations/0012_finance_p0_hardening.sql) | Triggers SQLite append-only, ordinais e _sql_assertions | 2026-09-28 | **10,0** |
| 55 | Testes | [`tests/architecture/architecture-boundaries.test.ts`](file:///home/sandro/Área de trabalho/BackEnd/tests/architecture/architecture-boundaries.test.ts) | Limites arquiteturais Clean Architecture e DIP estrito | 2026-09-28 | **10,0** |
| 56 | Testes | [`tests/architecture/dependency_rules.test.ts`](file:///home/sandro/Área de trabalho/BackEnd/tests/architecture/dependency_rules.test.ts) | Regras centrípetas de dependência de pacotes | 2026-09-28 | **10,0** |
| 57 | Testes | [`tests/architecture/finance_posting_authority.test.ts`](file:///home/sandro/Área de trabalho/BackEnd/tests/architecture/finance_posting_authority.test.ts) | Proibição de bypass fora da PostingAuthority | 2026-09-28 | **10,0** |
| 58 | Testes | [`tests/architecture/static_architecture.test.ts`](file:///home/sandro/Área de trabalho/BackEnd/tests/architecture/static_architecture.test.ts) | Análise estática contra imports circulares | 2026-09-28 | **10,0** |
| 59 | Testes | [`tests/finance/invariants/balance_projection.test.ts`](file:///home/sandro/Área de trabalho/BackEnd/tests/finance/invariants/balance_projection.test.ts) | Projeção causal de saldo a partir do razão | 2026-09-28 | **10,0** |
| 60 | Testes | [`tests/finance/invariants/commit_failure.test.ts`](file:///home/sandro/Área de trabalho/BackEnd/tests/finance/invariants/commit_failure.test.ts) | Rollback atômico em falha simulada de commit | 2026-09-28 | **10,0** |
| 61 | Testes | [`tests/finance/invariants/seeds_normal_balance.test.ts`](file:///home/sandro/Área de trabalho/BackEnd/tests/finance/invariants/seeds_normal_balance.test.ts) | Validação contábil de normal balance dos seeds | 2026-09-28 | **10,0** |
| 62 | Testes | [`tests/finance/invariants/transaction_failure_matrix.test.ts`](file:///home/sandro/Área de trabalho/BackEnd/tests/finance/invariants/transaction_failure_matrix.test.ts) | Matriz de contorno de falhas em mutações contábeis | 2026-09-28 | **10,0** |
| 63 | Testes | [`tests/finance/DrizzleFinanceRepository.test.ts`](file:///home/sandro/Área de trabalho/BackEnd/tests/finance/DrizzleFinanceRepository.test.ts) | Persistência D1 local e integridade de foreign keys | 2026-09-28 | **10,0** |
| 64 | Testes | [`tests/finance/FinancialTransaction.test.ts`](file:///home/sandro/Área de trabalho/BackEnd/tests/finance/FinancialTransaction.test.ts) | Agregado de domínio e máquinas de estado de transações | 2026-09-28 | **10,0** |
| 65 | Testes | [`tests/finance/adversarial_certification.test.ts`](file:///home/sandro/Área de trabalho/BackEnd/tests/finance/adversarial_certification.test.ts) | Ataques de double-spend, replay e desbalanceamento | 2026-09-28 | **10,0** |
| 66 | Testes | [`tests/finance/audit_gaps_hardening.test.ts`](file:///home/sandro/Área de trabalho/BackEnd/tests/finance/audit_gaps_hardening.test.ts) | Regressão de brechas de auditoria de ciclos prévios | 2026-09-28 | **10,0** |
| 67 | Testes | [`tests/finance/bootstrap_atomicity.test.ts`](file:///home/sandro/Área de trabalho/BackEnd/tests/finance/bootstrap_atomicity.test.ts) | Atomicidade integral do bootstrap contábil do sistema | 2026-09-28 | **10,0** |
| 68 | Testes | [`tests/finance/bootstrap_service.test.ts`](file:///home/sandro/Área de trabalho/BackEnd/tests/finance/bootstrap_service.test.ts) | Idempotência na re-execução do provisionamento | 2026-09-28 | **10,0** |
| 69 | Testes | [`tests/finance/concurrency_idempotency_same_key.test.ts`](file:///home/sandro/Área de trabalho/BackEnd/tests/finance/concurrency_idempotency_same_key.test.ts) | Disputa com mesma chave de idempotência concorrente | 2026-09-28 | **10,0** |
| 70 | Testes | [`tests/finance/concurrency_stress.test.ts`](file:///home/sandro/Área de trabalho/BackEnd/tests/finance/concurrency_stress.test.ts) | Estresse de alta frequência e ordenação anti-deadlock | 2026-09-28 | **10,0** |
| 71 | Testes | [`tests/finance/domain_freeze_hardening.test.ts`](file:///home/sandro/Área de trabalho/BackEnd/tests/finance/domain_freeze_hardening.test.ts) | Congelamento profundo de contratos e entidades | 2026-09-28 | **10,0** |
| 72 | Testes | [`tests/finance/domain_policies.test.ts`](file:///home/sandro/Área de trabalho/BackEnd/tests/finance/domain_policies.test.ts) | Validação unitária de todas as policies (FIN-001/025) | 2026-09-28 | **10,0** |
| 73 | Testes | [`tests/finance/event_inbox.test.ts`](file:///home/sandro/Área de trabalho/BackEnd/tests/finance/event_inbox.test.ts) | Deduplicação de eventos assíncronos e renovação CAS | 2026-09-28 | **10,0** |
| 74 | Testes | [`tests/finance/evm_precision.test.ts`](file:///home/sandro/Área de trabalho/BackEnd/tests/finance/evm_precision.test.ts) | Compatibilidade aritmética EVM uint256 (18 casas) | 2026-09-28 | **10,0** |
| 75 | Testes | [`tests/finance/failure_injection.test.ts`](file:///home/sandro/Área de trabalho/BackEnd/tests/finance/failure_injection.test.ts) | Injeção de falha de disco mantendo consistência ACID | 2026-09-28 | **10,0** |
| 76 | Testes | [`tests/finance/finance_controller_e2e.test.ts`](file:///home/sandro/Área de trabalho/BackEnd/tests/finance/finance_controller_e2e.test.ts) | E2E HTTP Hono (201, 200 Replay, 400, 403, 409, 500) | 2026-09-28 | **10,0** |
| 77 | Testes | [`tests/finance/finance_real_db_e2e.test.ts`](file:///home/sandro/Área de trabalho/BackEnd/tests/finance/finance_real_db_e2e.test.ts) | E2E ponta a ponta com banco D1 local real | 2026-09-28 | **10,0** |
| 78 | Testes | [`tests/finance/money256.test.ts`](file:///home/sandro/Área de trabalho/BackEnd/tests/finance/money256.test.ts) | Provas matemáticas de precisão de 256 bits | 2026-09-28 | **10,0** |
| 79 | Testes | [`tests/finance/phase4_hardening.test.ts`](file:///home/sandro/Área de trabalho/BackEnd/tests/finance/phase4_hardening.test.ts) | Paginação defensiva e trilhas forenses de estorno | 2026-09-28 | **10,0** |
| 80 | Testes | [`tests/finance/posting_authority_hardening.test.ts`](file:///home/sandro/Área de trabalho/BackEnd/tests/finance/posting_authority_hardening.test.ts) | Isolamento da barreira PostingAuthority | 2026-09-28 | **10,0** |
| 81 | Testes | [`tests/finance/reconciliation_3way.test.ts`](file:///home/sandro/Área de trabalho/BackEnd/tests/finance/reconciliation_3way.test.ts) | Reconciliação bancária tripla (extrato vs razão) | 2026-09-28 | **10,0** |
| 82 | Testes | [`tests/finance/reverse_transaction.test.ts`](file:///home/sandro/Área de trabalho/BackEnd/tests/finance/reverse_transaction.test.ts) | Estorno contábil com partidas espelhadas perfeitas | 2026-09-28 | **10,0** |
| 83 | Testes | [`tests/finance/schema_drift.test.ts`](file:///home/sandro/Área de trabalho/BackEnd/tests/finance/schema_drift.test.ts) | Detecção e prevenção de deriva estrutural de esquema | 2026-09-28 | **10,0** |
| 84 | Testes | [`tests/finance/schema_invariants_audit.test.ts`](file:///home/sandro/Área de trabalho/BackEnd/tests/finance/schema_invariants_audit.test.ts) | Auditoria de índices, constraints uint256 e triggers | 2026-09-28 | **10,0** |

---

<p align="center">
  <b>ASPPIBRA Ecosystem • Finance Core Engine</b><br/>
  <i>100% dos 84 arquivos homologados • 394 testes automatizados aprovados • Produção Ativa</i>
</p>
