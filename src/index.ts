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
import { civilIdentityRouter } from './interfaces/http/routes/civil-identity/civil_identity.routes';
import { ssiRouter } from './interfaces/http/routes/ssi/ssi.routes';
import { financeRouter } from './interfaces/http/routes/finance/finance.routes';


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
      defaultSrc: ["'none'"],
      scriptSrc: ["'none'"], // API não executa scripts client-side
      styleSrc: ["'self'"],
      fontSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'https:', 'http:'],
      connectSrc: ["'self'"],
    },
    referrerPolicy: 'no-referrer',
    xFrameOptions: 'DENY',
    xContentTypeOptions: 'nosniff',
    strictTransportSecurity: 'max-age=63072000; includeSubDomains; preload',
    permissionsPolicy: {
      geolocation: ['none'],
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
        'https://api.asppibra.com',
      ];

      // Se for ambiente de desenvolvimento, permitimos localhost
      if (c.env?.ENVIRONMENT !== 'production') {
        allowedOrigins.push('http://localhost:3000', 'http://localhost:8787');
      }

      if (!origin) return allowedOrigins[0];

      const cleanOrigin = origin.replace(/\/$/, '');

      if (allowedOrigins.includes(cleanOrigin)) {
        return cleanOrigin;
      }
      
      // Default fallback (block via CORS mismatch)
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
    // Secret Management: Fail Closed
    console.error('CRITICAL: DB Binding is missing.');
    return error(c, 'Database configuration error.', null, 500);
  }
  
  if (!c.env.JWT_SECRET || !c.env.TOTP_ENCRYPTION_KEY) {
    console.error('CRITICAL: Essential security secrets are missing.');
    return error(c, 'Security configuration error.', null, 500);
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
  // FASE 6: Ocultar dados sensíveis e métricas não autorizadas
  return error(c, 'Endpoint desativado por política de segurança.', null, 403);
});

// =================================================================
// 3. API & ROTAS MODULARES CANÔNICAS
// =================================================================

app.route('/api/core/compliance', complianceRouter);
app.route('/api/core/health', healthRouter);
app.route('/api/core/webhooks', webhooksRouter);
app.route('/api/v1/identity', identityRouter);
app.route('/api/v1/civil', civilIdentityRouter);
app.route('/api/v1/ssi', ssiRouter);
app.route('/api/v1/finance', financeRouter);

// =================================================================
// 4. TRATAMENTO DE ERROS & EXPORT
// =================================================================

app.notFound((c) => c.json({ success: false, message: 'Rota não encontrada (404)' }, 404));

app.onError((err, c) => {
  const correlationId = c.get('correlationId') || 'unknown';
  console.error(`🔥 [${correlationId}] Server Error:`, err);
  
  // FASE 6: Ocultar o err.message em produção, retornar apenas o correlationId
  return c.json({ 
    success: false, 
    message: 'Internal Server Error', 
    correlationId 
  }, 500);
});

export { ChatRoomDO } from './infrastructure/durable_objects/ChatRoomDO';
export { app };
export default {
  fetch: app.fetch,
  async queue(batch: MessageBatch<any>, env: Bindings, ctx: ExecutionContext): Promise<void> {
    console.log(`📥 Received queue batch from: ${batch.queue} (${batch.messages.length} messages)`);
    
    for (const message of batch.messages) {
      console.log(`[Queue ${batch.queue}] Processing message ${message.id}, attempt: ${message.attempts}`);
      
      try {
        const payload = message.body;
        
        // Idempotency check: in a real environment, we'd check against KV or D1 using payload.idempotencyKey
        
        if (payload?.type === 'password_reset') {
          // Aqui faria a integração real de email com Resend ou SendPulse
          console.log(`🔒 [DELIVERY] Sending password reset for ${payload.email}`);
          // Mock delivery
          // const emailService = new EmailDeliveryService(env.RESEND_API_KEY);
          // await emailService.sendPasswordReset(payload.email, payload.rawToken);
        }

        message.ack();
      } catch (error) {
        console.error(`❌ [Queue] Failed to process message ${message.id}:`, error);
        
        // DLQ Implementation / Max attempts
        const MAX_ATTEMPTS = 3;
        if (message.attempts >= MAX_ATTEMPTS) {
          console.error(`🚨 [DLQ] Message ${message.id} reached max attempts. Moving to DLQ (or dropping).`);
          message.ack(); // Acknowledging to remove from main queue; in Cloudflare, DLQ is configured at the queue level or we store it in a DLQ table
        } else {
          message.retry();
        }
      }
    }
  },
};
