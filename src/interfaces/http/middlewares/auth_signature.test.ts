import { describe, it, expect, vi } from 'vitest';
import { app } from '../../../index';

describe('Zero-Trust Middleware (auth_signature)', () => {
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
      get: vi.fn().mockResolvedValue('test_challenge'),
      put: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    },
    KV_CACHE: {},
    STORAGE: {},
    JWT_SECRET: 'test_secret',
    TOTP_ENCRYPTION_KEY: 'test_totp_key_32_bytes_min_length_123',
    ADMIN_PASSWORD: 'admin_secret',
  };

  const validTimestamp = Date.now().toString();

  const makeRequest = (headers: Record<string, string> = {}) =>
    new Request('http://localhost/api/core/compliance/kyc/submit', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify({ userId: 1, documentType: 'CPF' }),
    });

  it('rejects request without X-Identity-Signature header', async () => {
    const res = await app.fetch(
      makeRequest({
        'X-Identity-DID': 'did:dao:asppibra:test_user',
        'X-Identity-Timestamp': validTimestamp,
      }),
      baseEnv as any,
      { waitUntil: () => {}, passThroughOnException: () => {} } as any
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as any;
    expect(body.success).toBe(false);
    expect(body.message).toContain('Missing Zero-Trust credentials');
  });

  it('rejects request without X-Identity-DID header', async () => {
    const res = await app.fetch(
      makeRequest({
        'X-Identity-Signature': 'dGVzdA==',
        'X-Identity-Timestamp': validTimestamp,
      }),
      baseEnv as any,
      { waitUntil: () => {}, passThroughOnException: () => {} } as any
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as any;
    expect(body.success).toBe(false);
  });

  it('rejects request without X-Identity-Timestamp header', async () => {
    const res = await app.fetch(
      makeRequest({
        'X-Identity-Signature': 'dGVzdA==',
        'X-Identity-DID': 'did:dao:asppibra:test_user',
      }),
      baseEnv as any,
      { waitUntil: () => {}, passThroughOnException: () => {} } as any
    );
    expect(res.status).toBe(401);
  });

  it('rejects request with expired timestamp (> 5 min)', async () => {
    const expiredTimestamp = (Date.now() - 6 * 60 * 1000).toString(); // 6 min atrás
    const res = await app.fetch(
      makeRequest({
        'X-Identity-Signature': 'dGVzdA==',
        'X-Identity-DID': 'did:dao:asppibra:test_user',
        'X-Identity-Timestamp': expiredTimestamp,
        'X-Identity-Nonce': 'nonce_expired_123',
      }),
      baseEnv as any,
      { waitUntil: () => {}, passThroughOnException: () => {} } as any
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as any;
    expect(body.message).toContain('expired');
  });

  it('rejects request with invalid DID format (no username at end)', async () => {
    const res = await app.fetch(
      makeRequest({
        'X-Identity-Signature': 'dGVzdA==',
        'X-Identity-DID': 'did:dao:asppibra:', // DID sem username
        'X-Identity-Timestamp': validTimestamp,
        'X-Identity-Nonce': 'nonce_invalid_did_123',
      }),
      baseEnv as any,
      { waitUntil: () => {}, passThroughOnException: () => {} } as any
    );
    expect(res.status).toBe(401);
  });
});
