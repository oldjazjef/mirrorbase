import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  cacheDir: '../../node_modules/.vite/libs/plugin-sqlite',
  // Workspace libs are consumed through the tsconfig path alias; Vitest needs it spelled out.
  resolve: {
    alias: {
      '@dbreplicator/db-plugin': resolve(
        __dirname,
        '../db-plugin/src/index.ts',
      ),
    },
  },
  test: {
    name: 'plugin-sqlite',
    environment: 'node',
    globals: true,
    include: ['src/**/*.spec.ts'],
    passWithNoTests: false,
  },
});
