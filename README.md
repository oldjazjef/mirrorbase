# Mirrorbase

A small desktop app (Electron) that copies a database from a **source** to a **target**. Saved
connections, passwords kept safe, a log of every run, running Docker databases to pick from, and
the whole app locked behind a PIN.

Phase 1 supports **PostgreSQL** and **SQLite**. Every database type is a plugin, so more can be
added without touching the app. Copying between different database types is planned; the plugin
contract already carries the neutral types for it.

## Run it

```bash
pnpm install
pnpm start:desktop      # builds web + API, stages, starts Electron
pnpm build:desktop      # installer for this OS into dist/desktop
pnpm check              # lint + budget + format + test + build + typecheck
```

PostgreSQL copies need `psql` and `pg_dump` locally, or Docker (the app then runs them in a
`postgres:<version>` image).

## Safety

- Passwords are sealed with AES-256-GCM; the key lives in the OS keychain.
- Passwords never appear on a command line or in the log.
- A PIN (4-8 digits) locks the app; there is no other sign-in. Forgetting it erases all saved passwords.

Developer notes: [CLAUDE.md](CLAUDE.md). The original PowerShell script is kept in [legacy/](legacy/).
