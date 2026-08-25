import { MiddlewareHandler } from 'hono';

export const correlationIdMiddleware = (): MiddlewareHandler => {
  return async (c, next) => {
    let correlationId = c.req.header('X-Correlation-ID');
    if (!correlationId) {
      correlationId = crypto.randomUUID();
    }
    c.set('correlationId', correlationId);
    c.header('X-Correlation-ID', correlationId);
    await next();
  };
};
