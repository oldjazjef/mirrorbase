import {
  levelsFrom,
  type LogCriteria,
  type LogEntry,
  type NewLogEntry,
} from '../domain/log-entry';
import { LogRepositoryPort } from '../ports/log.repository.port';

/** A real implementation of the port, in memory - what handler specs run against. */
export class InMemoryLogRepository extends LogRepositoryPort {
  readonly entries: LogEntry[] = [];
  private nextId = 1;

  append(entries: readonly NewLogEntry[]): Promise<void> {
    for (const entry of entries) {
      this.entries.push({
        id: this.nextId++,
        ...entry,
        at: new Date().toISOString(),
      });
    }
    return Promise.resolve();
  }

  list(criteria: LogCriteria): Promise<LogEntry[]> {
    const polling = criteria.afterId !== undefined;
    const matching = this.entries
      .filter((entry) => !criteria.runId || entry.runId === criteria.runId)
      .filter((entry) => !criteria.appOnly || entry.runId === null)
      .filter(
        (entry) =>
          !criteria.minLevel ||
          levelsFrom(criteria.minLevel).includes(entry.level),
      )
      .filter(
        (entry) =>
          criteria.afterId === undefined || entry.id > criteria.afterId,
      )
      .filter(
        (entry) =>
          criteria.beforeId === undefined || entry.id < criteria.beforeId,
      )
      .sort((a, b) => (polling ? a.id - b.id : b.id - a.id));
    return Promise.resolve(matching.slice(0, criteria.limit));
  }

  prune(before: Date): Promise<number> {
    const kept = this.entries.filter(
      (entry) => Date.parse(entry.at) >= before.getTime(),
    );
    const removed = this.entries.length - kept.length;
    this.entries.splice(0, this.entries.length, ...kept);
    return Promise.resolve(removed);
  }

  messages(runId?: string | null): string[] {
    return this.entries
      .filter((entry) => runId === undefined || entry.runId === runId)
      .map((entry) => entry.message);
  }
}
