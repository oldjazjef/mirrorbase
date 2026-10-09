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

/** How the data travels - see `planTransfer` in @dbreplicator/db-plugin. */
export type RunStrategy = 'native' | 'interchange';

/** One database of a run: where it comes from, where it goes, how far it got. */
export interface RunDatabase {
  readonly source: string;
  readonly target: string;
  readonly status: DatabaseStatus;
  /** Size of the dump, once taken. */
  readonly bytes: number | null;
  /** Non-fatal findings of the restore (tools print harmless errors for missing roles). */
  readonly warnings: number;
  /** The plugin's error code (`targetExists`, `connectionFailed`, …). */
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
  readonly strategy: RunStrategy;
  readonly replaceExisting: boolean;
  readonly databases: readonly RunDatabase[];
  readonly error: string | null;
  readonly createdAt: string;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
}

export interface NewRun {
  readonly sourceConnectionId: string;
  readonly targetConnectionId: string;
  readonly sourceName: string;
  readonly targetName: string;
  readonly sourcePluginId: string;
  readonly targetPluginId: string;
  readonly strategy: RunStrategy;
  readonly replaceExisting: boolean;
  readonly databases: readonly RunDatabase[];
}

export interface RunPatch {
  readonly status?: RunStatus;
  readonly databases?: readonly RunDatabase[];
  readonly error?: string | null;
  readonly startedAt?: Date;
  readonly finishedAt?: Date;
}

export function isActive(status: RunStatus): boolean {
  return status === 'queued' || status === 'running';
}

/** What the run ended as, from how each database ended. */
export function finalStatus(
  databases: readonly RunDatabase[],
  cancelled: boolean,
): { status: RunStatus; error: string | null } {
  const failed = databases.filter((d) => d.status === 'failed').length;
  const done = databases.filter((d) => d.status === 'done').length;
  if (cancelled) {
    return { status: 'cancelled', error: null };
  }
  if (failed === 0) return { status: 'succeeded', error: null };
  return {
    status: 'failed',
    error: `${failed} of ${databases.length} database${databases.length === 1 ? '' : 's'} failed (${done} copied)`,
  };
}

/** The same server and the same settings: copying onto itself would destroy the source. */
export function sameEndpoint(
  a: { pluginId: string; config: Readonly<Record<string, unknown>> },
  b: { pluginId: string; config: Readonly<Record<string, unknown>> },
): boolean {
  if (a.pluginId !== b.pluginId) return false;
  return canonical(a.config) === canonical(b.config);
}

function canonical(config: Readonly<Record<string, unknown>>): string {
  const entries = Object.entries(config)
    .map(([key, value]) => [key, normalizeValue(value)] as const)
    .sort(([x], [y]) => x.localeCompare(y));
  return JSON.stringify(entries);
}

function normalizeValue(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const text = value.trim().toLowerCase();
  return text === '127.0.0.1' || text === '::1' ? 'localhost' : text;
}
