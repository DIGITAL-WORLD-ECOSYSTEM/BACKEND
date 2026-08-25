import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  // Onde está o arquivo TypeScript com a definição das tabelas
  schema: './src/db/schema.ts',

  // Onde os arquivos .sql gerados serão salvos
  out: './migrations',

  // O D1 usa dialeto SQLite
  dialect: 'sqlite',

  // Driver específico para Cloudflare D1
  driver: 'd1-http',

  // Credenciais para conectar ao D1 (lê do wrangler.jsonc)
  dbCredentials: {
    accountId: '5d91807e648c183cb7833caa06dbcbdb', // Seu Account ID real
    databaseId: 'cfd0e171-f2b5-48d4-bf29-a9cf33d97b4d', // Sincronizado com w3-db no wrangler.toml
    token: '', // Deixe vazio para rodar localmente com npx wrangler
  },

  // Opções extras para desenvolvimento seguro
  verbose: true,
  strict: true,
});
