import { resolve } from 'node:path';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/**
 * Integration tests — the ones that talk to a real SQLite file with the real migrations, and to
 * real database servers where one is available. A separate config rather than a flag on the main
 * one: `pnpm test` must pass with nothing installed, while these need the migrated test database
 * (`pnpm ci:integration` prepares it). Same SWC setup as vitest.config.ts, for the same reason.
 *
 * Paths are relative to the **repo root** (`pnpm test:integration` passes `--config` from there).
 */
export default defineConfig({
  cacheDir: 'node_modules/.vite/apps/api-integration',
  resolve: {
    alias: {
      '@mirrorbase/db-plugin': resolve('libs/db-plugin/src/index.ts'),
      '@mirrorbase/plugin-postgres': resolve(
        'libs/plugin-postgres/src/index.ts',
      ),
      '@mirrorbase/plugin-sqlite': resolve('libs/plugin-sqlite/src/index.ts'),
    },
  },
  plugins: [
    swc.vite({
      module: { type: 'es6' },
      jsc: {
        target: 'es2022',
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
    }),
  ],
  test: {
    name: 'api-integration',
    environment: 'node',
    globals: true,
    include: ['apps/api/src/**/*.integration.spec.ts'],
    fileParallelism: false,
    passWithNoTests: false,
  },
});
