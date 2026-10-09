/**
 * The API's response shapes, mirrored by hand (generating them from /api/openapi.json is an open
 * decision, see CLAUDE.md). Timestamps are ISO 8601 strings.
 */

// --- plugins ---

export interface LocalizedText {
  readonly en: string;
  readonly 'de-CH'?: string;
}

export const FIELD_TYPES = [
  'text',
  'number',
  'password',
  'path',
  'select',
  'boolean',
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export type FieldValue = string | number | boolean;

export interface FieldOption {
  readonly value: string;
  readonly label: LocalizedText;
}

/** One connection setting a database plugin declares - the form is drawn from these. */
export interface FieldDescriptor {
  readonly key: string;
  readonly type: FieldType;
  readonly label: LocalizedText;
  readonly help?: LocalizedText;
  readonly placeholder?: string;
  readonly required?: boolean;
  readonly secret?: boolean;
  readonly default?: FieldValue;
  readonly options?: readonly FieldOption[];
  readonly min?: number;
  readonly max?: number;
  readonly advanced?: boolean;
}

export interface PluginCapabilities {
  readonly canBeSource: boolean;
  readonly canBeTarget: boolean;
  readonly multipleDatabases: boolean;
  readonly dockerDiscovery: boolean;
}

export interface Plugin {
  readonly id: string;
  readonly name: string;
  readonly description: LocalizedText;
  readonly version: string;
  readonly icon: string;
  readonly capabilities: PluginCapabilities;
  readonly fields: readonly FieldDescriptor[];
  readonly dumpFormat: string;
}

export const TRANSFER_KINDS = ['native', 'interchange', 'unsupported'] as const;
export type TransferKind = (typeof TRANSFER_KINDS)[number];

export const TRANSFER_REASONS = [
  'sourceCannotBeSource',
  'targetCannotBeTarget',
  'crossEngineUnavailable',
] as const;
export type TransferReason = (typeof TRANSFER_REASONS)[number];

export interface TransferPlan {
  readonly kind: TransferKind;
  readonly reason?: TransferReason;
}

// --- connections ---

export type ConnectionConfig = Readonly<Record<string, FieldValue | undefined>>;

export interface Connection {
  readonly id: string;
  readonly name: string;
  readonly pluginId: string;
  readonly config: ConnectionConfig;
  /** Keys of the password fields that have a saved value (never the values). */
  readonly secretKeys: readonly string[];
  readonly dockerName: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lastUsedAt: string | null;
}

export interface ConnectionInput {
  readonly name: string;
  readonly pluginId: string;
  readonly config: Record<string, FieldValue>;
  readonly secrets: Record<string, string>;
  readonly dockerName?: string;
}

export interface ConnectionUpdate {
  readonly name: string;
  readonly config: Record<string, FieldValue>;
  /** New passwords only; absent = keep. */
  readonly secrets: Record<string, string>;
  readonly clearSecrets: readonly string[];
}

export interface TestRequest {
  readonly pluginId: string;
  readonly config: Record<string, FieldValue>;
  readonly secrets: Record<string, string>;
  readonly connectionId?: string;
  readonly role: 'source' | 'target';
}

export interface TestResult {
  readonly ok: boolean;
  readonly serverVersion?: string;
  readonly message?: string;
  /** Set when the test could not run (`clientToolsMissing`). */
  readonly code?: string;
}

// --- docker ---

export const DOCKER_REASONS = ['notInstalled', 'notRunning'] as const;
export type DockerReason = (typeof DOCKER_REASONS)[number];

export interface DockerDatabase {
  readonly pluginId: string;
  readonly pluginName: string;
  readonly containerId: string;
  readonly containerName: string;
  readonly name: string;
  readonly config: Readonly<Record<string, FieldValue>>;
  readonly summary: string;
  readonly savedConnectionId: string | null;
}

export interface DockerDatabases {
  readonly available: boolean;
  readonly reason: DockerReason | null;
  readonly items: readonly DockerDatabase[];
}

// --- runs ---

export const RUN_STATUSES = [
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const DATABASE_STATUSES = [
  'pending',
  'dumping',
  'restoring',
  'done',
  'failed',
  'cancelled',
] as const;
export type DatabaseStatus = (typeof DATABASE_STATUSES)[number];

export interface RunDatabase {
  readonly source: string;
  readonly target: string;
  readonly status: DatabaseStatus;
  readonly bytes: number | null;
  readonly warnings: number;
  readonly errorCode: string | null;
  readonly error: string | null;
}

export interface Run {
  readonly id: string;
  readonly status: RunStatus;
  readonly sourceConnectionId: string | null;
  readonly targetConnectionId: string | null;
  readonly sourceName: string;
  readonly targetName: string;
  readonly sourcePluginId: string;
  readonly targetPluginId: string;
  readonly strategy: 'native' | 'interchange';
  readonly replaceExisting: boolean;
  readonly databases: readonly RunDatabase[];
  readonly error: string | null;
  readonly createdAt: string;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
}

export interface StartRunRequest {
  readonly sourceId: string;
  readonly targetId: string;
  readonly databases: readonly { source: string; target: string }[];
  readonly replaceExisting: boolean;
}

export function isActiveRun(status: RunStatus): boolean {
  return status === 'queued' || status === 'running';
}

// --- log ---

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export interface LogEntry {
  readonly id: number;
  readonly runId: string | null;
  readonly level: LogLevel;
  readonly message: string;
  readonly at: string;
}

// --- PIN ---

export interface PinStatus {
  readonly hasPin: boolean;
  readonly unlocked: boolean;
  readonly expiresAt: string | null;
  readonly autoLockMinutes: number;
  readonly failedAttempts: number;
  readonly retryAfterSeconds: number;
}

export interface PinUnlocked {
  readonly status: PinStatus;
  readonly token: string;
  readonly expiresAt: string;
}

export interface PinReset {
  readonly status: PinStatus;
  readonly erasedSecrets: number;
}

export interface VersionInfo {
  readonly version: string;
  readonly commit: string;
  readonly full: string;
  readonly builtAt: string | null;
}
