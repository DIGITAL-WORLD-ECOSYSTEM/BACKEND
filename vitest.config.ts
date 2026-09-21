import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['node_modules/**'],
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@dao/shared': path.resolve(__dirname, '../packages/shared/src'),
      'cloudflare:workers': path.resolve(__dirname, 'src/infrastructure/testing/cloudflare-workers.ts'),
    },
  },
});
