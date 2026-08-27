# Master Security & Architecture Invariants

This document defines the absolute, unchangeable architectural and security invariants of the system.
These invariants must NEVER be violated by any module, repository, or use-case.

## Authentication & Authorization Invariants
- **INV-AUTH-001**: Every authenticated request must resolve to an active session in the database.
- **INV-AUTH-002**: The `authEpoch` of the session MUST equal the `authEpoch` of the user entity. Any mismatch immediately invalidates the session.
- **INV-AUTH-003**: No JWT claim may be the authoritative source of authorization. RBAC checks must always verify roles and permissions against the database.
- **INV-AUTH-004**: All effective authorization must be derived from the authenticated principal + current server state + authorization policy. Client identity/authorization claims are never the authority.

## Financial & Accounting Invariants
- **INV-FIN-001**: Every posted ledger transaction must balance to zero per asset (`sum(debits by asset) == sum(credits by asset)`).
- **INV-FIN-002**: Ledger entries are immutable (Append-only). They must never be updated or deleted.
- **INV-FIN-003**: Every financial mutation must be atomic and idempotent at the transaction (UoW) level.
- **INV-FIN-004**: `AccountBalance` is NEVER the primary source of accounting truth; it is strictly a materialized projection derived from the Ledger.
- **INV-FIN-005**: The Ledger is the only source of accounting truth. Any materialized balance must be reconstructable from the immutable entries of the Ledger.

## SSI & Verifiable Credentials Invariants
- **INV-SSI-001**: Only authorized issuers can issue credentials.
- **INV-SSI-002**: A Verifiable Credential emitted must possess a cryptographically verifiable proof (e.g. Ed25519 signature).
- **INV-SSI-003**: A revoked or expired VC cannot be considered valid under any circumstance.
- **INV-SSI-004**: The issuer must be resolvable and authorized for that specific credential type.
- **INV-SSI-005**: Protected claims cannot be provided arbitrarily by the holder; they must originate from a trusted domain or verifiable source.
- **INV-SSI-006**: The holder/subject of a VC must correspond to a resolvable canonical identity; the holder cannot arbitrarily choose a third-party identity.
