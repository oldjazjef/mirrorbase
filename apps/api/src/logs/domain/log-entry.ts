export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export interface LogEntry {
  readonly id: number;
  /** null = an app-level entry (start-up, a connection test). */
  readonly runId: string | null;
  readonly level: LogLevel;
  readonly message: string;
  readonly at: string;
}

export interface NewLogEntry {
  readonly runId: string | null;
  readonly level: LogLevel;
  readonly message: string;
}

export interface LogCriteria {
  readonly runId?: string;
  /** Only app-level entries (no run). */
  readonly appOnly?: boolean;
  /** This level and worse. */
  readonly minLevel?: LogLevel;
  /** Entries after this id (polling). */
  readonly afterId?: number;
  /** Newest-first page cursor: entries before this id. */
  readonly beforeId?: number;
  readonly limit: number;
}

/** `warn` and `error` are the levels that need attention. */
export function levelsFrom(minLevel: LogLevel): LogLevel[] {
  return LOG_LEVELS.slice(LOG_LEVELS.indexOf(minLevel));
}
