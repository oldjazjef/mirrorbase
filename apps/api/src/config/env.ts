import { plainToInstance, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsString,
  IsUrl,
  Matches,
  Max,
  Min,
  validateSync,
} from 'class-validator';

export enum NodeEnv {
  Development = 'development',
  Test = 'test',
  Production = 'production',
}

/**
 * The API listens on the loopback interface ONLY. There is one user — the person at this
 * computer — and the PIN lock, not a login, is what protects the data; nothing here is meant to
 * be reachable from another machine. (The desktop shell additionally passes a per-launch access
 * token, see bootstrap.ts.)
 */
export const LOCAL_HOST = '127.0.0.1';

/**
 * Every environment variable the API reads, in one place.
 *
 * Validation runs once at boot and throws — the process must not start half-configured. Read it
 * through `ConfigService<Env, true>` with `{ infer: true }`, never `process.env`.
 *
 * Non-string values carry an explicit `@Type(() => Number)` rather than relying on implicit
 * conversion, which needs `design:type` metadata that differs between the webpack build and the
 * SWC transform Vitest uses.
 */
export class Env {
  @IsEnum(NodeEnv)
  NODE_ENV: NodeEnv = NodeEnv.Development;

  /** 3333, not 3000: port 3000 is commonly taken on development machines. */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT = 3333;

  /**
   * SQLite file: `file:./.data/dbreplicator.db` (relative = against the working directory).
   * Checked here so a leftover `postgres://` URL fails at boot with a clear message rather than
   * at the first query.
   */
  @IsString()
  @Matches(/^file:.+/, {
    message:
      'DATABASE_URL must be a SQLite file URL, e.g. file:./.data/dbreplicator.db',
  })
  DATABASE_URL!: string;

  /** Comma-separated list of allowed browser origins. The default covers the dev server. */
  @IsString()
  CORS_ORIGINS = 'http://localhost:4200';

  /** Public base URL of this API, used as the OpenAPI server entry. */
  @IsUrl({ require_tld: false })
  PUBLIC_API_URL = 'http://localhost:3333';

  /**
   * Encrypts the passwords saved with a connection (AES-256-GCM, key = SHA-256 of this string).
   * The desktop app generates its own key, keeps it in the OS keychain where there is one, and
   * passes it here. Empty = no password can be saved (connections without one still work).
   */
  @IsString()
  SETTINGS_ENCRYPTION_KEY = '';

  /** Where dump files are staged during a run. Empty = the OS temp directory. */
  @IsString()
  WORK_DIR = '';

  /** `true` / `false` forces the OpenAPI reference on or off; empty = on outside production. */
  @IsString()
  API_DOCS = '';
}

export function validateEnv(raw: Record<string, unknown>): Env {
  const env = plainToInstance(Env, raw, {
    enableImplicitConversion: true,
    exposeDefaultValues: true,
  });

  const errors = validateSync(env, {
    skipMissingProperties: false,
    whitelist: false,
  });
  const messages = errors.map(
    (error) =>
      `  ${error.property}: ${Object.values(error.constraints ?? {}).join(', ')}`,
  );

  if (messages.length > 0) {
    throw new Error(
      `Invalid environment configuration:\n${messages.join('\n')}`,
    );
  }

  return env;
}

/** Whether to serve the OpenAPI document and the API reference. */
export function apiDocsEnabled(
  env: Pick<Env, 'API_DOCS' | 'NODE_ENV'>,
): boolean {
  return env.API_DOCS === ''
    ? env.NODE_ENV !== NodeEnv.Production
    : env.API_DOCS === 'true';
}
