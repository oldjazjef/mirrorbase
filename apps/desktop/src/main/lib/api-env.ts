import { join } from 'node:path';
import { DATABASE_FILE } from './storage';

/**
 * The environment the in-process API boots with (validated by apps/api/src/config/env.ts).
 * `MB_IGNORE_ENV_FILE` keeps a stray `.env` in the working directory out.
 */
export function desktopApiEnv(options: {
  dataDir: string;
  encryptionKey: string;
  /** Where dump files are staged during a run. */
  workDir: string;
}): Record<string, string> {
  return {
    NODE_ENV: 'production',
    DATABASE_URL: `file:${join(options.dataDir, DATABASE_FILE)}`,
    SETTINGS_ENCRYPTION_KEY: options.encryptionKey,
    WORK_DIR: options.workDir,
    // The window talks to the API through the app:// proxy, never cross-origin.
    CORS_ORIGINS: '',
    API_DOCS: 'false',
    MB_IGNORE_ENV_FILE: 'true',
  };
}
