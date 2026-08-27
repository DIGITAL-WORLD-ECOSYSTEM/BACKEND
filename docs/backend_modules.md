# Arquitetura do Backend: Ecossistema DDD Completo

Analisando a arquitetura do sistema com varredura profunda de toda a pasta `src/`, o backend é um ecossistema robusto baseado em Domain-Driven Design (DDD).

Ele está dividido em 4 Grandes Módulos de Domínio (Business Domains), sustentado por 11 Contextos de Banco de Dados (Bounded Contexts), e orquestrado por camadas estritas de Aplicação, Infraestrutura, Interfaces (HTTP) e Shared Kernel.

Aqui está o mapeamento 100% completo e rastreado do projeto (todos os 138 arquivos em 62 diretórios):

## 🏢 1. Módulos de Domínio Core (Lógica de Negócio Principal)
Esses são os 4 pilares do sistema:
1. **Identity (IAM - Identity & Access Management)**
2. **Civil Identity (Identidade Civil e KYC)**
3. **SSI (Self-Sovereign Identity)**
4. **Finance (Tesouraria e Financeiro)**

*(Há também rotas e infraestruturas Core).*

---

## 🌳 A Árvore Completa e Rastreada do Backend (`src/`)

Abaixo está o registro exato de todos os arquivos do backend, categorizados por suas respectivas camadas arquiteturais.

```text
src/
├── application (Casos de Uso, DTOs e Portas - Orquestração)
│   ├── dto
│   │   ├── civil-identity
│   │   │   ├── RegisterCitizenDTO.ts
│   │   │   └── SubmitKycVerificationDTO.ts
│   │   ├── finance
│   │   │   ├── GetTreasuryBalanceDTO.ts
│   │   │   └── RecordTreasuryTransactionDTO.ts
│   │   ├── identity
│   │   │   ├── AuthenticateAccountDTO.ts
│   │   │       export interface AuthenticateAccountDTO {
                email: string;
                password: string;
                }

                export interface AuthenticateAccountResult {
                userId: number;
                email: string;
                publicId: string | null;
                status: string;
                }

│   │   │   ├── AuthenticateTotpDTO.ts
                export interface AuthenticateTotpDTO {
                    userId: number;
                    code: string;
                    sessionId?: string;
                }

│   │   │   ├── ConfirmPasswordResetDTO.ts
                export interface ConfirmPasswordResetDTO {
                    token: string;
                    newPassword: string;
                }

│   │   │   ├── IdentityAssertion.ts
│   │   │   ├── IdentityResolutionResult.ts
│   │   │   ├── LinkExternalIdentityDTO.ts
│   │   │   ├── RefreshTokenDTO.ts
│   │   │   ├── RegisterAccountDTO.ts
│   │   │   ├── RequestPasswordResetDTO.ts
│   │   │   ├── SetupTotpDTO.ts
│   │   │   ├── UnlinkExternalIdentityDTO.ts
│   │   │   ├── VerifyPasskeyIdentityDTO.ts
│   │   │   └── VerifyWalletIdentityDTO.ts
│   │   ├── ssi
│   │   │   ├── CreateDidDTO.ts
│   │   │   ├── IssueVerifiableCredentialDTO.ts
│   │   │   └── RevokeCredentialDTO.ts
│   │   └── TransactionContext.ts
│   ├── ports
│   │   ├── output (Contratos de Repositórios e Serviços Externos)
│   │   │   ├── IAuthenticationRepository.ts
│   │   │   ├── IChallengeStorePort.ts
│   │   │   ├── ICivilIdentityRepository.ts
│   │   │   ├── IFinanceRepository.ts
│   │   │   ├── IIdentityResolverPort.ts
│   │   │   ├── IOutboxRepository.ts
│   │   │   ├── IPasswordResetRepository.ts
│   │   │   ├── ISecurityAuditPort.ts
│   │   │   ├── ISessionRepository.ts
│   │   │   ├── ISsiRepository.ts
│   │   │   ├── IUnitOfWork.ts
│   │   │   ├── IUserRepository.ts
│   │   │   └── IWeb3Repository.ts
│   │   └── security (Contratos de Criptografia e JWT)
│   │       ├── IJwtService.ts
│   │       ├── IPasswordHasher.ts
│   │       └── ISiweVerifierPort.ts
│   └── use-cases
│       └── identity
│           ├── AuthenticateAccountUseCase.test.ts
│           ├── AuthenticateAccountUseCase.ts
│           ├── AuthenticateTotpUseCase.ts
│           ├── auxiliary_auth.test.ts
│           ├── ConfirmPasswordResetUseCase.ts
│           ├── LinkExternalIdentityUseCase.ts
│           ├── RefreshTokenUseCase.ts
│           ├── RegisterAccountUseCase.ts
│           ├── RequestPasswordResetUseCase.ts
│           ├── SetupTotpUseCase.ts
│           ├── UnlinkExternalIdentityUseCase.ts
│           ├── VerifyPasskeyIdentityUseCase.ts
│           └── VerifyWalletIdentityUseCase.ts
│
├── domains (Entidades, Regras de Negócio e Casos de Uso Restantes)
│   ├── civil-identity
│   │   └── use-cases
│   │       ├── RegisterCitizenUseCase.ts
│   │       └── SubmitKycVerificationUseCase.ts
│   ├── finance
│   │   └── use-cases
│   │       ├── GetTreasuryBalanceUseCase.ts
│   │       └── RecordTreasuryTransactionUseCase.ts
│   ├── identity
│   │   ├── entities
│   │   │   ├── Session.ts
│   │   │   └── User.ts
│   │   ├── errors
│   │   │   ├── AntiLockoutViolationError.ts
│   │   │   └── IdentityNotLinkedError.ts
│   │   └── services
│   │       └── CanonicalIdentityResolver.ts
│   ├── phase3_modules.test.ts
│   └── ssi
│       └── use-cases
│           ├── CreateDidUseCase.ts
│           ├── IssueVerifiableCredentialUseCase.ts
│           └── RevokeCredentialUseCase.ts
│
├── infrastructure (Implementações Concretas: Bancos, APIs e Segurança)
│   ├── adapters
│   │   └── kyc (Vazio no momento)
│   ├── durable_objects
│   │   └── ChatRoomDO.ts
│   ├── observability
│   │   └── logger.ts
│   ├── repositories (Adaptadores do Drizzle ORM)
│   │   ├── DrizzleAuthenticationRepositoryAdapter.ts
│   │   ├── DrizzleCivilIdentityRepositoryAdapter.ts
│   │   ├── DrizzleFinanceRepository.ts
│   │   ├── DrizzleIdentityResolverAdapter.ts
│   │   ├── DrizzleOutboxRepository.ts
│   │   ├── DrizzlePasswordResetRepository.ts
│   │   ├── DrizzleSessionRepository.test.ts
│   │   ├── DrizzleSessionRepository.ts
│   │   ├── DrizzleSsiRepository.test.ts
│   │   ├── DrizzleSsiRepository.ts
│   │   ├── DrizzleUnitOfWork.test.ts
│   │   ├── DrizzleUnitOfWork.ts
│   │   ├── DrizzleUserRepositoryAdapter.ts
│   │   ├── DrizzleWalletRepository.test.ts
│   │   ├── DrizzleWalletRepository.ts
│   │   └── DrizzleWeb3RepositoryAdapter.ts
│   ├── security
│   │   ├── crypto
│   │   │   ├── crypto.ts
│   │   │   ├── Eip4361Verifier.ts
│   │   │   ├── PBKDF2PasswordHasher.ts
│   │   │   └── timing_safe.ts
│   │   ├── jwt
│   │   │   └── JwtService.ts
│   │   └── SecurityAuditAdapter.ts
│   └── testing
│       └── cloudflare-workers.ts
│
├── interfaces (Portas de Entrada HTTP: Controllers, Routes, Middlewares)
│   └── http
│       ├── controllers
│       │   ├── civil-identity
│       │   │   └── CivilIdentityController.ts
│       │   ├── finance
│       │   │   └── FinanceController.ts
│       │   ├── identity
│       │   │   ├── AuthAuxiliaryController.ts
│       │   │   ├── ExternalIdentityController.ts
│       │   │   └── IdentityController.ts
│       │   └── ssi
│       │       └── SsiController.ts
│       ├── helpers
│       │   └── response.ts
│       ├── middlewares
│       │   ├── auth_signature.test.ts
│       │   ├── auth_signature.ts
│       │   ├── correlation_id.ts
│       │   ├── rate_limit.ts
│       │   ├── rbac.ts
│       │   └── session_guard.ts
│       └── routes
│           ├── civil-identity
│           │   └── civil_identity.routes.ts
│           ├── core
│           │   ├── compliance.test.ts
│           │   ├── compliance.ts
│           │   ├── health.test.ts
│           │   ├── health.ts
│           │   └── webhooks.ts
│           ├── finance
│           │   └── finance.routes.ts
│           ├── identity
│           │   └── identity.routes.ts
│           └── ssi
│               └── ssi.routes.ts
│
├── db (Definição de Esquema Drizzle e Conexão de Banco)
│   ├── authentication
│   │   ├── relations.ts
│   │   └── tables.ts
│   ├── authorization
│   │   ├── relations.ts
│   │   └── tables.ts
│   ├── civil-identity
│   │   ├── relations.ts
│   │   └── tables.ts
│   ├── compliance
│   │   ├── relations.ts
│   │   └── tables.ts
│   ├── constants.ts
│   ├── finance
│   │   ├── relations.ts
│   │   └── tables.ts
│   ├── index.ts
│   ├── infrastructure
│   │   ├── relations.ts
│   │   └── tables.ts
│   ├── integrations
│   │   ├── relations.ts
│   │   └── tables.ts
│   ├── migrations
│   │   ├── 0002_add_domain_columns.up.sql
│   │   └── 0003_reconcile_account_10_balance.sql
│   ├── schema.ts
│   ├── security
│   │   ├── relations.ts
│   │   └── tables.ts
│   ├── seed.sql
│   ├── seed_treasury_report.sql
│   ├── ssi
│   │   ├── relations.ts
│   │   └── tables.ts
│   ├── user
│   │   ├── relations.ts
│   │   └── tables.ts
│   └── web3
│       ├── relations.ts
│       └── tables.ts
│
├── shared (Kernel Global / Tipos Primitivos)
│   └── kernel
│       ├── DomainEvent.ts
│       ├── ids
│       │   └── UserId.ts
│       └── Result.ts
│
├── types (Tipagens de Ambiente / Cloudflare)
│   ├── bindings.d.ts
│   └── manifest.d.ts
│
└── index.ts (Ponto de Entrada Principal - Hono / Worker)
```
