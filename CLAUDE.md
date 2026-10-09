# Mirrorbase

Electron desktop app that copies a database from a saved source to a saved target. Same stack and
architecture as `lazy-koins` (Nx monorepo, NestJS API running in-process, Angular web, Prisma +
SQLite, Electron shell); when in doubt about a convention, look at how lazy-koins does it.

## Stack

Node 22.23.2, pnpm 11 (not npm), Nx 23 (daemon off, run with `NX_DAEMON=false`), TypeScript 6,
Vitest everywhere (`pnpm test`, not through Nx), NestJS 11 + `@nestjs/cqrs`, Prisma 7 with
`@prisma/adapter-better-sqlite3`, Angular 22 zoneless + spartan.ng + Tailwind v4 (needs
`apps/web/.postcssrc.json`), ngx-translate (`en`, `de-CH`), Zod forms, Electron 42 + electron-builder.
Prefix `mb`, scope `@mirrorbase`, app id `app.mirrorbase.desktop`.

## Commands

```bash
pnpm start:desktop   pnpm build:desktop   pnpm icons   pnpm check
pnpm test            pnpm test:integration (needs a real PostgreSQL via psql/pg_dump)
pnpm db:deploy       pnpm db:migrate (authors a migration)
```

## Layout

```
libs/db-plugin/        the plugin CONTRACT (pure TS, no framework): DatabasePlugin, field descriptors,
                       HostContext, PluginError, planTransfer, interchange types, redaction
libs/plugin-postgres/  psql/pg_dump, local or in a Docker postgres image
libs/plugin-sqlite/    better-sqlite3 backup API, atomic rename, integrity check
apps/api/              NestJS: pin/ plugins/ connections/ docker/ logs/ replication/ persistence/ integrations/
apps/web/              Angular UI, forms rendered from plugin field descriptors
apps/desktop/          Electron shell: api-host, app:// protocol proxy, safeStorage key, lock watch
assets/brand/icon.svg  the one icon source (pnpm icons)
legacy/                the original PowerShell script, reference only
```

## Plugins

A database type is a `DatabasePlugin` (`libs/db-plugin`). The **only** place a type is named is
`apps/api/src/plugins/plugins.module.ts`. Nothing else may import a concrete plugin; the web app
learns the fields, labels and capabilities from `GET /api/plugins`. Adding a type = a new
`libs/plugin-<id>`, one registry line, a conformance run (`plugins.conformance.spec.ts`).

`planTransfer(source, target)` returns `native` (same type), `interchange` (different types, future,
via the neutral types in `interchange.ts`) or `unsupported`. Only `native` is implemented.
Plugins get everything from `HostContext` (run process, docker, work dir, cancel signal); they never
touch the network or the database of the app itself.

## Secrets and PIN

- Saved passwords are sealed with `SecretBox` (AES-256-GCM, `enc:v1:`). The key is protected by the
  OS keychain (Electron `safeStorage`), fallback an owner-only file. Passwords reach tools by
  environment (`PGPASSWORD`), never in arguments. All log text goes through `redactSecrets` /
  `redactConnectionStrings`.
- PIN: scrypt hash, 4-8 digits, growing wait after wrong attempts, in-memory unlock sessions with a
  sliding expiry (header `x-mirrorbase-unlock`). 423 `pinNotSet` / `pinLocked`. "Forgot PIN"
  erases every saved password. The desktop locks on OS lock, suspend and idle (`LockWatch`).
- The API listens on 127.0.0.1 only, with a per-launch access token; the window talks to it through
  the `app://mirrorbase` protocol (same origin, strict CSP).

## Rules

- Nothing outside `src/persistence/` imports Prisma; ports are abstract classes; handlers hold logic.
- Every visible string is a key in BOTH `en.json` and `de-CH.json`.
- Colours only in `apps/web/src/styles.css`. Never hardcode design values.
- Names containing `=` or a URI scheme are refused by the postgres plugin; keep quoting in `sql.ts`.
- Every bug fix gets a regression test. The gate is `pnpm check`; add checks there, not to CI alone.
- Never commit `.data/`, `*.db`, dumps (`postgres_backups_*`) or `.env`. The pre-commit hook blocks them.

## Not built / open

Creating a new local Docker container (the old script did), cross-engine copy, keeping dump files,
CI workflows and Dockerfiles, code signing and auto-update.

## Gotchas

- `pkill -f` inside a compound command kills the shell; use `pgrep -x electron | xargs -r kill`.
- better-sqlite3 must have a prebuilt binary for Electron's ABI (Electron is pinned for that);
  the desktop gets its own copy in `dist/apps/desktop-app`.
- Docker 29 reports "failed to connect to the docker API"; `DOCKER_DOWN` in `plugin-postgres/client.ts` matches it.
