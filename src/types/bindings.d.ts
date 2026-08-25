/**
 * Project: Governance System (ASPPIBRA DAO)
 * Role: Type Definitions for Cloudflare Bindings & Hono Variables
 * Version: 1.1.0
 */
import { D1Database, R2Bucket, Fetcher, KVNamespace, Queue } from '@cloudflare/workers-types';

/**
 * Bindings: Representam os recursos externos da Cloudflare definidos no wrangler.toml
 */
export type Bindings = {
  // 1. Banco de Dados (D1) - Onde residem os usuários e contratos
  DB: D1Database;

  // 2. Armazenamento de Arquivos (R2) - Para imagens de capa e documentos
  STORAGE: R2Bucket;

  // 3. Arquivos Estáticos - Gerenciados pelo Cloudflare Pages/Workers Assets
  ASSETS: Fetcher;

  // 4. Armazenamento de Chave-Valor (KV)
  KV_AUTH: KVNamespace;
  KV_CACHE: KVNamespace;

  // 5. Segredos e Chaves de API
  JWT_SECRET: string;
  ADMIN_PASSWORD: string;
  ZERO_EX_API_KEY: string;
  MORALIS_API_KEY: string;
  BINANCE_API_KEY: string;
  BINANCE_API_SECRET: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  FRONTEND_URL: string;
  DEVELOPER_SSH_KEY?: string;
  JWT_KEY_VERSION?: string;

  // 6. Analytics e Gestão Cloudflare
  CLOUDFLARE_ACCOUNT_ID: string;
  CLOUDFLARE_ZONE_ID: string;
  CLOUDFLARE_API_TOKEN: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  R2_BUCKET_NAME: string;
  R2_PUBLIC_URL: string;
  SENDPULSE_ID: string;
  SENDPULSE_SECRET: string;
  SENDPULSE_API_KEY: string;
  RESEND_API_KEY: string;
  SENDER_EMAIL: string;
  SVIX_SECRET: string;
  ZOHO_APP_PASSWORD: string;
  ZOHO_CLIENT_SECRET: string;
  AI: any;

  // 7. Filas e Armazenamentos (Fase A)
  EMAIL_PIPELINE_QUEUE: Queue<any>;
  CHAT_PIPELINE_QUEUE: Queue<any>;
  R2_EMAIL_ATTACHMENTS: R2Bucket;

  // 8. Durable Objects
  CHAT_ROOM: DurableObjectNamespace;

  // 9. Chaos Engineering & Environment
  ENVIRONMENT?: string;
  CHAOS_D1_DOWN?: string;
  CHAOS_KV_DOWN?: string;
  CHAOS_RESEND_DOWN?: string;
};

/**
 * Variables: Representam os dados injetados no contexto da requisição (c.set / c.get)
 * Essencial para o funcionamento do requireAuth e das rotas protegidas.
 */
export type Variables = {
  user: {
    userId: number;
    role: 'citizen' | 'partner' | 'admin' | 'system' | 'dev' | 'user';
  };
  // Instância do banco injetada no middleware global
  db: import('../db').Database;
  correlationId?: string;
};
