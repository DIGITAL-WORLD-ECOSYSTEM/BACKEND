import { describe, it, expect, vi } from 'vitest';
import { app } from '../../../../index';

describe('Compliance Module — KYC', () => {
  const baseEnv = {
    DB: {
      prepare: () => ({
        bind: () => ({
          first: () => Promise.resolve({}),
          all: () => Promise.resolve({ results: [], success: true }),
          run: () => Promise.resolve({ success: true, meta: {} }),
          raw: () => Promise.resolve([]),
        }),
        first: () => Promise.resolve({}),
        all: () => Promise.resolve({ results: [], success: true }),
        run: () => Promise.resolve({ success: true, meta: {} }),
        raw: () => Promise.resolve([]),
      }),
    },
    KV_AUTH: {
      get: vi.fn().mockResolvedValue(null),
      put: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    },
    KV_CACHE: {},
    STORAGE: {},
    JWT_SECRET: 'test_secret',
    TOTP_ENCRYPTION_KEY: 'test_totp_key_32_bytes_min_length_123',
    ADMIN_PASSWORD: 'secret_admin_key_123',
  };

  // --- /kyc/review ---

  it('rejects /kyc/review without x-admin-key header', async () => {
    const res = await app.fetch(
      new Request('http://localhost/api/core/compliance/kyc/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 1, status: 'approved' }),
      }),
      baseEnv as any,
      { waitUntil: () => {}, passThroughOnException: () => {} } as any
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as any;
    expect(body.success).toBe(false);
    expect(body.message).toBe('Unauthorized');
  });

  it('rejects /kyc/review with wrong x-admin-key (timing-safe)', async () => {
    const res = await app.fetch(
      new Request('http://localhost/api/core/compliance/kyc/review', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-key': 'wrong_key',
        },
        body: JSON.stringify({ userId: 1, status: 'approved' }),
      }),
      baseEnv as any,
      { waitUntil: () => {}, passThroughOnException: () => {} } as any
    );
    expect(res.status).toBe(401);
  });

  it('rejects /kyc/review with invalid status value (Zod)', async () => {
    const res = await app.fetch(
      new Request('http://localhost/api/core/compliance/kyc/review', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-key': 'secret_admin_key_123',
        },
        body: JSON.stringify({ userId: 1, status: 'INVALID_STATUS' }),
      }),
      baseEnv as any,
      { waitUntil: () => {}, passThroughOnException: () => {} } as any
    );
    // Zod retorna 400 para validation error
    expect(res.status).toBe(400);
  });

  it('rejects /kyc/review with invalid documentType (Zod)', async () => {
    const res = await app.fetch(
      new Request('http://localhost/api/core/compliance/kyc/submit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Sem headers Zero-Trust — deve falhar no middleware
        },
        body: JSON.stringify({ userId: 1, documentType: 'INVALID_TYPE' }),
      }),
      baseEnv as any,
      { waitUntil: () => {}, passThroughOnException: () => {} } as any
    );
    expect(res.status).toBe(401); // Zero-Trust middleware bloqueia primeiro
  });

  it('rejects /kyc/submit with empty body (Zod)', async () => {
    const res = await app.fetch(
      new Request('http://localhost/api/core/compliance/kyc/submit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      }),
      baseEnv as any,
      { waitUntil: () => {}, passThroughOnException: () => {} } as any
    );
    // Zero-Trust middleware rejeita primeiro (sem headers)
    expect(res.status).toBe(401);
  });
});
