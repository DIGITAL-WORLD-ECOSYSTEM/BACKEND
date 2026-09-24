# Finance Core — Mapeamento Arquitetural, Diagramas & Checklist Unificado de Auditoria

> **Documento Oficial de Engenharia & Auditoria de Fronteira (Gate 0 / P0 Hardened)**  
> **Versão:** 2.6.0 (P0 Hardened Post-Audit)  
> **Ambiente de Execução:** Cloudflare Workers (D1 SQLite) + Drizzle ORM + Hono Framework  
> **Padrão Arquitetural:** Clean Architecture + Domain-Driven Design (DDD) + Append-Only Double-Entry Ledger com Balanços Materializados Síncronos (State-Based OCC) + Transactional Outbox Pattern  
> **Aritmética & Armazenamento:** Precisão Arbitrária de 256 bits (`Money256` / `BigInt` em Memória V8) + Persistência em Texto Canônico (`TEXT`) no Cloudflare D1 SQLite

---

## 1. Diagrama Arquitetural Completo (Clean Architecture & Posting Boundary)

O diagrama a seguir descreve a topologia integral de entrada, orquestração, regras de negócio puras, contratos de custódia, isolamento de autoridade contábil e persistência atômica no banco de dados Cloudflare D1.

```mermaid
flowchart TD
    %% ==========================================
    %% CAMADA DE ENTRADA HTTP (INGRESS & GUARDS)
    %% ==========================================
    subgraph INGRESS [Camada 4 - Apresentacao HTTP e Ingress]
        REQ["Cliente HTTP / Frontend"] --> SG["sessionGuard<br/>(Validacao fisica no D1 user_sessions)"]
        SG --> AAL["requireAal(2, 15)<br/>(Autenticacao Recente e Forte)"]
        AAL --> RBAC["verifyPermission<br/>(RBAC DB-Backed e Injecao de Contexto)"]
        RBAC --> ROUTES["finance.routes.ts<br/>(Roteamento Semantico Tipado)"]
        ROUTES --> CTRL["FinanceController.ts<br/>(Parse Safe Integer, DTOs, Error Mapping)"]
    end

    %% ==========================================
    %% CAMADA DE APLICAÇÃO (USE CASES & ORQUESTRAÇÃO)
    %% ==========================================
    subgraph APPLICATION [Camada 2 - Aplicacao, Casos de Uso e Portas]
        CTRL -->|Mutacoes| UC_TX["RecordTreasuryTransactionUseCase"]
        CTRL -->|Transferencia P2P| UC_TR["RecordTransferUseCase"]
        CTRL -->|Deposito| UC_DEP["RecordDepositUseCase"]
        CTRL -->|Estorno Auditado| UC_REV["ReverseTransactionUseCase"]
        CTRL -->|Consultas| UC_REP["GetConsolidatedFinancialReportUseCase"]
        CTRL -->|Extratos Externos| UC_EXT["GetExternalTransactionsUseCase"]
        CTRL -->|Saldo Tesouraria| UC_BAL["GetTreasuryBalanceUseCase"]

        HASH_SRV["CanonicalRequestHashService<br/>(Hash Canonico SHA-256 Soberano)"]
        UC_TX -->|Verificacao de Hash| HASH_SRV
        UC_TR -->|Verificacao de Hash| HASH_SRV

        ORCH["FinancialTransactionOrchestrator<br/>(Controle OCC, Idempotencia e State Machine)"]
        UC_TX --> ORCH
        UC_TR --> ORCH
        UC_DEP --> ORCH
        UC_REV --> ORCH

        POST_AUTH["PostingAuthority<br/>(Porta Estrita de Commit Contabil)"]
        ORCH -->|Despacha PostingPlan + Session| POST_AUTH

        subgraph PORTS [Portas de Saida - Abstracoes]
            IFIN_REPO["IFinanceRepository<br/>(Porta de Leitura Contabil e Idempotencia)"]
            IPOST_EXEC["IPostingExecutor<br/>(Porta de Execucao Fisica do Plano)"]
            IUOW["IUnitOfWork<br/>(Fronteira Transacional e Emissao de Sessao)"]
        end

        ORCH -->|Executa no escopo transacional| IUOW
        ORCH -->|Queries e Lease de Idempotencia| IFIN_REPO
        POST_AUTH -->|PostingPlan + PostingSession| IPOST_EXEC
    end

    %% ==========================================
    %% CAMADA DE DOMÍNIO (REGRAS CONTÁBEIS PURAS)
    %% ==========================================
    subgraph DOMAIN [Camada 1 - Dominio e Regras Contabeis Puras]
        AUTH_POL["CustodyAuthorizationPolicy<br/>(Verificacao Soberana de Custodia sobre Debito)"]
        UC_TR -->|Verifica Custodia| AUTH_POL

        PLAN_BLD["PostingPlanBuilder<br/>(Compilador de Mutacoes: Ordenacao Deterministica accountId ASC)"]
        ORCH -->|Compila Plano| PLAN_BLD

        AGG_TX["LedgerTransaction - Aggregate Root<br/>(Partidas Dobradas: Sum Debitos = Sum Creditos)"]
        M256["Money256 - Value Object<br/>(Aritmetica BigInt 256 bits sem float no V8)"]
        ENT_POL["AccountingEntryPolicy<br/>(Matriz Contabil e Regras de Lancamento)"]
        ACC_POL["AccountClassPolicy e AccountStatusPolicy<br/>(Natureza Contabil: Ativo, Passivo, PL)"]

        PLAN_BLD --> AGG_TX
        AGG_TX --> M256
        AGG_TX --> ENT_POL
        ENT_POL --> ACC_POL

        PLAN["PostingPlan - Imutavel<br/>(Transacao + Ledger Entries + Balance Deltas + Outbox)"]
        PLAN_BLD --> PLAN

        TOKEN["PostingCapabilityToken - Unique Symbol<br/>(Nao-forjavel pela aplicacao)"]
        SESS["PostingSession<br/>(Autoridade Fisica de Escrita)"]
        TOKEN --> SESS
    end

    %% ==========================================
    %% CAMADA DE INFRAESTRUTURA & PERSISTÊNCIA
    %% ==========================================
    subgraph INFRA [Camada 3 - Infraestrutura Concreta, Adaptadores e Repositorios]
        DRIZZLE_UOW["DrizzleUnitOfWork.ts<br/>(Portador Exclusivo do Token e Emissor da Session)"]
        D1_EXEC["D1AtomicPostingExecutor.ts<br/>(Execucao d1.batch com Guardas SQL changes() = 1)"]
        DRIZZLE_REPO["DrizzleFinanceRepository.ts<br/>(Adaptador Concreto D1 SQLite)"]
        BOOTSTRAP["FinanceBootstrapService.ts<br/>(Inicializacao Idempotente do Plano de Contas)"]
        OUTBOX_RELAY["Outbox Relay / Worker / EventInboxService<br/>(Despacho Assincrono At-Least-Once)"]
    end

    IUOW --> DRIZZLE_UOW
    IPOST_EXEC --> D1_EXEC
    IFIN_REPO --> DRIZZLE_REPO
    DRIZZLE_UOW -->|Fornece Token e Fabrica| SESS

    %% ==========================================
    %% BANCO DE DADOS (CLOUDFLARE D1 / SQLITE)
    %% ==========================================
    subgraph DATABASE [Camada 5 - Banco de Dados Relacional SQLite D1]
        T_TX["financial_transactions<br/>(Registro da Transacao e Metadados Forenses)"]
        T_ENT["financial_ledger_entries<br/>(Lancamentos Imutaveis com Ordinal Estrito)"]
        T_BAL["account_balances<br/>(Saldos Materializados em TEXT uint256 com Versao OCC)"]
        T_ACC["financial_accounts<br/>(Plano de Contas do Sistema e Usuarios)"]
        T_ASS["financial_assets<br/>(Ativos e Moedas Cadastradas)"]
        T_IDEM["idempotency_keys<br/>(Travamento Concorrente com TTL e Replay)"]
        T_OUT["outbox_events<br/>(Eventos Contabeis Transacionais)"]
        T_SQL_ASSERT["_sql_assertions<br/>(Tabela de Guarda Fisica de Mutacao changes() = 1)"]
    end

    D1_EXEC -->|1. INSERT Transacao| T_TX
    D1_EXEC -->|2. INSERT Pernas Contabeis| T_ENT
    D1_EXEC -->|3. UPDATE Saldo OCC em TEXT| T_BAL
    D1_EXEC -->|4. INSERT Evento Outbox| T_OUT
    D1_EXEC -->|5. UPDATE Idempotencia completed| T_IDEM
    D1_EXEC -->|6. Guarda Fisica changes() = 1| T_SQL_ASSERT

    DRIZZLE_REPO --> T_ACC
    DRIZZLE_REPO --> T_ASS
    DRIZZLE_REPO --> T_IDEM
    T_OUT --> OUTBOX_RELAY
```

---

## 2. Diagrama de Sequência Forense: Ciclo de Commit Contábil

O fluxo a seguir ilustra a orquestração segura contra condições de corrida, contenção OCC, lease timeout de idempotência e validação atômica via `_sql_assertions`.

```mermaid
sequenceDiagram
    autonumber
    actor Cliente as Cliente HTTP
    participant SG as sessionGuard e RBAC
    participant Route as finance.routes.ts
    participant Ctrl as FinanceController
    participant UC as UseCase
    participant Custody as CustodyAuthorizationPolicy
    participant Orch as FinancialTransactionOrchestrator
    participant Hash as CanonicalRequestHashService
    participant Domain as LedgerTransaction e Money256
    participant PlanBld as PostingPlanBuilder
    participant UoW as DrizzleUnitOfWork
    participant Auth as PostingAuthority
    participant Exec as D1AtomicPostingExecutor
    participant D1 as Cloudflare D1 SQLite

    Cliente->>SG: POST /finance/transfers (Bearer JWT e Idempotency-Key)
    SG->>SG: Valida assinatura JWT e lookup fisico em user_sessions
    SG->>Route: Encaminha requisicao com context seguro
    Route->>Ctrl: controller.recordTransfer(c)
    Ctrl->>Ctrl: parseSafePositiveInteger(target, amount, assetId)
    Ctrl->>UC: execute(TransferCommand)
    
    UC->>Custody: canDebitSourceAccount(authCtx, opSpec)
    alt Custodia Violada
        Custody-->>UC: allowed: false (UNAUTHORIZED_CUSTODY)
        UC-->>Ctrl: Result.fail(403 Forbidden)
        Ctrl-->>Cliente: HTTP 403 Forbidden
    else Custodia Autorizada
        Custody-->>UC: allowed: true (SELF ou DELEGATED)
    end

    UC->>Domain: LedgerTransaction.create(entries, actorUserId, authorizedByUserId)
    Domain->>Domain: Valida partidas dobradas: Sum Debito = Sum Credito (por ativo)
    Domain->>Domain: Valida Money256 sem overflow ou underflow no V8 (uint256)

    UC->>Hash: calculateHash(transaction)
    Hash-->>UC: canonicalServerHash

    UC->>Orch: executePosting(transaction)
    Orch->>D1: claimIdempotency(key, scope, canonicalServerHash, leaseTimeoutMs)
    
    alt Chave Conflitante ou Em Processamento Ativo
        D1-->>Orch: Conflict ou In Progress (Lease Valido)
        Orch-->>UC: Result.fail(IdempotencyConflict)
        UC-->>Ctrl: Result.fail(409)
        Ctrl-->>Cliente: HTTP 409 Conflict
    else Chave Ja Concluida - Replay Fiel
        D1-->>Orch: Completed (transactionId, originalResponsePayload)
        Orch-->>Cliente: HTTP 200 OK (Idempotency-Replayed: true, payload completo)
    else Chave Reservada / Lease Expirado Reclamado - Nova Transacao
        Orch->>PlanBld: build(transaction)
        PlanBld->>PlanBld: Calcula signedDeltaBaseUnits em Money256 (BigInt)
        PlanBld->>PlanBld: Ordena balanceMutations por accountId ASC (Deadlock Avoidance)
        PlanBld-->>Orch: PostingPlan (Imutavel)

        Orch->>UoW: execute(async factory => ...)
        UoW->>UoW: Instancia PostingSession com PostingCapabilityToken legiptimo
        UoW->>Auth: commit(PostingPlan, PostingSession)
        Auth->>Exec: execute(plan, session)
        
        Note over Exec, D1: Fronteira Fisica Atomica em Lote Unico via d1.batch()
        Exec->>D1: 1. INSERT financial_transactions (completed, version: 1)
        Exec->>D1: 2. INSERT financial_ledger_entries (entry_ordinal 1..N)
        Exec->>D1: 3. UPDATE account_balances (SET available_base_units = ?, version = version + 1 WHERE version = ? AND status = 'active')
        Exec->>D1: 4. INSERT INTO _sql_assertions (guard = CASE WHEN changes() = 1 THEN 1 ELSE 0 END)
        Exec->>D1: 5. INSERT outbox_events (status: 'pending')
        Exec->>D1: 6. UPDATE idempotency_keys (status: 'completed', transaction_id = ?)
        Exec->>D1: 7. INSERT INTO _sql_assertions (guard = CASE WHEN changes() = 1 THEN 1 ELSE 0 END)
        
        alt Violacao de Versao OCC, Conta Inativa ou Falha de Idempotencia
            D1-->>Exec: Abort Batch (CHECK constraint ck_sql_assertions_guard violada)
            Exec-->>Auth: Result.fail(OptimisticConcurrencyError / AtomicPostingError)
            Auth-->>Orch: Falha com Rollback Automatico no D1
            Orch-->>Ctrl: Result.fail(409 Conflict / 500)
            Ctrl-->>Cliente: HTTP 409 Conflict (com recomendacao de retry com backoff)
        else Commit Sucesso
            D1-->>Exec: Batch Commit Sucesso (Todos os statements persistidos)
            Exec-->>Auth: Result.ok(PostingExecutionResult)
            Auth-->>Orch: Sucesso
            Orch-->>UC: Result.ok(transactionId)
            UC-->>Ctrl: Result.ok(transactionId)
            Ctrl-->>Cliente: HTTP 201 Created (transactionId, payload)
        end
    end
```

---

## 3. Diagrama Entidade-Relacionamento Físico (ERD — Livro-Razão Contábil)

O diagrama a seguir exibe as entidades centrais do razão contábil, suas chaves primárias, relacionamentos de integridade referencial e os tipos de dados físicos persistidos no SQLite D1.

```mermaid
erDiagram
    FINANCIAL_ACCOUNTS ||--o{ ACCOUNT_BALANCES : "possui"
    FINANCIAL_ACCOUNTS ||--o{ FINANCIAL_LEDGER_ENTRIES : "registra perna em"
    FINANCIAL_ASSETS ||--o{ ACCOUNT_BALANCES : "denomina"
    FINANCIAL_ASSETS ||--o{ FINANCIAL_LEDGER_ENTRIES : "especifica ativo"
    FINANCIAL_TRANSACTIONS ||--|{ FINANCIAL_LEDGER_ENTRIES : "contem pernas ordinais"
    FINANCIAL_TRANSACTIONS ||--o| OUTBOX_EVENTS : "emite evento"
    IDEMPOTENCY_KEYS ||--o| FINANCIAL_TRANSACTIONS : "vincula resultado"

    FINANCIAL_ACCOUNTS {
        int id PK "INTEGER AUTOINCREMENT (Safe 53-bit)"
        string user_id FK "TEXT (Nullable para contas sistemicas)"
        string type "TEXT (asset, liability, equity, revenue, expense)"
        string status "TEXT (active, frozen, closed)"
        datetime created_at "INTEGER (Epoch ms)"
    }

    ACCOUNT_BALANCES {
        int id PK "INTEGER AUTOINCREMENT"
        int account_id FK "INTEGER"
        int asset_id FK "INTEGER"
        string available_base_units "TEXT (uint256 string canonica)"
        string locked_base_units "TEXT (uint256 string canonica)"
        int version "INTEGER (OCC Version Tracker)"
        datetime updated_at "INTEGER (Epoch ms)"
    }

    FINANCIAL_ASSETS {
        int id PK "INTEGER AUTOINCREMENT"
        string code "TEXT UNIQUE (BRL, USD, BTC, ETH)"
        int decimals "INTEGER (ex: 2 para fiat, 18 para EVM)"
        string status "TEXT (active, inactive, frozen)"
    }

    FINANCIAL_TRANSACTIONS {
        int id PK "INTEGER (Safe Integer pre-gerado em memoria)"
        string actor_user_id "TEXT"
        string authorized_by_user_id "TEXT"
        string type "TEXT (deposit, withdrawal, transfer, treasury, fee)"
        string category "TEXT"
        string status "TEXT (completed, reversed, failed)"
        int correlation_id "INTEGER"
        datetime created_at "INTEGER (Epoch ms)"
        datetime completed_at "INTEGER (Epoch ms)"
        int version "INTEGER DEFAULT 1"
    }

    FINANCIAL_LEDGER_ENTRIES {
        int id PK "INTEGER AUTOINCREMENT"
        int transaction_id FK "INTEGER"
        int entry_ordinal "INTEGER (Ordinal estrito 1..N por transacao)"
        int account_id FK "INTEGER"
        int asset_id FK "INTEGER"
        string direction "TEXT (DEBIT | CREDIT)"
        string amount_base_units "TEXT (uint256 string canonica)"
        datetime created_at "INTEGER (Epoch ms)"
    }

    IDEMPOTENCY_KEYS {
        string key PK "TEXT (Chave externa enviada pelo cliente)"
        string scope PK "TEXT (Taxonomia de escopo composto)"
        string status "TEXT (processing, completed, failed)"
        string request_hash "TEXT (SHA-256 canonico soberano)"
        int financial_transaction_id FK "INTEGER (Nullable)"
        datetime expires_at "INTEGER (Lease TTL em Epoch ms)"
        datetime created_at "INTEGER (Epoch ms)"
    }

    OUTBOX_EVENTS {
        string id PK "TEXT (UUID v4 do evento)"
        string event_name "TEXT (ex: finance.transaction.posted)"
        string aggregate_id "TEXT"
        string aggregate_type "TEXT (LedgerTransaction)"
        int aggregate_version "INTEGER"
        string payload "TEXT (JSON estruturado imutavel)"
        string status "TEXT (pending, published, failed)"
        int attempts "INTEGER DEFAULT 0"
        datetime created_at "INTEGER (Epoch ms)"
    }

    _SQL_ASSERTIONS {
        int id PK "INTEGER (CHECK id = 1)"
        int guard "INTEGER (CHECK guard = 1 via changes() = 1)"
    }
```

> **Contrato Físico de Aritmética no SQLite:**  
> O SQLite nativo opera com inteiros de 64 bits com sinal. Para suportar unidades de 256 bits com precisão completa de contratos inteligentes EVM ($2^{256}-1$), os campos monetários `amount_base_units`, `available_base_units` e `locked_base_units` são armazenados como **`TEXT`**. A aritmética de atualização e validação contábil ocorre **exclusivamente em memória no runtime V8 via [`Money256`](file:///home/sandro/Área de trabalho/BackEnd/src/domains/finance/value-objects/Money256.ts)**, impedindo qualquer arredondamento ou overflow no banco.

---

## 4. Topologia e Árvore Completa de Diretórios do Módulo Financeiro

A árvore a seguir consolida toda a topologia de diretórios e a localização física dos 76 arquivos do subsistema financeiro, cobrindo o núcleo de domínio, contratos, portas, orquestração, infraestrutura de persistência, rotas de apresentação, migrações D1 e a suíte de testes contábeis e de fronteira arquitetural:

```text
BackEnd/
├── migrations/
│   ├── 0009_finance_schema_alignment.sql
│   ├── 0010_finance_fixes_and_rates_alignment.sql
│   ├── 0011_treasury_singleton_and_forensic_audit.sql
│   └── 0012_finance_p0_hardening.sql
├── src/
│   ├── application/
│   │   ├── finance/
│   │   │   ├── errors/
│   │   │   │   └── FinancialErrorMapper.ts
│   │   │   ├── services/
│   │   │   │   ├── CanonicalRequestHashService.ts
│   │   │   │   ├── FinancialTransactionOrchestrator.ts
│   │   │   │   └── PostingAuthority.ts
│   │   │   └── use-cases/
│   │   │       ├── GetConsolidatedFinancialReportUseCase.ts
│   │   │       ├── GetExternalTransactionsUseCase.ts
│   │   │       ├── GetTreasuryBalanceUseCase.ts
│   │   │       ├── RecordDepositUseCase.ts
│   │   │       ├── RecordLedgerTransactionUseCase.ts
│   │   │       ├── RecordTransferUseCase.ts
│   │   │       ├── RecordTreasuryTransactionUseCase.ts
│   │   │       ├── RepairFinanceUseCase.ts
│   │   │       └── ReverseTransactionUseCase.ts
│   │   └── ports/
│   │       └── output/
│   │           ├── IFinanceRepository.ts
│   │           ├── IPostingExecutor.ts
│   │           └── IUnitOfWork.ts
│   ├── db/
│   │   ├── finance/
│   │   │   ├── relations.ts
│   │   │   └── tables.ts
│   │   └── seed_treasury_report.sql
│   ├── domains/
│   │   └── finance/
│   │       ├── constants/
│   │       │   └── FinancialLimits.ts
│   │       ├── contracts/
│   │       │   ├── AuthorizationContext.ts
│   │       │   ├── DeterministicIdGenerator.ts
│   │       │   ├── FinancialLedgerEntryRecord.ts
│   │       │   ├── IdempotencyScope.ts
│   │       │   ├── PostingPlan.ts
│   │       │   └── PostingSession.ts
│   │       ├── entities/
│   │       │   └── LedgerTransaction.ts
│   │       ├── errors/
│   │       │   ├── FinancialError.ts
│   │       │   └── LedgerImbalanceError.ts
│   │       ├── policies/
│   │       │   ├── AccountClassPolicy.ts
│   │       │   ├── AccountStatusPolicy.ts
│   │       │   ├── AccountingEntryPolicy.ts
│   │       │   ├── AssetStatusPolicy.ts
│   │       │   └── FinancialTextPolicy.ts
│   │       ├── services/
│   │       │   ├── FinancialTransactionStateMachine.ts
│   │       │   └── PostingPlanBuilder.ts
│   │       └── value-objects/
│   │           ├── BaseUnits.ts
│   │           ├── FinancialTransactionStatus.ts
│   │           └── Money256.ts
│   ├── infrastructure/
│   │   ├── repositories/
│   │   │   ├── DrizzleFinanceRepository.ts
│   │   │   ├── DrizzleOutboxRepository.ts
│   │   │   └── DrizzleUnitOfWork.ts
│   │   └── services/
│   │       ├── D1AtomicPostingExecutor.ts
│   │       ├── EventInboxService.ts
│   │       ├── FinanceBootstrapService.ts
│   │       └── FinancialHistoricalImportService.ts
│   └── interfaces/
│       └── http/
│           ├── controllers/
│           │   └── finance/
│           │       └── FinanceController.ts
│           └── routes/
│               └── finance/
│                   └── finance.routes.ts
└── tests/
    ├── architecture/
    │   ├── architecture-boundaries.test.ts
    │   ├── dependency_rules.test.ts
    │   ├── finance_posting_authority.test.ts
    │   └── static_architecture.test.ts
    └── finance/
        ├── invariants/
        │   ├── balance_projection.test.ts
        │   ├── commit_failure.test.ts
        │   ├── seeds_normal_balance.test.ts
        │   └── transaction_failure_matrix.test.ts
        ├── DrizzleFinanceRepository.test.ts
        ├── FinancialTransaction.test.ts
        ├── adversarial_certification.test.ts
        ├── audit_gaps_hardening.test.ts
        ├── bootstrap_atomicity.test.ts
        ├── bootstrap_service.test.ts
        ├── concurrency_idempotency_same_key.test.ts
        ├── concurrency_stress.test.ts
        ├── domain_freeze_hardening.test.ts
        ├── domain_policies.test.ts
        ├── event_inbox.test.ts
        ├── evm_precision.test.ts
        ├── failure_injection.test.ts
        ├── finance_controller_e2e.test.ts
        ├── finance_real_db_e2e.test.ts
        ├── money256.test.ts
        ├── phase4_hardening.test.ts
        ├── posting_authority_hardening.test.ts
        ├── reconciliation_3way.test.ts
        ├── reverse_transaction.test.ts
        ├── schema_drift.test.ts
        └── schema_invariants_audit.test.ts
```

---

## 5. Inventário Descritivo de Todos os 76 Arquivos do Módulo Financeiro

### Camada 1: Domínio Contábil Puro (`src/domains/finance/`) — 20 Arquivos

| # | Arquivo | Responsabilidade Arquitetural | Invariante / Garantia de Segurança |
| :---: | :--- | :--- | :--- |
| **01** | [`constants/FinancialLimits.ts`](file:///home/sandro/Área de trabalho/BackEnd/src/domains/finance/constants/FinancialLimits.ts) | Constantes globais de limites de pernas contábeis, batching e tetos. | Impede transações gigantescas ou lotes que excedam limites de memória. |
| **02** | [`contracts/AuthorizationContext.ts`](file:///home/sandro/Área de trabalho/BackEnd/src/domains/finance/contracts/AuthorizationContext.ts) | Contratos formais de custódia e `CustodyAuthorizationPolicy`. | Impede débito em conta sem autoridade soberana (`SELF` ou `DELEGATED`). |
| **03** | [`contracts/DeterministicIdGenerator.ts`](file:///home/sandro/Área de trabalho/BackEnd/src/domains/finance/contracts/DeterministicIdGenerator.ts) | Gerador determinístico de identificadores de 53 bits (Safe Integer). | IDs conhecidos em memória antes da compilação do lote SQL físico. |
| **04** | [`contracts/FinancialLedgerEntryRecord.ts`](file:///home/sandro/Área de trabalho/BackEnd/src/domains/finance/contracts/FinancialLedgerEntryRecord.ts) | Contrato de dados imutável de transporte das pernas contábeis. | Estrutura de dados canônica para gravação de partidas dobradas. |
| **05** | [`contracts/IdempotencyScope.ts`](file:///home/sandro/Área de trabalho/BackEnd/src/domains/finance/contracts/IdempotencyScope.ts) | Taxonomia canônica de escopos compostos e resultados de claim. | Evita colisão de chaves entre usuários, provedores e operações. |
| **06** | [`contracts/PostingPlan.ts`](file:///home/sandro/Área de trabalho/BackEnd/src/domains/finance/contracts/PostingPlan.ts) | DTO imutável contendo todas as mutações físicas de uma transação. | Fonte Única da Verdade para deltas de saldo (`signedDeltaBaseUnits`). |
| **07** | [`contracts/PostingSession.ts`](file:///home/sandro/Área de trabalho/BackEnd/src/domains/finance/contracts/PostingSession.ts) | *Capability Token* não-forjável protegido por `unique symbol`. | Impede que a aplicação forje sessões contábeis sem a Unit of Work. |
| **08** | [`entities/LedgerTransaction.ts`](file:///home/sandro/Área de trabalho/BackEnd/src/domains/finance/entities/LedgerTransaction.ts) | Raiz de Agregação Contábil (Aggregate Root). | Impõe a Equação Fundamental: $\sum Débito = \sum Crédito$ por ativo. |
| **09** | [`errors/FinancialError.ts`](file:///home/sandro/Área de trabalho/BackEnd/src/domains/finance/errors/FinancialError.ts) | Hierarquia completa de exceções e erros tipados de domínio. | Erros sem acoplamento HTTP com códigos canônicos determinísticos. |
| **10** | [`errors/LedgerImbalanceError.ts`](file:///home/sandro/Área de trabalho/BackEnd/src/domains/finance/errors/LedgerImbalanceError.ts) | Erro específico de desbalanceamento contábil. | Disparado imediatamente se uma perna contábil for desbalanceada. |
| **11** | [`policies/AccountClassPolicy.ts`](file:///home/sandro/Área de trabalho/BackEnd/src/domains/finance/policies/AccountClassPolicy.ts) | Regras das 5 naturezas contábeis (Ativo, Passivo, PL, Receita, Despesa). | Garante regras de saldo normal (devedor vs credor) para cada conta. |
| **12** | [`policies/AccountStatusPolicy.ts`](file:///home/sandro/Área de trabalho/BackEnd/src/domains/finance/policies/AccountStatusPolicy.ts) | Regras de ciclo de vida e permissões operacionais de contas. | Bloqueia lançamentos em contas inativas, suspensas ou encerradas. |
| **13** | [`policies/AccountingEntryPolicy.ts`](file:///home/sandro/Área de trabalho/BackEnd/src/domains/finance/policies/AccountingEntryPolicy.ts) | Políticas de geração de pernas contábeis para depósitos, saques, etc. | Gera pernas espelhadas de contrapartida para partidas dobradas. |
| **14** | [`policies/AssetStatusPolicy.ts`](file:///home/sandro/Área de trabalho/BackEnd/src/domains/finance/policies/AssetStatusPolicy.ts) | Regras de validação e estados de ativos transacionáveis. | Impede operações em moedas e tokens congelados ou não homologados. |
| **15** | [`policies/FinancialTextPolicy.ts`](file:///home/sandro/Área de trabalho/BackEnd/src/domains/finance/policies/FinancialTextPolicy.ts) | Sanitização e validação de textos, descrições e motivos de negócio. | Previne injeção de caracteres de controle e descrições vazias. |
| **16** | [`services/FinancialTransactionStateMachine.ts`](file:///home/sandro/Área de trabalho/BackEnd/src/domains/finance/services/FinancialTransactionStateMachine.ts) | Máquina de estados determinística para o ciclo da transação. | Impede transições ilegais (ex: de `failed` direto para `completed`). |
| **17** | [`services/PostingPlanBuilder.ts`](file:///home/sandro/Área de trabalho/BackEnd/src/domains/finance/services/PostingPlanBuilder.ts) | Compilador que converte intenções de domínio em um `PostingPlan`. | Prepara a ordem determinística de atualização de contas (`accountId ASC`). |
| **18** | [`value-objects/BaseUnits.ts`](file:///home/sandro/Área de trabalho/BackEnd/src/domains/finance/value-objects/BaseUnits.ts) | Unidades atômicas inteiras e direção contábil (`DEBIT`/`CREDIT`). | Representação estrita de grandezas atômicas sem decimais flutuantes. |
| **19** | [`value-objects/FinancialTransactionStatus.ts`](file:///home/sandro/Área de trabalho/BackEnd/src/domains/finance/value-objects/FinancialTransactionStatus.ts) | Enum e tipos literais de status de transações. | Fechamento de estados válidos (`pending`, `processing`, `completed`, etc.). |
| **20** | [`value-objects/Money256.ts`](file:///home/sandro/Área de trabalho/BackEnd/src/domains/finance/value-objects/Money256.ts) | Value Object imutável de precisão arbitrária de 256 bits (`BigInt`). | Imune a estouros de precisão decimal ou arredondamentos IEEE-754. |

---

### Camada 2: Aplicação, Portas e Casos de Uso (`src/application/finance/` e portas) — 15 Arquivos

| # | Arquivo | Responsabilidade Arquitetural | Invariante / Garantia de Segurança |
| :---: | :--- | :--- | :--- |
| **21** | [`ports/output/IFinanceRepository.ts`](file:///home/sandro/Área de trabalho/BackEnd/src/application/ports/output/IFinanceRepository.ts) | Porta de persistência de leitura contábil e idempotência. | Contrato desacoplado da tecnologia de banco de dados física. |
| **22** | [`ports/output/IPostingExecutor.ts`](file:///home/sandro/Área de trabalho/BackEnd/src/application/ports/output/IPostingExecutor.ts) | Porta que define a execução física do `PostingPlan`. | Exige compulsoriamente a entrega de uma `PostingSession` válida. |
| **23** | [`ports/output/IUnitOfWork.ts`](file:///home/sandro/Área de trabalho/BackEnd/src/application/ports/output/IUnitOfWork.ts) | Porta de fronteira transacional e fábrica de repositórios. | Emite a sessão autorizada para execução do lote contábil. |
| **24** | [`finance/errors/FinancialErrorMapper.ts`](file:///home/sandro/Área de trabalho/BackEnd/src/application/finance/errors/FinancialErrorMapper.ts) | Tradutor de erros de domínio em códigos HTTP. | Isola o domínio do protocolo web (400, 403, 404, 409, 422). |
| **25** | [`finance/services/CanonicalRequestHashService.ts`](file:///home/sandro/Área de trabalho/BackEnd/src/application/finance/services/CanonicalRequestHashService.ts) | Cálculo canônico determinístico de hash SHA-256. | Impede ataques de adulteração e falsificação de idempotência. |
| **26** | [`finance/services/FinancialTransactionOrchestrator.ts`](file:///home/sandro/Área de trabalho/BackEnd/src/application/finance/services/FinancialTransactionOrchestrator.ts) | Orquestrador de concorrência, pré-validação e lock contábil. | Ordena contas deterministicamente e impõe OCC atômico. |
| **27** | [`finance/services/PostingAuthority.ts`](file:///home/sandro/Área de trabalho/BackEnd/src/application/finance/services/PostingAuthority.ts) | Ponto único e soberano de despacho contábil. | Não permite mutação contábil fora do par `(PostingPlan, PostingSession)`. |
| **28** | [`finance/use-cases/GetConsolidatedFinancialReportUseCase.ts`](file:///home/sandro/Área de trabalho/BackEnd/src/application/finance/use-cases/GetConsolidatedFinancialReportUseCase.ts) | Emissão de balancete patrimonial consolidado. | Projeta e audita saldos totais de todas as classes contábeis. |
| **29** | [`finance/use-cases/GetExternalTransactionsUseCase.ts`](file:///home/sandro/Área de trabalho/BackEnd/src/application/finance/use-cases/GetExternalTransactionsUseCase.ts) | Consulta paginada de lançamentos bancários importados. | Suporta filtragem por reconciliação e proteção de payload bruto. |
| **30** | [`finance/use-cases/GetTreasuryBalanceUseCase.ts`](file:///home/sandro/Área de trabalho/BackEnd/src/application/finance/use-cases/GetTreasuryBalanceUseCase.ts) | Consulta do saldo da conta-mestre de tesouraria do sistema. | Consulta atômica do saldo disponível sem locks desnecessários. |
| **31** | [`finance/use-cases/RecordDepositUseCase.ts`](file:///home/sandro/Área de trabalho/BackEnd/src/application/finance/use-cases/RecordDepositUseCase.ts) | Registro de depósitos e integralização de saldos de usuários. | Credita usuário debitando a conta de clearing/bancária correspondente. |
| **32** | [`finance/use-cases/RecordLedgerTransactionUseCase.ts`](file:///home/sandro/Área de trabalho/BackEnd/src/application/finance/use-cases/RecordLedgerTransactionUseCase.ts) | Registro genérico de transações multi-pernas no razão. | Validação estrita de matriz contábil antes da submissão. |
| **33** | [`finance/use-cases/RecordTransferUseCase.ts`](file:///home/sandro/Área de trabalho/BackEnd/src/application/finance/use-cases/RecordTransferUseCase.ts) | Transferência entre contas de usuários. | Exige aprovação de custódia (`CustodyAuthorizationPolicy`). |
| **34** | [`finance/use-cases/RecordTreasuryTransactionUseCase.ts`](file:///home/sandro/Área de trabalho/BackEnd/src/application/finance/use-cases/RecordTreasuryTransactionUseCase.ts) | Mutações diretas na tesouraria (aportes, despesas, taxas). | Validação do hash canônico e controle contra *overdraft*. |
| **35** | [`finance/use-cases/ReverseTransactionUseCase.ts`](file:///home/sandro/Área de trabalho/BackEnd/src/application/finance/use-cases/ReverseTransactionUseCase.ts) | Estorno de transações prévias aprovadas. | Gera pernas contábeis inversas com rastreabilidade forense (`reversed_at`). |

---

### Camada 3: Infraestrutura Concreta, Adaptadores e Repositórios (`src/infrastructure/`) — 5 Arquivos

| # | Arquivo | Responsabilidade Arquitetural | Invariante / Garantia de Segurança |
| :---: | :--- | :--- | :--- |
| **36** | [`repositories/DrizzleUnitOfWork.ts`](file:///home/sandro/Área de trabalho/BackEnd/src/infrastructure/repositories/DrizzleUnitOfWork.ts) | Fábrica transacional Drizzle, emissor da `PostingSession` e portador único do token. | Detém exclusivamente o `PostingCapabilityToken`; impede forja de sessões contábeis. |
| **37** | [`repositories/DrizzleFinanceRepository.ts`](file:///home/sandro/Área de trabalho/BackEnd/src/infrastructure/repositories/DrizzleFinanceRepository.ts) | Adaptador concreto do repositório financeiro sobre Drizzle ORM. | Executa queries seguras no D1 e gerencia leases de idempotência com TTL. |
| **38** | [`services/D1AtomicPostingExecutor.ts`](file:///home/sandro/Área de trabalho/BackEnd/src/infrastructure/services/D1AtomicPostingExecutor.ts) | Executor físico atômico do `PostingPlan` via `db.batch()`. | Agrupa INSERTs e UPDATEs com guardas SQL `_sql_assertions` (`changes() = 1`). |
| **39** | [`services/FinanceBootstrapService.ts`](file:///home/sandro/Área de trabalho/BackEnd/src/infrastructure/services/FinanceBootstrapService.ts) | Inicializador idempotente do plano de contas e tesouraria. | Garante existência singleton da conta de tesouraria e ativos semente. |
| **40** | [`services/FinancialHistoricalImportService.ts`](file:///home/sandro/Área de trabalho/BackEnd/src/infrastructure/services/FinancialHistoricalImportService.ts) | Pipeline de importação de extratos (Bradesco, Cora, Caixa, Inter). | Gera fingerprint SHA-256 por linha importada para evitar duplicatas. |

> *Nota de Serviços Complementares de Mensageria e Reparo:*  
> Além dos 5 arquivos centrais da Camada 3, o subsistema integra [`services/EventInboxService.ts`](file:///home/sandro/Área de trabalho/BackEnd/src/infrastructure/services/EventInboxService.ts) (deduplicação de eventos at-least-once), [`repositories/DrizzleOutboxRepository.ts`](file:///home/sandro/Área de trabalho/BackEnd/src/infrastructure/repositories/DrizzleOutboxRepository.ts) (despacho assíncrono de outbox) e o caso de uso de manutenção preventiva [`use-cases/RepairFinanceUseCase.ts`](file:///home/sandro/Área de trabalho/BackEnd/src/application/finance/use-cases/RepairFinanceUseCase.ts).

---

### Camada 4: Banco de Dados Relacional (`src/db/finance/` e seed) — 3 Arquivos

| # | Arquivo | Responsabilidade Arquitetural | Invariante / Garantia de Segurança |
| :---: | :--- | :--- | :--- |
| **41** | [`finance/tables.ts`](file:///home/sandro/Área de trabalho/BackEnd/src/db/finance/tables.ts) | Definição das tabelas físicas do razão contábil e asserções. | Valores em `TEXT`, constraints de check, foreign keys e índices determinísticos. |
| **42** | [`finance/relations.ts`](file:///home/sandro/Área de trabalho/BackEnd/src/db/finance/relations.ts) | Definição dos relacionamentos estruturais do Drizzle. | Integridade referencial entre contas, lançamentos, transações e saldos. |
| **43** | [`seed_treasury_report.sql`](file:///home/sandro/Área de trabalho/BackEnd/src/db/finance/seed_treasury_report.sql) | Script de seed para relatórios e calibração contábil. | Carga de homologação com balanceamento rigoroso pré-validado. |

---

### Camada 5: Apresentação HTTP (`src/interfaces/http/`) — 2 Arquivos

| # | Arquivo | Responsabilidade Arquitetural | Invariante / Garantia de Segurança |
| :---: | :--- | :--- | :--- |
| **44** | [`controllers/finance/FinanceController.ts`](file:///home/sandro/Área de trabalho/BackEnd/src/interfaces/http/controllers/finance/FinanceController.ts) | Controlador HTTP do módulo financeiro. | Parse estrito de Safe Integer, extração do ator da sessão e mapa de erros. |
| **45** | [`routes/finance/finance.routes.ts`](file:///home/sandro/Área de trabalho/BackEnd/src/interfaces/http/routes/finance/finance.routes.ts) | Roteador REST (Hono) do subsistema. | sessionGuard obrigatório, requireAal(2, 15) e permissões granulares por rota. |

---

### Camada 6: Migrações Relacionais Contábeis (`migrations/`) — 4 Arquivos

| # | Arquivo | Responsabilidade Arquitetural | Invariante / Garantia de Segurança |
| :---: | :--- | :--- | :--- |
| **46** | [`0009_finance_schema_alignment.sql`](file:///home/sandro/Área de trabalho/BackEnd/migrations/0009_finance_schema_alignment.sql) | Alinhamento estrutural inicial das tabelas contábeis. | Criação das tabelas do livro-razão e saldos materializados. |
| **47** | [`0010_finance_fixes_and_rates_alignment.sql`](file:///home/sandro/Área de trabalho/BackEnd/migrations/0010_finance_fixes_and_rates_alignment.sql) | Ajuste fino de tipos, índices e precisão de taxas financeiras. | Índices compostos de concorrência e busca rápida de transações. |
| **48** | [`0011_treasury_singleton_and_forensic_audit.sql`](file:///home/sandro/Área de trabalho/BackEnd/migrations/0011_treasury_singleton_and_forensic_audit.sql) | Garantia de singleton de tesouraria e triggers forenses. | Impede criação de uma segunda conta de tesouraria no sistema. |
| **49** | [`0012_finance_p0_hardening.sql`](file:///home/sandro/Área de trabalho/BackEnd/migrations/0012_finance_p0_hardening.sql) | Endurecimento P0: ordinais contíguos e tabela `_sql_assertions`. | Unique constraint em `(transaction_id, entry_ordinal)` e tabela de guarda `_sql_assertions`. |

---

### Camada 7: Suíte de Testes Automatizados e Invariantes (`tests/finance/` e arquitetura) — 27 Arquivos

| # | Arquivo | Responsabilidade Arquitetural | Invariante / Garantia de Segurança |
| :---: | :--- | :--- | :--- |
| **50** | [`tests/architecture/finance_posting_authority.test.ts`](file:///home/sandro/Área de trabalho/BackEnd/tests/architecture/finance_posting_authority.test.ts) | Teste arquitetural de barreira de postagem. | Garante que nenhuma classe fora de `PostingAuthority` comita no ledger. |
| **51** | [`tests/finance/adversarial_certification.test.ts`](file:///home/sandro/Área de trabalho/BackEnd/tests/finance/adversarial_certification.test.ts) | Teste de certificação contra ataques adversariais. | Ataques de re-entrância, falsificação de tokens e colisão concorrente. |
| **52** | [`tests/finance/audit_gaps_hardening.test.ts`](file:///home/sandro/Área de trabalho/BackEnd/tests/finance/audit_gaps_hardening.test.ts) | Hardening de auditoria e trilhas forenses. | Verificação de integridade entre eventos outbox e registros físicos. |
| **53** | [`tests/finance/bootstrap_atomicity.test.ts`](file:///home/sandro/Área de trabalho/BackEnd/tests/finance/bootstrap_atomicity.test.ts) | Teste de atomicidade do bootstrap contábil. | Rollback integral caso qualquer conta sistêmica falhe na inicialização. |
| **54** | [`tests/finance/bootstrap_service.test.ts`](file:///home/sandro/Área de trabalho/BackEnd/tests/finance/bootstrap_service.test.ts) | Testes unitários do serviço de inicialização. | Confere idempotência na execução repetida de seeds de contas. |
| **55** | [`tests/finance/concurrency_idempotency_same_key.test.ts`](file:///home/sandro/Área de trabalho/BackEnd/tests/finance/concurrency_idempotency_same_key.test.ts) | Teste de colisão com mesma chave de idempotência. | Exatamente 1 request é processado; concorrentes recebem 409 ou replay 200. |
| **56** | [`tests/finance/concurrency_stress.test.ts`](file:///home/sandro/Área de trabalho/BackEnd/tests/finance/concurrency_stress.test.ts) | Teste de estresse com transações simultâneas de alta frequência. | Verifica que nenhum saldo fica corrompido sob corrida concorrente. |
| **57** | [`tests/finance/domain_freeze_hardening.test.ts`](file:///home/sandro/Área de trabalho/BackEnd/tests/finance/domain_freeze_hardening.test.ts) | Teste de congelamento e imutabilidade de regras. | Impede regressões acidentais em políticas contábeis inegociáveis. |
| **58** | [`tests/finance/domain_policies.test.ts`](file:///home/sandro/Área de trabalho/BackEnd/tests/finance/domain_policies.test.ts) | Validação unitária de todas as policies contábeis. | Testa validações de texto, classes de conta e status operacionais. |
| **59** | [`tests/finance/DrizzleFinanceRepository.test.ts`](file:///home/sandro/Área de trabalho/BackEnd/tests/finance/DrizzleFinanceRepository.test.ts) | Testes de integração do repositório Drizzle sobre SQLite. | Confere comportamento das queries e mapeamento de campos físicos. |
| **60** | [`tests/finance/event_inbox.test.ts`](file:///home/sandro/Área de trabalho/BackEnd/tests/finance/event_inbox.test.ts) | Teste do inbox de eventos financeiros assíncronos. | Garante entrega *at-least-once* com deduplicação rigorosa de eventos. |
| **61** | [`tests/finance/evm_precision.test.ts`](file:///home/sandro/Área de trabalho/BackEnd/tests/finance/evm_precision.test.ts) | Compatibilidade matemática com EVM (uint256). | Garante precisão decimal idêntica à de contratos inteligentes Solidity (18 casas). |
| **62** | [`tests/finance/failure_injection.test.ts`](file:///home/sandro/Área de trabalho/BackEnd/tests/finance/failure_injection.test.ts) | Injeção de falhas deliberadas e simulação de pane de disco. | Verifica se o sistema mantém consistência ACID mesmo com falha no commit. |
| **63** | [`tests/finance/finance_controller_e2e.test.ts`](file:///home/sandro/Área de trabalho/BackEnd/tests/finance/finance_controller_e2e.test.ts) | Testes ponta a ponta da camada de apresentação HTTP. | Testa contratos de resposta (201, 200 replay, 400, 403, 409, 500). |
| **64** | [`tests/finance/finance_real_db_e2e.test.ts`](file:///home/sandro/Área de trabalho/BackEnd/tests/finance/finance_real_db_e2e.test.ts) | Teste E2E contra banco D1 real local. | Executa o ciclo de vida completo de depósitos, saques e transferências. |
| **65** | [`tests/finance/FinancialTransaction.test.ts`](file:///home/sandro/Área de trabalho/BackEnd/tests/finance/FinancialTransaction.test.ts) | Testes unitários do Aggregate Root LedgerTransaction. | Testa invariantes de balanceamento e transições da State Machine. |
| **66** | [`tests/finance/money256.test.ts`](file:///home/sandro/Área de trabalho/BackEnd/tests/finance/money256.test.ts) | Testes matemáticos exaustivos do Money256. | Testes de adição, subtração, overflow em $2^{256}-1$ e underflow negativo. |
| **67** | [`tests/finance/phase4_hardening.test.ts`](file:///home/sandro/Área de trabalho/BackEnd/tests/finance/phase4_hardening.test.ts) | Endurecimento da fase 4 de auditoria. | Validação das trilhas forenses de estorno e auditoria de reconciliação. |
| **68** | [`tests/finance/posting_authority_hardening.test.ts`](file:///home/sandro/Área de trabalho/BackEnd/tests/finance/posting_authority_hardening.test.ts) | Teste estrito da barreira de capacidade PostingAuthority. | Garante que requisições sem PostingSession sejam bloqueadas no ato. |
| **69** | [`tests/finance/reconciliation_3way.test.ts`](file:///home/sandro/Área de trabalho/BackEnd/tests/finance/reconciliation_3way.test.ts) | Reconciliação tripla (banco, provedor e livro-razão). | Confere detecção de discrepâncias entre extratos reais e saldos do razão. |
| **70** | [`tests/finance/reverse_transaction.test.ts`](file:///home/sandro/Área de trabalho/BackEnd/tests/finance/reverse_transaction.test.ts) | Testes de estorno e cancelamento de transações. | Valida se a reversão gera débitos/créditos espelhados perfeitos. |
| **71** | [`tests/finance/schema_drift.test.ts`](file:///home/sandro/Área de trabalho/BackEnd/tests/finance/schema_drift.test.ts) | Prevenção e detecção de deriva estrutural de esquema. | Compara o schema Drizzle TypeScript com as tabelas físicas do banco. |
| **72** | [`tests/finance/schema_invariants_audit.test.ts`](file:///home/sandro/Área de trabalho/BackEnd/tests/finance/schema_invariants_audit.test.ts) | Auditoria de integridade do schema relacional. | Verifica índices únicos obrigatórios e integridade referencial física. |
| **73** | [`tests/finance/invariants/balance_projection.test.ts`](file:///home/sandro/Área de trabalho/BackEnd/tests/finance/invariants/balance_projection.test.ts) | Invariante contábil: Projeção de saldo histórico. | Garante que: $\text{Saldo Acumulado} \equiv \sum \text{Lançamentos Históricos}$. |
| **74** | [`tests/finance/invariants/commit_failure.test.ts`](file:///home/sandro/Área de trabalho/BackEnd/tests/finance/invariants/commit_failure.test.ts) | Invariante: Rollback atômico em caso de falha de commit. | Assegura que nenhum saldo ou perna parcial seja persistido em erro. |
| **75** | [`tests/finance/invariants/seeds_normal_balance.test.ts`](file:///home/sandro/Área de trabalho/BackEnd/tests/finance/invariants/seeds_normal_balance.test.ts) | Invariante: Natureza e saldo normal das contas-semente. | Confere conformidade com as normas contábeis internacionais (IFRS). |
| **76** | [`tests/finance/invariants/transaction_failure_matrix.test.ts`](file:///home/sandro/Área de trabalho/BackEnd/tests/finance/invariants/transaction_failure_matrix.test.ts) | Matriz abrangente de cenários de falha. | Simula todas as permutações de falhas de saldo, autorização e formato. |

> *Nota de Governança Arquitetural Executável:*  
> A pureza estrita das fronteiras do domínio e isolamento de dependências é auditada continuamente por [`tests/architecture/architecture-boundaries.test.ts`](file:///home/sandro/Área de trabalho/BackEnd/tests/architecture/architecture-boundaries.test.ts), [`tests/architecture/dependency_rules.test.ts`](file:///home/sandro/Área de trabalho/BackEnd/tests/architecture/dependency_rules.test.ts) e [`tests/architecture/static_architecture.test.ts`](file:///home/sandro/Área de trabalho/BackEnd/tests/architecture/static_architecture.test.ts).

---

## 6. Checklist Padrão Unificado para Auditoria Contínua (Matriz Expandida v2.6.0)

Ao analisar, refatorar ou auditar qualquer arquivo ou fluxo do subsistema financeiro, verifique obrigatoriamente os seguintes 10 pontos de controle:

```markdown
### MATRIZ DE AUDITORIA FORMAL DO SUBSISTEMA FINANCEIRO (EXPANDIDA v2.6.0)

[ ] CRITÉRIO 1: Pureza & Clean Architecture
    - O Domínio (src/domains/finance) depende APENAS de si mesmo e de tipos primitivos (sem imports de HTTP, Hono, Drizzle ou D1).
    - Erros de negócio herdam de FinancialError e não contêm status codes HTTP.
    - Casos de uso utilizam portas abstratas (IFinanceRepository, IPostingExecutor, IUnitOfWork).

[ ] CRITÉRIO 2: Integridade Numérica & Aritmética no SQLite
    - Nenhum valor financeiro ou saldo utiliza number ou ponto flutuante (float / double).
    - Toda aritmética contábil utiliza Money256 (BigInt em memória no V8 com precisão exata de 256 bits).
    - Valores no banco de dados são persistidos como TEXT (strings numéricas decimais canônicas).
    - Identificadores numéricos passam por Number.isSafeInteger(id) && id > 0 (proteção de 53 bits).

[ ] CRITÉRIO 3: Custódia & Soberania de Autoridade
    - Nenhuma operação de débito é despachada sem validação pela CustodyAuthorizationPolicy.
    - O autor da ação é estritamente derivado da sessão autenticada física (c.get('userId')).
    - Todas as mutações contábeis passam obrigatoriamente pela PostingAuthority usando PostingSession válida.
    - É proibido qualquer bypass direto para repositórios mutáveis ou UPDATEs manuais de saldo.

[ ] CRITÉRIO 4: Idempotência Canônica & Gestão de Leases Órfãos
    - Toda rota de mutação exige header Idempotency-Key.
    - O hash de integridade (requestHash) é soberanamente calculado pelo servidor via CanonicalRequestHashService.
    - Chaves reutilizadas com o mesmo payload retornam replay determinístico (HTTP 200, isReplayed: true, payload salvo).
    - Chaves reutilizadas com payload divergente são rejeitadas imediatamente (HTTP 409 Conflict).
    - Leases de idempotência possuem TTL (expires_at) para evitar bloqueio definitivo em caso de falha transitória do worker.

[ ] CRITÉRIO 5: Filosofia Fail-Closed & Asserções Físicas D1
    - Ausência de credencial, expiração de sessão ou erro de permissão bloqueia imediatamente (401 / 403).
    - Execuções de lote físico ocorrem dentro de d1.batch() com guardas na tabela _sql_assertions.
    - O mecanismo changes() = 1 aborta o batch se a versão OCC do saldo divergir ou se a conta estiver inativa.
    - Em caso de falha de qualquer perna contábil, nenhuma mutação de saldo ou lançamento é persistido (Rollback Total).

[ ] CRITÉRIO 6: Imutabilidade do Livro-Razão & Padrão Append-Only
    - A tabela financial_ledger_entries é estritamente append-only (proibido UPDATE ou DELETE).
    - Toda transação possui ordinais contíguos de pernas (entry_ordinal 1, 2, ...) protegidos por unique constraint (transaction_id, entry_ordinal).
    - Estornos geram novas pernas contábeis de contrapartida em transação separada vinculada (reversed_at), sem sobrescrever dados históricos.

[ ] CRITÉRIO 7: Ordenação Determinística e Prevenção de Deadlocks
    - Todas as mutações de saldo no PostingPlanBuilder são ordenadas deterministicamente por accountId ASC.
    - Impede contenção cruzada e impasses de trava entre transações concorrentes simultâneas.

[ ] CRITÉRIO 8: Transactional Outbox Pattern & Entrega de Eventos
    - Cada transação contábil grava simultaneamente um registro em outbox_events no mesmo d1.batch().
    - O processador assíncrono opera com garantia de entrega at-least-once e deduplicação via EventInboxService.

[ ] CRITÉRIO 9: Proteção contra Contas Quentes (Hot Accounts) & Thundering Herd
    - Operações de alta concorrência sobre contas centralizadoras (ex: tesouraria) tratam OptimisticConcurrencyError com backoff exponencial e jitter determinístico.
    - Rate limiting em nível de rota e de usuário antes da camada de orquestração.

[ ] CRITÉRIO 10: Reconciliação Contínua & Auditoria Forense
    - Invariante formal auditável: account_balances.available_base_units == sum(financial_ledger_entries.amount_base_units).
    - Existência de rotina de verificação para detecção periódica de deriva de integridade contábil.
```

---

## 7. Histórico e Status de Auditoria dos Gates & Rubrica de Avaliação

A tabela a seguir consolida o histórico de auditoria por lotes, os itens críticos avaliados e os critérios objetivos necessários para a certificação do Gate 0.

| Gate / Lote | Foco da Auditoria | Nota | Status | Itens Críticos Avaliados | Requisitos para Aprovação Definitiva (DoD) |
| :--- | :--- | :---: | :---: | :--- | :--- |
| **G0 — Auditoria Inicial** | Fronteira HTTP, autenticação, injeção e isolamento | 6,1 / 10 | 🔴 Não Aprovado | Falha no isolamento de rotas, dependência de tipos primitivos sem safe integer, falta de barreira de postagem. | Superado com a introdução do `sessionGuard`, `requireAal(2, 15)` e DTOs tipados. |
| **G0 — Reauditoria Lote 1 (v2.5.0)** | Endurecimento de rota, safe integer, context RBAC | 7,4 / 10 | 🟠 Condicional | Validação de identificadores de 53 bits, injeção de `userId` pelo contexto físico de sessão, isolamento de repositórios. | Pendente de resolução: contenção OCC sob concorrência e guarda de asserção de lote. |
| **G0 — Lote 2 (Em Andamento)** | Contratos, portas, custódia, `PostingAuthority` e `_sql_assertions` | *Em Análise* | ⏳ Em Análise | Imutabilidade do `PostingPlan`, não-forjabilidade do `PostingCapabilityToken`, prova física de falha em `_sql_assertions`. | 100% dos testes de `adversarial_certification.test.ts` e `posting_authority_hardening.test.ts` aprovados. |
| **G0 — Lote 3 (A Seguir)** | Casos de uso (`RecordTreasury`, `RecordTransfer`, Orchestrator) | *Pendente* | ⏳ Na Fila | Orquestração com deadlock avoidance (`accountId ASC`), replay de idempotência com payload completo e estorno forense. | Validação E2E com banco D1 real local (`finance_real_db_e2e.test.ts`) sem drift contábil. |

### Critérios de Pontuação e Definition of Done (DoD) do Gate 0:
* **Nota 9,0+ (Aprovação Definitiva P0 Hardened):**
  1. Todos os 76 arquivos conformes com a Matriz de 10 Critérios de Auditoria.
  2. Zero violações nos testes de fronteira estática (`architecture-boundaries.test.ts`).
  3. Prova executável de rollback integral do lote `d1.batch()` perante falha forçada de OCC em `_sql_assertions`.
  4. Nenhuma mutação de saldo realizada fora do par `(PostingPlan, PostingSession)`.
