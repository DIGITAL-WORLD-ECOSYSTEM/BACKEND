# Arquitetura do Backend: Ecossistema DDD

Analisando a arquitetura do sistema (diretórios `src/domains`, `src/interfaces/http/routes` e `src/db`), o backend é um ecossistema robusto baseado em Domain-Driven Design (DDD).

Ele está dividido em 4 Grandes Módulos de Domínio (Business Domains), e sustentado por 11 Contextos de Banco de Dados (Bounded Contexts de Persistência).

Aqui está o mapeamento completo do projeto:

## 🏢 1. Módulos de Domínio Core (Lógica de Negócio Principal)
Esses são os 4 pilares do sistema que possuem casos de uso, entidades e rotas HTTP ativas (`src/domains` e `src/interfaces/http/routes/`):

*   **Identity (IAM - Identity & Access Management):**
    Gere o ciclo de vida do usuário (User), sessões (Session), MFA (Totp), Passkeys, Web3 Wallets, recuperação de senhas e JWTs.
*   **Civil Identity (Identidade Civil e KYC):**
    Responsável pelos perfis cidadãos reais, processos de KYC, verificação de documentos e onboarding legal.
*   **SSI (Self-Sovereign Identity):**
    Módulo Web3 focado em Identidade Descentralizada: criação de DIDs (Decentralized Identifiers) e Verifiable Credentials (VCs).
*   **Finance (Tesouraria e Financeiro):**
    Módulo para gestão da tesouraria do DAO, transações, relatórios de fluxo de caixa e saldos on-chain/off-chain.

*(Há também um módulo de rotas `core` que geralmente concentra health-checks e webhooks de infraestrutura).*

## 💾 2. Contextos de Banco de Dados (D1 / Drizzle)
Na camada de persistência (`src/db/`), há uma separação e fragmentação arquitetural dividida em 11 Sub-módulos independentes:

*   **`user/`**: Tabela principal de atores do sistema.
*   **`authentication/`**: Gerencia senhas em hash, sessões de usuário, TOTP (2FA), senhas de reset e revogações.
*   **`authorization/`**: Onde vive a matriz de RBAC (Role-Based Access Control), definindo papéis e permissões no DAO.
*   **`civil-identity/`**: Perfis KYC e status de auditoria civil.
*   **`compliance/`**: Logs voltados para conformidade regulatória (AML).
*   **`finance/`**: Transações, fundos da tesouraria e balanços.
*   **`ssi/`**: DIDs registradas e estado das credenciais verificáveis emitidas.
*   **`web3/`**: Endereços de carteiras EVM vinculadas aos usuários e integração blockchain.
*   **`security/`**: Registro imutável de logs de segurança (audit trail) onde o `ISecurityAuditPort` grava seus eventos.
*   **`integrations/`**: Rastreio de integrações externas (provedores de API).
*   **`infrastructure/`**: Tabelas de suporte, como a tabela do padrão Outbox (mensageria de eventos).

---

## 🌳 Espinha Dorsal do Sistema: Mapeamento da Árvore de Diretórios

Esta é a árvore completa e atualizada das camadas de Domínio (`src/domains`), Aplicação (`src/application/use-cases`), Rotas (`src/interfaces/http/routes`) e Persistência (`src/db`), representando a expressão máxima do ecossistema e seu rastreamento.

```text
src/domains
├── civil-identity
│   └── use-cases
│       ├── RegisterCitizenUseCase.ts
│       └── SubmitKycVerificationUseCase.ts
├── finance
│   └── use-cases
│       ├── GetTreasuryBalanceUseCase.ts
│       └── RecordTreasuryTransactionUseCase.ts
├── identity
│   ├── entities
│   │   ├── Session.ts
│   │   └── User.ts
│   ├── errors
│   │   ├── AntiLockoutViolationError.ts
│   │   └── IdentityNotLinkedError.ts
│   ├── services
│   │   └── CanonicalIdentityResolver.ts
│   └── use-cases (Movidos para src/application/use-cases)
├── phase3_modules.test.ts
└── ssi
    └── use-cases
        ├── CreateDidUseCase.ts
        ├── IssueVerifiableCredentialUseCase.ts
        └── RevokeCredentialUseCase.ts

src/application/use-cases
└── identity
    ├── AuthenticateAccountUseCase.test.ts
    ├── AuthenticateAccountUseCase.ts
    ├── AuthenticateTotpUseCase.ts
    ├── auxiliary_auth.test.ts
    ├── ConfirmPasswordResetUseCase.ts
    ├── LinkExternalIdentityUseCase.ts
    ├── RefreshTokenUseCase.ts
    ├── RegisterAccountUseCase.ts
    ├── RequestPasswordResetUseCase.ts
    ├── SetupTotpUseCase.ts
    ├── UnlinkExternalIdentityUseCase.ts
    ├── VerifyPasskeyIdentityUseCase.ts
    └── VerifyWalletIdentityUseCase.ts

src/interfaces/http/routes
├── civil-identity
│   └── civil_identity.routes.ts
├── core
│   ├── compliance.test.ts
│   ├── compliance.ts
│   ├── health.test.ts
│   ├── health.ts
│   └── webhooks.ts
├── finance
│   └── finance.routes.ts
├── identity
│   └── identity.routes.ts
└── ssi
    └── ssi.routes.ts

src/db
├── authentication
│   ├── relations.ts
│   └── tables.ts
├── authorization
│   ├── relations.ts
│   └── tables.ts
├── civil-identity
│   ├── relations.ts
│   └── tables.ts
├── compliance
│   ├── relations.ts
│   └── tables.ts
├── constants.ts
├── finance
│   ├── relations.ts
│   └── tables.ts
├── index.ts
├── infrastructure
│   ├── relations.ts
│   └── tables.ts
├── integrations
│   ├── relations.ts
│   └── tables.ts
├── migrations
│   ├── 0002_add_domain_columns.up.sql
│   └── 0003_reconcile_account_10_balance.sql
├── schema.ts
├── security
│   ├── relations.ts
│   └── tables.ts
├── seed.sql
├── seed_treasury_report.sql
├── ssi
│   ├── relations.ts
│   └── tables.ts
├── user
│   ├── relations.ts
│   └── tables.ts
└── web3
    ├── relations.ts
    └── tables.ts
```
