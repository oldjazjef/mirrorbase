import { resolve } from 'node:path';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/**
 * Vitest for the NestJS app.
 *
 * The SWC plugin is not optional here: esbuild — Vite's default transformer — does not emit
 * `emitDecoratorMetadata`, and without that metadata Nest cannot resolve constructor parameters
 * by type, so every injected dependency arrives as `undefined`. SWC emits it.
 */
export default defineConfig({
  cacheDir: '../../node_modules/.vite/apps/api',
  // Workspace libs are consumed through the tsconfig path alias, as webpack does.
  resolve: {
    alias: {
      '@dbreplicator/db-plugin': resolve(
        __dirname,
        '../../libs/db-plugin/src/index.ts',
      ),
      '@dbreplicator/plugin-postgres': resolve(
        __dirname,
        '../../libs/plugin-postgres/src/index.ts',
      ),
      '@dbreplicator/plugin-sqlite': resolve(
        __dirname,
        '../../libs/plugin-sqlite/src/index.ts',
      ),
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
    name: 'api',
    environment: 'node',
    globals: true,
    include: ['src/**/*.spec.ts'],
    // `*.integration.spec.ts` needs a migrated SQLite file, so it is not part of the default run —
    // `pnpm test` has to stay runnable on a fresh checkout. Run them with `pnpm ci:integration`.
    exclude: ['src/**/*.integration.spec.ts'],
    passWithNoTests: false,
    // `ConfigModule.forRoot` validates the environment when app.module.ts is *imported*.
    // Placeholders only: nothing in the unit suite connects to a database.
    env: {
      DATABASE_URL:
        process.env['DATABASE_URL'] ?? 'file:./tmp/unit-tests-never-opened.db',
    },
  },
});
