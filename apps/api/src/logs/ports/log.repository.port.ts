import type { LogCriteria, LogEntry, NewLogEntry } from '../domain/log-entry';

export abstract class LogRepositoryPort {
  abstract append(entries: readonly NewLogEntry[]): Promise<void>;
  /** Oldest first when `afterId` is given (polling), newest first otherwise. */
  abstract list(criteria: LogCriteria): Promise<LogEntry[]>;
  /** Deletes entries older than `before`; returns how many. */
  abstract prune(before: Date): Promise<number>;
}
