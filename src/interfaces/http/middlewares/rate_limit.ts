import { Context, Next } from 'hono';

interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
}

// In-memory store (funciona por isolate no Cloudflare Workers)
// Para uma solução distribuída real, usar KV, Durable Objects ou Redis.
const store = new Map<string, { count: number; resetTime: number }>();

export interface RateLimiterProvider {
  isAllowed(
    ip: string,
    config: RateLimitConfig
  ): Promise<{ allowed: boolean; retryAfter?: number }>;
}

class MemoryProvider implements RateLimiterProvider {
  private store = new Map<string, { count: number; resetTime: number }>();

  async isAllowed(ip: string, config: RateLimitConfig) {
    const now = Date.now();
    let record = this.store.get(ip);

    if (!record || record.resetTime < now) {
      record = { count: 1, resetTime: now + config.windowMs };
      this.store.set(ip, record);
    } else {
      record.count++;
    }

    if (record.count > config.maxRequests) {
      return { allowed: false, retryAfter: Math.ceil((record.resetTime - now) / 1000) };
    }
    return { allowed: true };
  }
}

class KVProvider implements RateLimiterProvider {
  constructor(private kv: any) {}

  async isAllowed(ip: string, config: RateLimitConfig) {
    const now = Date.now();
    const key = `ratelimit:${ip}`;

    const data = await this.kv.get(key, 'json');
    let record = data ? (data as { count: number; resetTime: number }) : null;

    if (!record || record.resetTime < now) {
      record = { count: 1, resetTime: now + config.windowMs };
    } else {
      record.count++;
    }

    if (record.count > config.maxRequests) {
      return { allowed: false, retryAfter: Math.ceil((record.resetTime - now) / 1000) };
    }

    // TTL for KV
    await this.kv.put(key, JSON.stringify(record), {
      expirationTtl: Math.ceil(config.windowMs / 1000),
    });
    return { allowed: true };
  }
}

const memoryProvider = new MemoryProvider();

export const rateLimit = (config: RateLimitConfig) => {
  return async (c: Context, next: Next) => {
    const ip = c.req.header('cf-connecting-ip') || 'unknown';

    // Use KV if available, else Memory
    const provider = c.env.KV_CACHE ? new KVProvider(c.env.KV_CACHE) : memoryProvider;

    const result = await provider.isAllowed(ip, config);

    if (!result.allowed) {
      return c.json(
        {
          success: false,
          message: 'Too Many Requests',
          retryAfter: result.retryAfter,
        },
        429
      );
    }

    await next();
  };
};

export const idempotency = () => {
  return async (c: Context, next: Next) => {
    const idempotencyKey = c.req.header('Idempotency-Key');
    if (idempotencyKey && c.env.KV_CACHE) {
      const key = `idempotency:${idempotencyKey}`;
      const exists = await c.env.KV_CACHE.get(key);
      if (exists) {
        return c.json({ success: true, message: 'Request already processed (Idempotency)' }, 200);
      }
      await c.env.KV_CACHE.put(key, '1', { expirationTtl: 86400 }); // 24 hours
    }
    await next();
  };
};
