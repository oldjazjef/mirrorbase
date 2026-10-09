import { delimiter } from 'node:path';

/**
 * A desktop app does not get the PATH of a terminal. On macOS (started from Finder) and on Linux
 * (started from a menu) it is a bare minimum, without the folders where `docker` and `psql` live,
 * so "Docker is not installed" would be reported on a machine that has it. These are the usual
 * places; they are added AFTER the existing PATH, so nothing the system provides is shadowed.
 * Windows already has the right PATH (Docker Desktop and the PostgreSQL installer add themselves).
 */
const EXTRA_DIRS: Readonly<Record<string, readonly string[]>> = {
  darwin: [
    '/usr/local/bin',
    '/opt/homebrew/bin',
    '/opt/homebrew/opt/libpq/bin',
    '/usr/local/opt/libpq/bin',
    '/Applications/Postgres.app/Contents/Versions/latest/bin',
    '/Applications/Docker.app/Contents/Resources/bin',
  ],
  linux: [
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    '/snap/bin',
    '/usr/lib/postgresql/latest/bin',
  ],
};

export function extendedPath(
  current: string | undefined,
  platform: string,
  separator: string = delimiter,
): string {
  const existing = (current ?? '')
    .split(separator)
    .filter((part) => part.length > 0);
  const extra = (EXTRA_DIRS[platform] ?? []).filter(
    (dir) => !existing.includes(dir),
  );
  return [...existing, ...extra].join(separator);
}
