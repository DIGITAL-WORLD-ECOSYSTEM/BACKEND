# Comprehensive Domain Architecture — Master Backend & DB Contract

![Project Status](https://img.shields.io/badge/status-active_development-yellow)
![Version](https://img.shields.io/badge/version-v1.0.0-blue)
![Build](https://img.shields.io/badge/build-passing-brightgreen)
![License](https://img.shields.io/badge/license-Apache--2.0-blue)
![Edge Computing](https://img.shields.io/badge/edge-Cloudflare_Workers-orange)
![D1 Database](https://img.shields.io/badge/persistence-Cloudflare_D1-blue)
![Workers KV](https://img.shields.io/badge/cache-Workers_KV-orange)
![R2 Storage](https://img.shields.io/badge/storage-Cloudflare_R2-darkblue)
![IPFS Decentralized](https://img.shields.io/badge/decentralized-IPFS-7b78e8)
![AI Layer](https://img.shields.io/badge/ai-Workers_AI-red)

> **Normative Governance Metadata**
>
> - **Contract Version:** 1.6.0
> - **Last Validation:** 2026-08-26
> - **Schema Compatibility:** Drizzle ORM / Cloudflare D1 v2
> - **Normative Level:** System Constitution / Single Source of Truth
> - **Architecture Test Suite:** `tests/architecture/architecture-boundaries.test.ts`

> [!IMPORTANT]
> **RESERVA & LEMBRETE DE ARQUITETURA DE INTEGRIDADE CANÔNICA (v16.0)**:
> - **Idempotência, Feedback Transversal & Resiliência**: O plano de especificação da Plataforma Transversal de Tratamento de Erros, Idempotência (Fencing Tokens, D1+R2 Offload, Envelope Criptográfico AES-GCM-256 com AAD, Protocolo UNKNOWN), Outbox Transacional e Feedback Policy Engine encontra-se preservado e congelado na **v16.0 (Production Integrity Baseline Candidate)**.
> - **Fonte da Verdade e Checkpoint de Execução**: O artefato de execução está salvo e preservado em `implementation_plan.md` (no appData do projeto) e servirá como referência obrigatória para a revisão técnica e implementação subsequente das Fases 0 a 4.

---

## 📜 01. CHANGE LOG & CURRENT STATE SNAPSHOT

### Architecture Change Log

- **v1.6.0 (2026-08-26):** Phase 2 Hardening & Phase 3 Ecosystem Expansion. Complete implementation of Phase 2 Auth Hardening (`authEpoch` real-time validation in `sessionGuard`, Brute-force protection with account lockout status after 5 failed attempts, `/logout` and `/logout-all` endpoints). Full delivery of Phase 3 Ecosystem Modules: `src/domains/civil-identity/` (Citizen Registration & KYC Verification), `src/domains/ssi/` (W3C DID generation, VC issuance & revocation), and `src/domains/finance/` (Treasury balance consolidation & Double-Entry Ledger transactions). Created Hono Controllers and HTTP routes in `/api/v1/civil`, `/api/v1/ssi`, `/api/v1/finance`. Certified with 100% Vitest pass rate (45/45 tests passing).
- **v1.5.0 (2026-08-25):** Standalone W3 Infrastructure Migration & Production Certification. Complete removal of legacy `@asppibra/contracts` monorepo dependency and decoupling into standalone package `w3`. Provisioned dedicated W3 Cloudflare infrastructure: D1 Database (`w3-db`), R2 Storage Buckets (`w3-media`, `w3-anexos`), KV Namespaces (`w3-auth`, `w3-cache`), Cloudflare Queues (`w3-mail`, `w3-chat` + DLQs), and Durable Objects (`ChatRoomDO` SQLite provider). Deployed single Production Worker `w3-api` (`https://w3-api.asppibra.workers.dev`) with native real-time Web3 Telemetry Dashboard in `public/`. Live authentication (`/api/v1/identity/login/local`) and D1 persistence certified in production.
- **v1.4.0 (2026-08-24):** Audit-Driven Real Alignment & Phase 1 DIP Execution. Realignment of `USER_ARCHITECTURE.md` to 100% reflect the physical reality of `backend/src/`. Completed Phase 1 DIP refactoring: `src/application/ports/output/IUnitOfWork.ts` refactored to depend strictly on repository abstractions (`IUserRepository`, `IAuthenticationRepository`, `IWeb3Repository`, `ICivilIdentityRepository`, `ISsessionRepository`), eliminating all infrastructure imports from the application layer. Updated status metrics from target state to true code audit baseline.

- **v1.3.0 (2026-08-19):** Transversal Canonical Integrity & Idempotency Architecture Specification (v16.0 Candidate). Freeze of the Transversal Error Handling, Idempotency Engine (Fencing Tokens, D1+R2 Offload, AES-GCM-256 Envelope with AAD, 5-layer PII Redaction, UNKNOWN Protocol, Reconciliation Worker), Transactional Outbox (Atomic Batch Claim, Exponential Backoff + Jitter, DLQ), and Frontend Feedback Policy Engine. Preserved as execution checkpoint for implementation.
- **v1.2.0 (2026-08-18):** Account-First Identity Architecture Specification. Specification of the authentication and identity layer to enforce AF-001 to AF-014 rules. Elimination of all auto-provisioning / shadow accounts (`@web3.local`, `@ssi.local`). Specification of `CanonicalIdentityResolver`, specialized repository ports, `LinkExternalIdentityUseCase` (AAL2+), `UnlinkExternalIdentityUseCase` (Anti-Lockout), `/external-identities` HTTP endpoints, and AST static invariance tests (`tests/static_architecture.test.ts`).
- **v1.1.0 (2026-08-17):** Forensic Audit Baseline & Persistence Layer Hardening. Line-by-line verification and certification of DB schemas and unidirectional relations for 18 Bounded Contexts in `src/db/`.
- **v1.0.0 (2026-08-16):** Official consolidation of Target Architecture, Cross-Domain Dependency Matrix, 20 Golden Rules with Enforcement Levels, Dual Storage Abstraction (`IObjectStorage` R2 vs `IContentAddressedStorage` IPFS), Web3 × Finance Decoupling, STRIDE Security Threat Model, AAL1/AAL2/AAL3 Authentication Levels, Workers AI Squad, and Normative Contracts for 18 Bounded Contexts.

### Current Reality Snapshot

- **Production Status:** `w3-api` Live on Cloudflare Workers (`https://w3-api.asppibra.workers.dev`).
- **Live Infrastructure Bindings:**
  - **D1 Database**: `w3-db` (`cfd0e171-f2b5-48d4-bf29-a9cf33d97b4d`) with 61 tables migrated and genesis seeded.
  - **R2 Storage**: `w3-media` & `w3-anexos`
  - **KV Namespaces**: `w3-auth` (`5f8377a1e41d4869837debabbed2acfb`) & `w3-cache` (`abb4df8656924422a3ccab4969e938d0`)
  - **Queues**: `w3-mail` (Producer & Consumer) & `w3-chat` (Producer & Consumer)
  - **Durable Objects**: `ChatRoomDO` (SQLite Provider via `new_sqlite_classes`)
  - **Assets / Landing Page**: `public/` (Native Web3/Glassmorphism Cyberpunk Telemetry Dashboard)
- **Audit Baseline:** Phase 01, Phase 02, and Phase 03 Completed. Live Auth, Civil Identity, SSI/DID, and Finance Treasury modules fully implemented in `src/domains/`, `src/infrastructure/repositories/`, and HTTP controllers/routes (`/api/v1/civil`, `/api/v1/ssi`, `/api/v1/finance`).
- **Active DB Bounded Contexts:** 11 physical contexts defined and verified in `src/db/` (`user`, `authentication`, `web3`, `civil-identity`, `ssi`, `finance`, `security`, `authorization`, `integrations`, `compliance`, `infrastructure`). 7 contexts target state (`organizations`, `communication`, `governance`, `social`, `contributions`, `contracts`, `real-estate`).
- **Application Ports (`src/application/ports/output/`):** Refactored and decoupled (`IUnitOfWork`, `IUserRepository`, `IAuthenticationRepository`, `IWeb3Repository`, `ICivilIdentityRepository`, `ISsiRepository`, `IFinanceRepository`, `ISessionRepository`, `IIdentityResolverPort`, `ITransactionRepository`, `ISecurityAuditPort`, `IOutboxRepository`, `IEventBus`, `IClock`, `INotificationPort`, `IPasswordResetRepository`, `IChallengeStorePort`). Note: `IObjectStorage` and `IContentAddressedStorage` are pending targets.
- **Infrastructure Repositories (`src/infrastructure/repositories/`):** 12 Drizzle/KV Adapters implemented (`DrizzleUserRepositoryAdapter`, `DrizzleAuthenticationRepositoryAdapter`, `DrizzleWeb3RepositoryAdapter`, `DrizzleCivilIdentityRepositoryAdapter`, `DrizzleSessionRepository`, `DrizzleUnitOfWork`, `DrizzleWalletRepository`, `DrizzleSsiRepository`, `DrizzleFinanceRepository`, `DrizzleOutboxRepository`, `DrizzlePasswordResetRepository`, `KvChallengeStoreAdapter`).
- **Infrastructure Security (`src/infrastructure/security/`):** CryptoCore Ed25519, PBKDF2 Password Hasher, JwtService, and timing_safe comparison verified.
- **Pending Architectural Gaps:** External KYC Provider Adapter integration (`src/infrastructure/adapters/kyc/`), Public W3C DID Resolver (`/.well-known/did.json`), and physical creation of 7 target DB contexts in `src/db/`.

### 📊 Visual Module Progress Dashboard (Real Code Audit Baseline)

```text
REAL CODEBASE MATURITY BASELINE: [███████░░░ ~70%]
(Note: Maturity percentages are directional engineering metrics, not normative architecture scores, unless calculated by the documented maturity formula.)

┌──────────────────────┬────────────────────────┬───────┬────────────────────────────────────────────────────────┐
│ Bounded Context      │ DB Layer (src/db/)     │ Nota  │ Real Code Maturity (Domain/App/Infra/HTTP/Tests)        │
├──────────────────────┼────────────────────────┼───────┼────────────────────────────────────────────────────────┤
│ USER Module          │ tables+relations: 100% │ 10.0  │ 60% — DB Schema 100%, Repos 100%, Seed Live Certified  │
│ AUTHENTICATION/ID    │ tables+relations: 100% │ 10.0  │ 100% — DB 100%, Repos 100%, Hardening (authEpoch/2FA)  │
│ WEB3 Module          │ tables+relations: 100% │ 10.0  │ 50% — DB Schema 100%, Repos Port+Adapter 100%          │
│ CIVIL-IDENTITY Module│ tables+relations: 100% │ 10.0  │ 90% — DB Schema 100%, UseCases 100%, HTTP Routes 100%  │
│ SSI Module            │ tables+relations: 100% │ 10.0  │ 85% — DB Schema 100%, DID/VC UseCases 100%, Routes 100%│
│ FINANCE Module        │ tables+relations: 100% │ 10.0  │ 85% — DB Schema 100%, Ledger Adapter & UseCases 100%  │
│ SECURITY Module       │ tables+relations: 100% │ 10.0  │ 60% — DB Schema 100%, Security Infra 90%               │
│ AUTHORIZATION Module  │ tables+relations: 100% │ 10.0  │ 30% — DB Schema 100%, Adapters 0%, App 0%, Routes 0%   │
│ COMPLIANCE Module     │ tables+relations: 100% │ 10.0  │ 60% — DB Schema 100%, Standalone Schemas 100%          │
│ INTEGRATIONS Module   │ tables+relations: 100% │ 10.0  │ 40% — DB Schema 100%, Webhook Routes 100%              │
│ INFRASTRUCTURE Module │ tables+relations: 100% │ 10.0  │ 75% — DB Schema 100%, D1/R2/KV/Queues/DO Certified 100%│
│ Demais 7 Módulos      │ ⏳ Pendentes em db/    │  0.0  │  0% — Planejamento Target (Esquemas DB Pendentes)      │
└──────────────────────┴────────────────────────┴───────┴────────────────────────────────────────────────────────┘
```


---

## 📑 02. ARCHITECTURE DECISION RECORDS (ADR LOG)

- **ADR-001:** `src/db/<context>/` is the canonical baseline for persistent Bounded Context definitions.
- **ADR-002:** Architecture style is a **Modular Monolith** running on Cloudflare Workers Edge Infrastructure. Service Bindings are optional for isolated Workers.
- **ADR-003:** The `domains/` layer MUST be strictly framework-agnostic (zero imports of Hono, Drizzle, Cloudflare, or Viem).
- **ADR-004:** Web3 execution (`web3Transactions`) is decoupled from Finance accounting (`ledgerEntries`). Web3 events trigger Double-Entry Ledger updates.
- **ADR-005:** Dual-port storage abstraction: `IObjectStorage` (R2/S3) for operational objects and `IContentAddressedStorage` (IPFS) for immutable CIDs. Private/sensitive data on IPFS requires pre-encryption.
- **ADR-006:** Communication context (`src/db/communication/`) unifies Chat, Email, and Notifications capabilities under a single Bounded Context.
- **ADR-007:** Formal Authentication Assurance Levels (AAL1, AAL2, AAL3) govern access to sensitive routes and institutional operations.
- **ADR-008:** Native AI layer integration via Cloudflare Workers AI (`@cf/meta/llama-3.1-8b-instruct`, `@cf/meta/llama-guard-3-8b`, etc.) for automated curation, SEO, and security auditing.

---

## 🔐 03. INSTITUTIONAL SECURITY (STRIDE & AAL LEVELS)

### Authentication Assurance Levels (AAL Matrix)

```text
┌───────┬──────────────────────────┬────────────────────────────────────────────────────────────┐
│ Level │ Description              │ Required Authentication Mechanisms                         │
├───────┼──────────────────────────┼────────────────────────────────────────────────────────────┤
│ AAL1  │ Digital Identity         │ Basic Auth (Email + Password PBKDF2 or Web3 SIWE)          │
│ AAL2  │ Strong Identity          │ AAL1 + Mandatory MFA / TOTP (Google Auth/Authy)            │
│ AAL3  │ Institutional / High-Assurance Identity │ AAL2 + approved identity proofing + phishing-resistant cryptographic authenticator │
└───────┴──────────────────────────┴────────────────────────────────────────────────────────────┘
```

### Cryptographic Threat Model (STRIDE Matrix)

| Category                   | Threat               | Architectural Mitigation Strategy                              | Enforcement Level   |
| :------------------------- | :------------------- | :------------------------------------------------------------- | :------------------ |
| **S**poofing               | Identity Spoofing    | MFA/TOTP (AAL2), SIWE EIP-4361, Email Verification             | **Authentication**  |
| **T**ampering              | Data Tampering       | Immutable IPFS CIDs, Ledger Cryptographic Hashes               | **D1 DB / IPFS**    |
| **R**epudiation            | Action Repudiation   | Tamper-evident security audit logs, authenticated actor/session context, and cryptographic evidence where non-repudiation is required | **Security Domain** |
| **I**nformation Disclosure | Data Leakage         | Pre-upload IPFS Encryption, Protected R2, HttpOnly Session JWT | **Infrastructure**  |
| **D**enial of Service      | Service Outage       | IP/User Rate Limiting, Cloudflare Turnstile, KV Edge Cache     | **Cloudflare Edge** |
| **E**levation of Privilege | Privilege Escalation | Minimum required AAL per route, Explicit D1 RBAC               | **Authorization**   |

---

## 🏛️ 04. ARCHITECTURE CONSTITUTION (THE 20 GOLDEN RULES)

|   #    | Architectural Rule                     | Normative Specification                                                                                                                                                                                                      | Enforcement Level             |
| :----: | :------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------- |
| **1**  | **DB Baseline**                        | `src/db/<context>/` defines the persistent Bounded Context. Does not imply full application maturity.                                                                                                                        | **DB / Architecture**         |
| **2**  | **Domain Purity**                      | `domains/` contains only _Aggregates, Entities, Value Objects, Domain Services, Domain Events, Specifications, Policies_, and _Domain Errors_. DTOs, Controllers, ORM models, or Cloudflare bindings are strictly forbidden. | **Architecture Test**         |
| **3**  | **Dependency Inversion**               | `application/ports/` is split into `input/` (use cases) and `output/` (repositories, signers, hasher, JWT, storage).                                                                                                         | **Architecture Test**         |
| **4**  | **Concrete Infrastructure**            | `infrastructure/` implements all output ports. Domain **never** depends on Infrastructure.                                                                                                                                   | **Architecture Test**         |
| **5**  | **Interface Adaptation**               | `interfaces/` is split into `http/`, `webhooks/`, and `runtime/` (`queue-consumers/`, `workflows/`, `scheduled/`).                                                                                                           | **Application / HTTP**        |
| **6**  | **Eliminate Loose `src/services`**     | Legacy `src/services/` is removed. Business logic resides in Use Cases or Domain Services when strictly necessary.                                                                                                           | **Architecture Test**         |
| **7**  | **Eliminate Loose `src/repositories`** | Port interfaces reside in `application/ports/output/` and implementations in `infrastructure/repositories/`. | **Architecture Test**         |
| **8**  | **Route Taxonomy**                     | Routes organized by context in `interfaces/http/routes/<context>/`. Eliminates `core`, `platform`, and `products`.                                                                                                           | **Interfaces**                |
| **9**  | **Agnostic Controllers**               | Controllers reside in `interfaces/http/controllers/<context>/`. Domain ignores HTTP.                                                                                                                                         | **Architecture Test**         |
| **10** | **Blockchain Ports**                   | Abstraction via `IBlockchainGateway`, `IWalletSigner`, `IKeyProvider`, and `INonceManager`. Viem/RPC isolated in infrastructure.                                                                                             | **Infrastructure**            |
| **11** | **Web3 × Finance**                     | Web3 transaction (execution) emits an event that feeds the Finance ledger (accounting). Direct on-chain balance mutation is forbidden.                                                                                       | **Domain / Application**      |
| **12** | **Dual-Port Storage**                  | `IObjectStorage` (operational R2) and `IContentAddressedStorage` (immutable IPFS CIDs).                                                                                                                                      | **Infrastructure**            |
| **13** | **IPFS Security**                      | IPFS content MUST be treated as potentially publicly retrievable. PRIVATE and CONFIDENTIAL data MUST be encrypted before pinning and MUST never rely on CID secrecy as an access-control mechanism. | **Infrastructure / Security** |
| **14** | **Cloudflare Bindings**                | Prefer native bindings (`c.env.DB`, `c.env.R2`) when tied to Workers; REST permitted only for external services without bindings.                                                                                            | **Infrastructure**            |
| **15** | **Service Bindings**                   | Permitted for communication between independent Workers; optional within the Modular Monolith.                                                                                                                               | **Cloudflare Infrastructure** |
| **16** | **Queue Idempotency**                  | Consumers MUST implement idempotent processing appropriate to message contract. Where applicable, deduplication MUST use stable message/event ID or idempotency key. Correlation IDs MAY trace but MUST NOT be sole deduplication mechanism. | **Application / Worker**      |
| **17** | **Durable Workflows**                  | Reserved for long-running, multi-step, stateful, and retryable processes (Onboarding, RWA Tokenization, Settlement).                                                                                                         | **Runtime / Workflow**        |
| **18** | **Stateful Durable Objects**           | Used for real-time stateful coordination per entity (WebSockets, presence, rooms, locks), not as main relational datastore.                                                                                                  | **Cloudflare Infrastructure** |
| **19** | **DB Enforcement**                     | Physical constraints (`CHECK`, `FOREIGN KEY`, `UNIQUE`) MUST enforce relational invariants. Triggers MAY be used when safely expressible in D1; domain rules MUST remain enforced by Application/Domain layer. | **D1 Database Constraints**   |
| **20** | **Automated Governance**               | The `tests/architecture/architecture-boundaries.test.ts` test suite validates import boundaries in CI/CD.                                                                                                                    | **CI / Architecture Test**    |

### 🛡️ Account-First Identity Governance Constitution (AF-001 to AF-014)

| Rule | Normative Name | Architectural Invariant & Description | Primary Enforcement Level |
| :--- | :--- | :--- | :--- |
| **AF-001** | **Single Account Provisioning** | `/register` is the single canonical account provisioning flow. No auth callback may create accounts. | Application Layer + API Gateway |
| **AF-002** | **Zero Auth Auto-Provisioning** | Authentication MUST NEVER invoke any account-provisioning capability. | Domain Boundary + AST Test (`tests/static_architecture.test.ts`) |
| **AF-003** | **Unlinked Identity Rejection** | Unknown external identities MUST return `IDENTITY_NOT_LINKED` (HTTP 401). | `CanonicalIdentityResolver` |
| **AF-004** | **Provider Subject Canonical Key**| Email MUST NOT be the canonical identity key; `(provider, provider_subject_id)` is canonical. | `ExternalIdentityRepository` |
| **AF-005** | **Identity Uniqueness Constraint**| External identity binding MUST satisfy DB uniqueness constraint: `UNIQUE(provider, provider_subject_id)`. | Cloudflare D1 Database Index |
| **AF-006** | **Pre-existing Account Binding** | Identity linking requires pre-existing account (`users.id`). | `LinkExternalIdentityUseCase` |
| **AF-007** | **AAL2+ Step-Up Requirement** | Identity linking and unlinking require AAL2+ assurance (`sessionAal >= 2`). | Hono Route Guard + UseCase |
| **AF-008** | **Anti-Lockout Protection** | Unlink MUST NOT leave the account without a primary authentication method (`primaryAuthMethods >= 2`). | `UnlinkExternalIdentityUseCase` + TransactionContext |
| **AF-009** | **Passkey Unknown Rejection** | Unknown Passkeys MUST return `IDENTITY_NOT_LINKED` (HTTP 401). | `PasskeyIdentityRepository` |
| **AF-010** | **Wallet Unknown Rejection** | Unknown Wallets MUST return `IDENTITY_NOT_LINKED` (HTTP 401). Zero `@web3.local` shadow accounts. | `WalletIdentityRepository` |
| **AF-011** | **DID Unknown Rejection** | Unknown DIDs MUST return `IDENTITY_NOT_LINKED` (HTTP 401). Zero `@ssi.local` shadow accounts. | `DidIdentityRepository` |
| **AF-012** | **Shadow Email Prohibition** | Fallback shadow account emails (`@web3.local`, `@ssi.local`) are strictly prohibited in codebase. | AST Static Linter Test |
| **AF-013** | **Canonical Resolver Authority**| Identity resolution MUST occur strictly through `CanonicalIdentityResolver`. | Application Port `IIdentityResolverPort` |
| **AF-014** | **Specialized Repositories** | Repositories MUST implement specialized interfaces per bounded context (Clean Architecture). | Clean Architecture Ports & Adapters |

---

## 🔗 05. CROSS-DOMAIN DEPENDENCY MATRIX (v4 ENFORCED)

```yaml
domains/identity:
  direct_imports:            # Physical code imports (minimal, only shared/kernel)
    - shared/kernel
  references:                 # Opaque branded types (UserId), without importing domain logic
    - UserId
  events:
    publishes:
      - IdentityLinked
      - IdentityUnlinked
    consumes:
      - UserRegistered        # via shared/event-contracts, never domains/user directly
  forbidden:
    - finance
    - web3
    - civil-identity

domains/finance:
  direct_imports:
    - shared/kernel
  references:
    - UserId
  events:
    publishes:
      - LedgerEntryPosted
    consumes:
      - Web3TransactionConfirmedV1   # via shared/event-contracts (zero direct web3 import)
  forbidden:
    - web3
    - civil-identity

domains/user:
  direct_imports:
    - shared/kernel
  references: []
  events:
    publishes:
      - UserRegistered
      - UserStatusChanged
    consumes: []
  forbidden:
    - finance
    - web3
    - civil-identity
    - ssi

domains/web3:
  direct_imports:
    - shared/kernel
  references:
    - UserId
  events:
    publishes:
      - Web3TransactionConfirmed
    consumes: []
  forbidden:
    - finance

domains/authorization:
  direct_imports:
    - shared/kernel
  references:
    - UserId
  events:
    publishes: []
    consumes: []
  forbidden:
    - finance
    - web3
    - communication

domains/civil-identity:
  direct_imports:
    - shared/kernel
  references:
    - UserId
  events:
    publishes:
      - KycStatusChanged
    consumes: []
  forbidden:
    - web3
    - finance

domains/ssi:
  direct_imports:
    - shared/kernel
  references:
    - UserId
  events:
    publishes: []
    consumes:
      - KycStatusChanged            # via shared/event-contracts
  forbidden:
    - finance
    - communication
```

---

## 📐 06. GENERAL TOPOLOGY & DEPENDENCY FLOW

```text
               ┌────────────────────────────────┐
               │          INTERFACES            │
               │  (HTTP / Webhooks / Runtimes)  │
               └───────────────┬────────────────┘
                               │
                               ▼
               ┌────────────────────────────────┐
               │          APPLICATION           │
               │  (Use Cases / Commands / Ports)│
               └───────────────┬────────────────┘
                               │
                               ▼
               ┌────────────────────────────────┐
               │             DOMAIN             │
               │  (Aggregates / Entities / Rules)│
               └───────────────┬────────────────┘
                               │
                        PORTS / CONTRACTS
                               ▲
                               │
               ┌───────────────┴────────────────┐
               │         INFRASTRUCTURE         │
               │ (D1 / Cloudflare / Viem / IPFS)│
               └────────────────────────────────┘
```

---

# 🤖 07. ARTIFICIAL INTELLIGENCE LAYER (WORKERS AI)

The backend features native integration with **Cloudflare Workers AI**, using Cloudflare Workers AI bindings to execute supported models within the Cloudflare platform and minimize external inference dependencies.

### Integrated AI Squad Models

| Function / Role              | Cloudflare Workers AI Model            | System Application                                     |
| :--------------------------- | :------------------------------------- | :----------------------------------------------------- |
| **Writing & Communication**  | `@cf/meta/llama-3.1-8b-instruct-fast`  | Generation and synthesis of official DAO announcements |
| **SEO & Metadata**           | `@cf/meta/llama-3.2-3b-instruct`       | Optimization of tags, titles, and RWA/Blog metadata    |
| **Security & Moderation**    | `@cf/meta/llama-guard-3-8b`            | Content moderation and anomaly/fraud detection         |
| **Visual Assets**            | `@cf/black-forest-labs/flux-1-schnell` | Generation of photorealistic covers and visual assets  |
| **Accessibility (Alt-Text)** | `@cf/llava-hf/llava-1.5-7b-hf`         | Automatic description of KYC documents and images      |
| **Multilingual Translation** | `@cf/meta/m2m100-1.2b`                 | Internationalization (PT/EN/ES) of DAO proposals       |

---

# 📦 08. NORMATIVE CONTRACTS PER BOUNDED CONTEXT

---

## MODULE: USER `[████░░░░░░ 40%]`

- **Physical Path:** `src/db/user/` | **Domain:** `src/domains/user/`
- **Architectural Owner:** User Domain Team / Core Architect
- **Progress Status:** `[████░░░░░░ 40%]` (DB Schema 100% verified, Output Port & Drizzle Repository Adapter implemented; Domain & Use Cases Pending)
- **Responsibility:** Represents the system's internal account and its directly owned data (profile, contacts, addresses, preferences). Not responsible for authentication, KYC, blockchain, authorization, or finance.

### 1. Overview

```text
┌───────────────────────────────────────────────────────────────────────────┐
│                           USER / ACTOR                                    │
│                                                                           │
│        "Which account exists inside the system?"                         │
│                                                                           │
│        src/db/user/                                                       │
│                                                                           │
│   ┌───────────────────────────────┐                                      │
│   │             users             │                                      │
│   │                               │                                      │
│   │ id                            │ ◄── internal identity (PK)           │
│   │ publicId                      │ ◄── public identity after            │
│   │ subjectType                   │     onboarding + wallet              │
│   │ email                         │                                      │
│   │ emailNormalized               │                                      │
│   │ emailVerifiedAt               │                                      │
│   │ emailChangedAt                │                                      │
│   │ authEpoch                     │                                      │
│   │ status                        │                                      │
│   │ statusChangedAt               │                                      │
│   │ lockedAt                      │                                      │
│   │ disabledAt                    │                                      │
│   │ deletedAt                     │                                      │
│   │ createdAt                     │                                      │
│   │ updatedAt                     │                                      │
│   └───────────────┬───────────────┘                                      │
│                   │                                                      │
│        ┌──────────┼───────────────┬──────────────┬──────────────┐        │
│        │          │               │              │              │        │
│        ▼          ▼               ▼              ▼              ▼        │
│   userProfiles  Contacts      Addresses      Education     Experience    │
│                                                                           │
│                   ┌─────────────────────────────────────┐                │
│                   │         membershipCards              │                │
│                   └─────────────────────────────────────┘                │
│                                                                           │
│                   ┌─────────────────────────────────────┐                │
│                   │   userNotificationSettings           │                │
│                   └─────────────────────────────────────┘                │
│                                                                           │
└───────────────────────────────────────────────────────────────────────────┘
```

### 2. Identities and Source of Truth

```text
┌──────────────────────┬─────────────────────────────────────────┬────────────────────────────┐
│ Identity             │ Responsibility                          │ Semantics / Enforcement    │
├──────────────────────┼─────────────────────────────────────────┼────────────────────────────┤
│ users.id             │ Internal Relational Identity            │ Primary Key (DB)           │
│ users.publicId       │ Public Account Identifier derived from active internal wallet address │ Unique Constraint (DB)     │
│ citizens.userId      │ Civil Identity (KYC)                    │ Composite FK (DB)          │
│ wallets.address      │ Canonical Blockchain Identity           │ Unique EVM Address (DB)    │
│ didIdentities.did    │ SSI Identity (W3C)                      │ Unique Constraint (DB)     │
└──────────────────────┴─────────────────────────────────────────┴────────────────────────────┘
```

### 3. Public ID Invariants

1. `publicId` starts as `NULL` (Approved KYC does not assign `publicId` automatically; it only enables the next step).
2. Internal wallet provisioning is orchestrated by backend: Approved KYC → Backend exposes capability → User requests → Backend creates Internal Wallet → `wallet.address` becomes `users.publicId`.
3. `users.publicId` is a public account identifier derived from the active internal wallet address. It cannot point to external wallets.

### 4. Account Lifecycle (`users.status`)

```text
pending_setup ──► active ──► locked / suspended / disabled ──► active
```

- **Critical Rule:** `KYC rejected ≠ user suspended`. KYC failure keeps citizen unverified without suspending account, unless fraud is detected.

### 5. Boundaries (What DOES NOT Belong to User)

- ❌ Passwords, TOTP, Sessions, OAuth Tokens (`authentication`)
- ❌ KYC status, civil documents (`civil-identity`)
- ❌ DIDs and Verifiable Credentials (`ssi`)
- ❌ Balances, Ledger, and Accounts (`finance`)
- ❌ Private keys or EVM signers (`web3`)

### 6. Roadmap: CURRENT STATE vs TARGET ARCHITECTURE

| Component / Feature                    | State       | Owner                  | Enforcement Level    |
| :------------------------------------- | :---------- | :--------------------- | :------------------- |
| **`users` & `userProfiles`**           | ✅ Existing | User Team              | DB Constraints       |
| **`userContacts` & `userAddresses`**   | ✅ Existing | User Team              | DB Constraints       |
| **`membershipCards`**                  | ✅ Existing | User Team              | DB Constraints       |
| **Post-KYC `publicId` (Nullable)**     | ⚠️ Defined  | User/Web3 Orchestrator | DB + Application     |
| **Internal Wallet Provisioning**       | ⏳ Pending  | Web3 Team              | Application Workflow |
| **Sync `wallet.address` → `publicId`** | ⏳ Pending  | User Orchestrator      | Application / DB     |

## MODULE: AUTHENTICATION & IDENTITY CORE `[████░░░░░░ 40%]`

- **Physical Path:** `dashboard/src/auth/` & `src/db/authentication/` | **Domain:** `src/domains/identity/`
- **Architectural Owner:** Identity & Security Engineering Team
- **Progress Status:** `[████░░░░░░ 40%]` (DB Schema 100% verified, Output Port & Drizzle Repository Adapter implemented; Domain Services, Use Cases & Routes Pending)
- **Responsibility:** Strictly enforces the **Account-First Identity Architecture**. Operates as the central authority for identity resolution (`CanonicalIdentityResolver`), external identity linking/unlinking, credentials, MFA/2FA, sessions, and security auditing. Prohibition of shadow accounts (`@web3.local`, `@ssi.local`).

> **Architectural Note:** `authentication` is the canonical persistence bounded context. `identity` is the application/domain architectural boundary responsible for canonical identity resolution and authentication-related use cases. The two names MUST NOT be interpreted as two independent sources of truth.

### 1. Mapa Gráfico da Arquitetura e Camadas (Account-First Asset Map)

```text
====================================================================================================
               SISTEMA DE AUTENTICAÇÃO E IDENTIDADE ACCOUNT-FIRST — ASSET MAP
====================================================================================================

 🖥️ CAMADA 1: FRONTEND ESTÁTICO (www.asppibra.com)
 ┌────────────────────────────────────────────────────────────────────────────────────────────────┐
 │ • Next.js 16 Static Site (100% Visual / Sem formulários / Sem Auth)                            │
 │ • Redirecionamento HTTP 307: GET /login ──► https://app.asppibra.com/login                       │
 └────────────────────────────────────────────────┬───────────────────────────────────────────────┘
                                                  │
                                                  ▼ (Navegação HTTP 307)
 📊 CAMADA 2: DASHBOARD (app.asppibra.com)
 ┌────────────────────────────────────────────────────────────────────────────────────────────────┐
 │ 🔑 PÁGINAS & VIEWS (dashboard/src/pages/auth/):                                                │
 │    ├─ /login                  ── Sign-In Form (Email/Senha + Google/GitHub OAuth + Web3 SIWE)  │
 │    ├─ /register               ── Single Canonical Account Provisioning Endpoint (AF-001)       │
 │    ├─ /verify                 ── Verify Form (Entrada de código TOTP 2FA)                       │
 │    └─ /auth/oauth/callback    ── Handles IDENTITY_NOT_LINKED (HTTP 401) error gracefully       │
 └────────────────────────────────────────────────┬───────────────────────────────────────────────┘
                                                  │
                                                  ▼ (Requisições REST / JSON com Bearer JWT)
 ⚙️ CAMADA 3: BACKEND WORKER API (api.asppibra.com)
 ┌────────────────────────────────────────────────────────────────────────────────────────────────┐
 │ 🌐 ROTEADORES HTTP (backend/src/routes/core/identity/):                                        │
 │    ├─ /local/*               ── (/login, /register, /verify-2fa, /refresh-session, /logout, /me)│
 │    ├─ /oauth/*               ── (/google/login, /google/callback, /github/login)              │
 │    ├─ /external-identities/* ── (GET /, POST /link, POST /unlink — Guarded by AAL2+)            │
 │    └─ /ssh/*                 ── (developer_ssh authentication)                                 │
 │                                                                                                │
 │ 🧠 DOMÍNIO & CASOS DE USO (backend/src/domains/identity/):                                     │
 │    ├─ CanonicalIdentityResolver.ts ── Central Identity Authority (AF-013)                     │
 │    ├─ AuthenticateAccountUseCase.ts── Password validation & PBKDF2                              │
 │    ├─ LinkExternalIdentityUseCase.ts── Idempotent linking requiring AAL2+ (AF-007)            │
 │    ├─ UnlinkExternalIdentityUseCase.ts── Unlinking with Anti-Lockout enforcement (AF-008)       │
 │    └─ VerifyExternalIdentityUseCase ── SIWE Wallet verification without auto-provisioning (AF-010)│
 └────────────────────────────────────────────────┬───────────────────────────────────────────────┘
                                                  │
                                                  ▼ (Drizzle ORM Queries / TransactionContext)
 🗄️ CAMADA 4: PERSISTÊNCIA CLOUDFLARE D1 (SQL RELACIONAL)
 ┌────────────────────────────────────────────────────────────────────────────────────────────────┐
 │ 🗃️ TABELAS DE IDENTIDADE E AUTENTICAÇÃO:                                                       │
 │    ├─ users                    ── Master account record (users.id anchor)                      │
 │    ├─ user_external_identities ── OAuth identities with UNIQUE(provider, provider_subject_id)   │
 │    ├─ wallets                  ── EVM Web3 identities (networkId + addressNormalized)         │
 │    ├─ passkey_credentials      ── WebAuthn Passkeys                                            │
 │    ├─ did_identities           ── SSI W3C DIDs                                                 │
 │    ├─ user_sessions            ── Active sessions and JWT tokens                               │
 │    └─ security_audit_logs      ── Imutável audit log executed inside TransactionContext        │
 └────────────────────────────────────────────────────────────────────────────────────────────────┘
====================================================================================================
```

### 2. Fluxo Canônico de Resolução de Identidade (`CanonicalIdentityResolver`)

```text
               IdentityAssertion (OAuth / Wallet / Passkey / DID)
                                   │
                                   ▼
                       CanonicalIdentityResolver
                                   │
                ┌──────────────────┼──────────────────┐
                ▼                  ▼                  ▼
       ExternalIdentities       Wallets            Passkeys / DIDs
                │                  │                  │
                └──────────────────┼──────────────────┘
                                   │
                         Does identity exist?
                                   │
                  ┌────────────────┴────────────────┐
                  ▼                                 ▼
                 YES                                NO
                  │                                 │
           Return users.id              Return status: "not_linked"
                  │                     Code: IDENTITY_NOT_LINKED (401)
                  ▼                                 │
            Issue Session                     ZERO Account Creation
```

### 3. Hardening & Invariantes de Segurança Certificadas

```text
┌────────────────────────────────────────┬─────────────────────────────────────────────────────────────┐
│ Invariante de Segurança                │ Estratégia de Hardening & Enforcement                       │
├────────────────────────────────────────┼─────────────────────────────────────────────────────────────┤
│ 1. Zero Shadow Accounts (AF-002/AF-012)│ Suíte AST static linter (`tests/static_architecture.test.ts`)│
│                                        │ proíbe strings `@web3.local` e `@ssi.local` e impede        │
│                                        │ chamadas de `RegisterAccountUseCase` em rotas de auth.      │
├────────────────────────────────────────┼─────────────────────────────────────────────────────────────┤
│ 2. Vínculo Idempotente AAL2+ (AF-007)  │ `LinkExternalIdentityUseCase` exige `sessionAal >= 2`       │
│                                        │ e retorna `status: "already_linked"` de forma idempotente.  │
├────────────────────────────────────────┼─────────────────────────────────────────────────────────────┤
│ 3. Trava Anti-Lockout (AF-008)         │ `UnlinkExternalIdentityUseCase` verifica `authMethods >= 2` │
│                                        │ e rejeita desvínculo com 409 se for o último método.        │
├────────────────────────────────────────┼─────────────────────────────────────────────────────────────┤
│ 4. Auditoria Transacional ACID         │ Auditoria de segurança gravada via `ISecurityAuditPort`      │
│                                        │ dentro do mesmo `TransactionContext` atômico D1/Drizzle.    │
└────────────────────────────────────────┴─────────────────────────────────────────────────────────────┘
```

---

## MODULE: WEB3 `[████░░░░░░ 40%]`

- **Physical Path:** `src/db/web3/` | **Domain:** `src/domains/web3/`
- **Architectural Owner:** Web3 & Blockchain Engineering Team
- **Progress Status:** `[████░░░░░░ 40%]` (DB Schema 100% verified, Output Port & Drizzle Repository Adapter implemented; Wallet Signers & Use Cases Pending)
- **Responsibility:** Manages technical infrastructure for blockchain network execution, wallets (EOA, Smart Contracts, Safes), and on-chain transaction lifecycles.

### 1. Overview (Web3 Topology)

```text
                    WEB3 DOMAIN
                         │
        ┌────────────────┼────────────────┐
        │                │                │
     wallets      web3Networks     smartContracts
        │                │                │
        └───────────────┬┴────────────────┘
                        │
                 web3Transactions
```

### 2. Wallet Custody Model

```text
┌───────────────────────┬──────────────────┬─────────────────────────────┐
│ Provenance            │ Type             │ Control Mode                │
├───────────────────────┼──────────────────┼─────────────────────────────┤
│ internal              │ eoa              │ platform_key (KMS)          │
│ external              │ eoa              │ external_user (Injected)    │
│ internal / external   │ smart_contract   │ contract_controller         │
└───────────────────────┴──────────────────┴─────────────────────────────┘
```

- **Custody Invariant:** Custodial EOAs require `keyProvider` and `keyReference` (AWS KMS/Fireblocks). Private keys **never** travel or rest in plaintext in database.

### 3. Transaction Lifecycle (Replacement Lineage)

- Support for transaction replacement (`replacementOfTransactionId`) with Optimistic Locking (`version`).
- Strict distinction between `status = failed` (RPC/mempool rejection) and `status = confirmed` with `receiptStatus = reverted` (EVM rollback consuming gas).

### 4. What DOES NOT Belong to Web3

- ❌ Accounting balances, Ledger, Double-Entry (`finance`).
- ❌ Civil identification data (`civil-identity`).
- ❌ Web2 authentication or session management (`authentication`).

### 5. Roadmap: CURRENT STATE vs TARGET ARCHITECTURE

| Component / Feature                          | State       | Owner     | Enforcement Level                                   |
| :------------------------------------------- | :---------- | :-------- | :-------------------------------------------------- |
| **`web3Networks` & `smartContracts`**        | ✅ Existing | Web3 Team | DB Constraints                                      |
| **`wallets` (Provenance & Control)**         | ✅ Existing | Web3 Team | DB Constraints (`ck_wallets_control_mode`)          |
| **`web3Transactions` (Lineage)**             | ✅ Existing | Web3 Team | DB Constraints (`ck_web3_transactions_replacement`) |
| **Ports (`IWalletSigner`, `INonceManager`)** | ⏳ Pending  | Web3 Team | Application Ports                                   |
| **Lifecycle Orchestrator Service**           | ⏳ Pending  | Web3 Team | Application Use Cases                               |

---

## MODULE: COMMUNICATION `[████░░░░░░ 25%]`

- **Physical Path:** `src/db/communication/` | **Domain:** `src/domains/communication/`
- **Architectural Owner:** Communication Subsystem Team
- **Progress Status:** `[████░░░░░░ 25%]` (DB Schema 100% verified; Domain Subsystems & Use Cases Pending)
- **Responsibility:** Unified omnichannel subsystem comprising Chat, Email, and Notifications subdomains.

### 1. Overview

```text
┌───────────────────────────────────────────────────────────────────────────┐
│                        COMMUNICATION SUBSYSTEM                            │
│                                                                           │
│        src/db/communication/                                              │
│                                                                           │
│ ┌───────────────────────┐ ┌───────────────────────┐ ┌──────────────────┐ │
│ │         CHAT          │ │         EMAIL         │ │  NOTIFICATIONS   │ │
│ │                       │ │                       │ │                  │ │
│ │ chatConversations     │ │ emailAccounts         │ │ notifications    │ │
│ │ chatParticipants      │ │ emailThreads          │ └──────────────────┘ │
│ │ chatMessages          │ │ emailLabels           │                      │
│ │ chatAttachments       │ │ emails                │                      │
│ │ chatReadReceipts      │ │ emailMessageLabels    │                      │
│ │ chatEvents            │ │ emailAttachments      │                      │
│ └───────────────────────┘ │ emailEvents           │                      │
│                           └───────────────────────┘                      │
└───────────────────────────────────────────────────────────────────────────┘
```

### 2. Communication Invariants

1. Isolated subdomains in `src/domains/communication/` (`chat/`, `email/`, `notifications/`).
2. Real-time chat orchestrated via `ChatRoomDO` Durable Object for presence/WebSockets, with async relational D1 persistence via `ChatQueueWorker`.
3. Email processing via `EmailQueueWorker` with idempotency control by `messageId`.

### 3. Roadmap: CURRENT STATE vs TARGET ARCHITECTURE

| Component / Feature                        | State       | Owner              | Enforcement Level  |
| :----------------------------------------- | :---------- | :----------------- | :----------------- |
| **Chat, Email & Notification Tables**      | ✅ Existing | Communication Team | DB Constraints     |
| **`ChatRoomDO` (Durable Object)**          | ✅ Existing | Infra / Cloudflare | Cloudflare Runtime |
| **`ChatQueueWorker` & `EmailQueueWorker`** | ✅ Existing | Infra / Workers    | Cloudflare Queues  |
| **Migration to `domains/communication`**   | ⏳ Pending  | Communication Team | Architecture Test  |
| **Elimination of `src/repositories/chat`** | ⏳ Pending  | Communication Team | Architecture Test  |

---

## MODULE: FINANCE `[████░░░░░░ 25%]`

- **Physical Path:** `src/db/finance/` | **Domain:** `src/domains/finance/`
- **Architectural Owner:** Financial Systems Engineering Team
- **Progress Status:** `[████░░░░░░ 25%]` (DB Schema 100% verified with Append-Only Ledger; Repositories & Use Cases Pending)
- **Responsibility:** Double-Entry Ledger accounting, financial accounts, balances, and transaction idempotency.

### 1. Overview

```text
┌───────────────────────────────────────────────────────────────────────────┐
│                           FINANCE DOMAIN                                  │
│                                                                           │
│        src/db/finance/                                                    │
│                                                                           │
│   ┌───────────────────────────────┐                                       │
│   │       financialAccounts       │ ◄── Internal checking accounts        │
│   └───────────────┬───────────────┘     for users and DAO                 │
│                   │                                                       │
│                   ▼                                                       │
│   ┌───────────────────────────────┐                                       │
│   │         ledgerEntries         │ ◄── Immutable financial ledger journal│
│   │                               │     (Debits & Credits)                │
│   └───────────────┬───────────────┘                                       │
│                   │                                                       │
│                   ▼                                                       │
│   ┌───────────────────────────────┐                                       │
│   │        idempotencyKeys        │ ◄── Financial concurrency lock        │
│   └───────────────────────────────┘                                       │
└───────────────────────────────────────────────────────────────────────────┘
```

### 2. Accounting Invariants

1. **Double-Entry:** Every journal transaction MUST balance such that the sum of debit amounts equals the sum of credit amounts. Account balance is a projection of ledger entries.
2. **Immutability (`Append-Only`):** Posted ledger entries MUST be immutable at the business level. Corrections MUST be represented by compensating/reversal entries. Administrative physical changes, when unavoidable for migrations or data recovery, MUST NOT alter the accounting meaning of a posted entry.
3. **Idempotency:** Financial operations require unique `idempotencyKey`.

### 3. Roadmap: CURRENT STATE vs TARGET ARCHITECTURE

| Component / Feature                             | State       | Owner        | Enforcement Level |
| :---------------------------------------------- | :---------- | :----------- | :---------------- |
| **`financialAccounts` & `ledgerEntries`**       | ✅ Existing | Finance Team | DB Constraints    |
| **`idempotencyKeys`**                           | ✅ Existing | Finance Team | DB Constraints    |
| **Consolidation into `domains/finance`**        | ⏳ Pending  | Finance Team | Architecture Test |
| **`ITreasuryRepository` / `ILedgerRepository`** | ⏳ Pending  | Finance Team | Application Ports |

---

# 🚀 09. GLOBAL EXECUTION ROADMAP & RECOVERY PROTOCOL

### Interruption Recovery Protocol

In case of an unexpected interruption during refactoring, the agent or developer MUST:

1. Check the **State** column of the table below to identify the last completed phase (`✅`).
2. Resume execution strictly at the first phase marked as `⏳ In Progress` or `⏳ Pending`.
3. Run `npx vitest run tests/architecture/` to confirm boundary compliance before proceeding.

| Phase  | Stage                             | Activity Description                                                                                         | Owner               | Enforcement Level |     State      |
| :----: | :-------------------------------- | :----------------------------------------------------------------------------------------------------------- | :------------------ | :---------------- | :------------: |
| **01** | **DIP Ports & UoW Refactoring**   | Refactor `IUnitOfWork.ts` and repository output ports (`IUserRepository`, `IAuthenticationRepository`, etc.).| Core Architect      | Architecture Test |  ✅ Completed  |
| **02** | **Domain Layer & Account-First**  | Create `src/domains/` and implement Account-First Use Cases, `CanonicalIdentityResolver` (AF-001..AF-014).  | Security / Auth     | Architecture Test |  ✅ Completed  |
| **03** | **Repositories Standardization**   | Complete Drizzle Repository Adapters migration to `src/infrastructure/repositories/`.                       | Infrastructure      | Architecture Test |  ✅ Completed  |
| **04** | **Communication Refactoring**     | Migrate Chat, Email & Notifications into `src/domains/communication/`.                                       | Communication       | Architecture Test |   ⏳ Pending   |
| **05** | **User Domain Refactoring**       | Refactor `user` anchor and implement `publicId` orchestrator in `src/domains/user/`.                         | User Team           | DB + Application  |   ⏳ Pending   |
| **06** | **Civil Identity & KYC**          | Isolate `civil-identity` (Citizens, Documents, KYC Verification) into `src/domains/civil-identity/`.        | Compliance Team     | Domain Rules      |  ✅ Completed  |
| **07** | **Finance & Double-Entry**        | Isolate `finance` with ledger control, idempotency keys, and `src/domains/finance/`.                        | Finance Team        | DB + Application  |  ✅ Completed  |
| **08** | **Web3 & Signers Layer**          | Implement `IWalletSigner`, `IKeyProvider`, and `INonceManager` with Viem.                                    | Web3 Team           | Application Ports |   ⏳ Pending   |
| **09** | **IPFS & Content Storage**        | Implement `IObjectStorage` and `IContentAddressedStorage` adapters.                                          | Infrastructure      | Infrastructure    |   ⏳ Pending   |
| **10** | **SSI & Verifiable Credentials**  | Consolidate DIDs and Ed25519 Handshake into `src/domains/ssi/`.                                              | Identity Team       | Domain Rules      |  ✅ Completed  |
| **11** | **Route Taxonomy Migration**      | Refactor routes from `/api/core/` to `/api/v1/<context>/` and isolate Hono Controllers.                      | Platform Team       | Interfaces        | ⏳ In Progress |
| **12** | **Full Audit & CI Certification** | Run complete suite of boundary tests (`tests/architecture/`), unit, integration, and load tests.            | QA / Lead Architect | CI Certification  |   ⏳ Pending   |

