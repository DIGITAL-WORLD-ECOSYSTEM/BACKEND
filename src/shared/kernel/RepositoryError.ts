/**
 * Canonical error contract for all Output Port (Repository/Gateway) operations.
 *
 * Usage:
 *   - NOT_FOUND            → entity does not exist (expected absence, not an exception)
 *   - CONFLICT             → unique constraint or business rule violation on creation
 *   - CONSTRAINT_VIOLATION → FK or CHECK constraint rejected by the DB
 *   - OCC_CONFLICT         → optimistic concurrency version mismatch (retry-able)
 *   - INTEGRITY_ERROR      → data inconsistency detected (non-retry-able)
 *   - TRANSIENT_FAILURE    → temporary infrastructure error (retry-able)
 *   - UNAVAILABLE          → persistent infrastructure outage (circuit-break)
 *
 * NOTE: Domain-level business outcomes (e.g. INSUFFICIENT_BALANCE, OCC on balance)
 * that are part of the normal contract of a method MUST NOT use RepositoryError —
 * they should be expressed as discriminated union return types (e.g. BalanceUpdateResult).
 */
export type RepositoryErrorCode =
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'CONSTRAINT_VIOLATION'
  | 'OCC_CONFLICT'
  | 'INTEGRITY_ERROR'
  | 'TRANSIENT_FAILURE'
  | 'UNAVAILABLE';

export interface RepositoryError {
  readonly code: RepositoryErrorCode;
  readonly message: string;
  readonly cause?: unknown;
}

// ─── Factory helpers ──────────────────────────────────────────────────────────

export const RepositoryError = {
  notFound(message: string, cause?: unknown): RepositoryError {
    return { code: 'NOT_FOUND', message, cause };
  },
  conflict(message: string, cause?: unknown): RepositoryError {
    return { code: 'CONFLICT', message, cause };
  },
  constraintViolation(message: string, cause?: unknown): RepositoryError {
    return { code: 'CONSTRAINT_VIOLATION', message, cause };
  },
  constraint(message: string, cause?: unknown): RepositoryError {
    return { code: 'CONSTRAINT_VIOLATION', message, cause };
  },
  occConflict(message: string, cause?: unknown): RepositoryError {
    return { code: 'OCC_CONFLICT', message, cause };
  },
  integrityError(message: string, cause?: unknown): RepositoryError {
    return { code: 'INTEGRITY_ERROR', message, cause };
  },
  integrity(message: string, cause?: unknown): RepositoryError {
    return { code: 'INTEGRITY_ERROR', message, cause };
  },
  transientFailure(message: string, cause?: unknown): RepositoryError {
    return { code: 'TRANSIENT_FAILURE', message, cause };
  },
  transient(message: string, cause?: unknown): RepositoryError {
    return { code: 'TRANSIENT_FAILURE', message, cause };
  },
  unavailable(message: string, cause?: unknown): RepositoryError {
    return { code: 'UNAVAILABLE', message, cause };
  },
} as const;
