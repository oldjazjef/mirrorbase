import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { type DesktopLocale, isDesktopLocale } from './messages';

/** The database file inside the data folder. */
export const DATABASE_FILE = 'dbreplicator.db';
/** Where the shell's own settings live: in userData, never in the data folder itself. */
export const CONFIG_FILE = 'desktop-config.json';

export interface DesktopConfig {
  /** The app's language for menus and dialogs; absent = the system's. */
  locale?: DesktopLocale;
}

export function defaultDataDir(userData: string): string {
  return join(userData, 'data');
}

export function readConfig(userData: string): DesktopConfig {
  try {
    const raw: unknown = JSON.parse(
      readFileSync(join(userData, CONFIG_FILE), 'utf8'),
    );
    if (raw && typeof raw === 'object') {
      const locale = (raw as Record<string, unknown>)['locale'];
      return isDesktopLocale(locale) ? { locale } : {};
    }
  } catch {
    // Missing or unreadable: the defaults.
  }
  return {};
}

/** Written to a temporary file first, so a crash never leaves half a config behind. */
export function writeConfig(userData: string, config: DesktopConfig): void {
  mkdirSync(userData, { recursive: true });
  const target = join(userData, CONFIG_FILE);
  const temp = `${target}.tmp`;
  writeFileSync(temp, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  renameSync(temp, target);
}

/** The data folder for this start: `DR_DATA_DIR` (tests, a portable setup), else `<userData>/data`. */
export function resolveDataDir(
  userData: string,
  env: Record<string, string | undefined> = {},
): string {
  const override = env['DR_DATA_DIR'];
  if (override && override.trim().length > 0) return resolve(override.trim());
  return defaultDataDir(userData);
}

export function hasDatabase(dir: string): boolean {
  return existsSync(join(dir, DATABASE_FILE));
}
