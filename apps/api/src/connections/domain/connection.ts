import type {
  ConnectionConfig,
  DatabasePlugin,
  FieldValue,
} from '@dbreplicator/db-plugin';

export const MAX_NAME_LENGTH = 80;

/** A saved connection as the rest of the app sees it: no secrets, only which ones are set. */
export interface Connection {
  readonly id: string;
  readonly name: string;
  readonly pluginId: string;
  readonly config: ConnectionConfig;
  /** Keys of the secret fields that have a saved value - never the values. */
  readonly secretKeys: readonly string[];
  /** The Docker container it was created from, informational. */
  readonly dockerName: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lastUsedAt: string | null;
}

/** What the repository stores and returns. Only the connection handlers see the sealed values. */
export interface StoredConnection extends Connection {
  /** Secret field key → `enc:v1:…`. */
  readonly sealedSecrets: Readonly<Record<string, string>>;
}

export interface NewConnection {
  readonly name: string;
  readonly pluginId: string;
  readonly config: ConnectionConfig;
  readonly sealedSecrets: Readonly<Record<string, string>>;
  readonly dockerName: string | null;
}

export interface ConnectionPatch {
  readonly name?: string;
  readonly config?: ConnectionConfig;
  readonly sealedSecrets?: Readonly<Record<string, string>>;
}

/** Thrown by the repository when `name` is taken. */
export class ConnectionNameTakenError extends Error {
  constructor(readonly connectionName: string) {
    super(`A connection named "${connectionName}" exists already`);
  }
}

export function cleanName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

/**
 * Keeps only the plugin's declared, non-secret fields and gives each its declared type. The API
 * accepts arbitrary JSON for `config`; this is what makes it the plugin's shape.
 */
export function normalizeConfig(
  plugin: DatabasePlugin,
  input: Readonly<Record<string, unknown>>,
): ConnectionConfig {
  const result: Record<string, FieldValue> = {};
  for (const field of plugin.connectionFields) {
    if (field.secret) continue;
    const raw = input[field.key];
    if (raw === undefined || raw === null || raw === '') continue;
    if (field.type === 'number') {
      const number = typeof raw === 'number' ? raw : Number(raw);
      result[field.key] = Number.isFinite(number) ? number : String(raw);
    } else if (field.type === 'boolean') {
      result[field.key] = raw === true || raw === 'true';
    } else if (typeof raw === 'string') {
      result[field.key] = raw.trim();
    } else if (typeof raw === 'number' || typeof raw === 'boolean') {
      result[field.key] = String(raw);
    }
  }
  return result;
}

/** Keeps only the plugin's declared secret fields, non-empty. */
export function pickSecrets(
  plugin: DatabasePlugin,
  input: Readonly<Record<string, unknown>> | undefined,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const field of plugin.connectionFields) {
    if (!field.secret) continue;
    const raw = input?.[field.key];
    if (typeof raw === 'string' && raw.length > 0) result[field.key] = raw;
  }
  return result;
}
