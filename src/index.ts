/**
 * Project: Governance System (ASPPIBRA DAO)
 * Role: Central System API & Identity Provider
 * Entry Point: Cloudflare Worker (Hono Framework)
 */

import { Hono, Context, Next } from 'hono';
import { ExecutionContext, ScheduledEvent, MessageBatch } from '@cloudflare/workers-types';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { correlationIdMiddleware } from './interfaces/http/middlewares/correlation_id';
import { Bindings, Variables } from './types/bindings';
import { createDb } from './db';
import { error, success } from './interfaces/http/helpers/response';
import { Logger } from './infrastructure/observability/logger';

// --- CORE MODULES ---
import healthRouter from './interfaces/http/routes/core/health';
import webhooksRouter from './interfaces/http/routes/core/webhooks';
import complianceRouter from './interfaces/http/routes/core/compliance';
import identityRouter from './interfaces/http/routes/identity/identity.routes';

// Configuração de Tipagem do Hono
type AppType = {
  Bindings: Bindings;
  Variables: Variables;
};

const app = new Hono<AppType>();

// =================================================================
// 1. MIDDLEWARES GLOBAIS
// =================================================================

// 1.0 Observabilidade & Security Headers Globais
app.use('*', correlationIdMiddleware());
app.use(
  '*',
  secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'https:', 'http:'],
      connectSrc: ["'self'", 'https://api.asppibra.com', 'https://app.asppibra.com'],
    },
    referrerPolicy: 'no-referrer',
    xFrameOptions: 'DENY',
    xContentTypeOptions: 'nosniff',
    strictTransportSecurity: 'max-age=63072000; includeSubDomains; preload',
    permissionsPolicy: {
      geolocation: ['self'],
      camera: ['none'],
      microphone: ['none'],
    },
  })
);

// 1.1 CORS Dinâmico para suporte a Vercel e Localhost (Hardened)
app.use('/*', async (c: Context<AppType>, next: Next) => {
  const corsMiddleware = cors({
    origin: (origin) => {
      const allowedOrigins = [
        'https://app.asppibra.com',
        'https://www.app.asppibra.com',
        'https://asppibra.com',
        'https://www.asppibra.com',
        'https://api.asppibra.com',
        'https://social-fi-asppibra.vercel.app',
        'https://dashboard.asppibra.com',
      ];

      if (!origin) return allowedOrigins[0];

      const cleanOrigin = origin.replace(/\/$/, '');

      const isExactMatch = allowedOrigins.some((allowed) => allowed === cleanOrigin);
      const allowedRegexes = [
        /^http:\/\/localhost:[0-9]+$/,
        /^https:\/\/[a-zA-Z0-9-]+\.cloudworkstations\.dev$/,
        /^https:\/\/[a-zA-Z0-9-]+\.pages\.dev$/,
      ];
      const isRegexMatch = allowedRegexes.some((regex) => regex.test(cleanOrigin));

      if (isExactMatch || isRegexMatch) {
        return origin;
      }
      return allowedOrigins[0];
    },
    allowHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'X-App-ID',
      'x-admin-key',
      'X-Identity-Signature',
      'X-Identity-DID',
      'X-Identity-Timestamp',
      'X-Correlation-ID',
      'Idempotency-Key',
    ],
    allowMethods: ['POST', 'GET', 'OPTIONS', 'PUT', 'PATCH', 'DELETE'],
    exposeHeaders: ['Content-Length', 'X-Correlation-ID'],
    maxAge: 600,
    credentials: true,
  });
  return corsMiddleware(c, next);
});

// 1.2 Chaos Engineering Middleware (Somente Testes/Dev)
app.use('*', async (c: Context<AppType>, next: Next) => {
  if (c.req.path.match(/\.(css|js|png|jpg|ico|json|map)$/)) {
    return next();
  }

  if (c.env?.ENVIRONMENT !== 'production') {
    if (c.env?.CHAOS_D1_DOWN === 'true' && !c.req.path.startsWith('/api/core/health')) {
      return error(c, 'Simulated D1 Outage', null, 503);
    }
  }

  await next();
});

// 1.3 Database Injection (Scoped)
app.use(async (c: Context<AppType>, next: Next) => {
  if (!c.env.DB) {
    return error(c, 'Binding DB não configurado no wrangler.toml', null, 500);
  }
  const db = createDb(c.env.DB);
  c.set('db', db);
  await next();
});

// =================================================================
// 2. ROTAS DE MONITORAMENTO
// =================================================================

app.get('/', async (c) => {
  return c.json({
    version: '1.1.0',
    service: 'Central System API',
    status: 'healthy',
  });
});

app.get('/api/stats', async (c) => {
  return c.json({ status: 'healthy', uptime: Date.now() });
});

// =================================================================
// 3. API & ROTAS MODULARES CANÔNICAS
// =================================================================

app.route('/api/core/compliance', complianceRouter);
app.route('/api/core/health', healthRouter);
app.route('/api/core/webhooks', webhooksRouter);
app.route('/api/v1/identity', identityRouter);

// =================================================================
// 4. TRATAMENTO DE ERROS & EXPORT
// =================================================================

app.notFound((c) => c.json({ success: false, message: 'Rota não encontrada (404)' }, 404));

app.onError((err, c) => {
  console.error('🔥 Server Error:', err);
  return c.json({ success: false, message: 'Internal Server Error', error: err.message }, 500);
});

export { app };
export default {
  fetch: app.fetch,
};
