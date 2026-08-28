import { describe, it, expect } from 'vitest';
import { app } from '../../../../index';

describe('Backend Health Check', () => {
  it('should return 200 OK on /api/core/health/health', async () => {
    // Mocking Cloudflare Bindings for Hono
    const res = await app.fetch(
      new Request('http://localhost/api/core/health/health'),
      {
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
        KV_AUTH: {},
        KV_CACHE: {},
        STORAGE: {},
        JWT_SECRET: 'test_jwt_secret_32_bytes_min_length',
        TOTP_ENCRYPTION_KEY: 'test_totp_key_32_bytes_min_length_123',
      } as any,
      { waitUntil: () => {}, passThroughOnException: () => {} } as any
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('status', 'ok');
  });
});
