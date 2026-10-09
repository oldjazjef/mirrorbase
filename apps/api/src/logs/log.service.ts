import { Injectable, Logger } from '@nestjs/common';
import {
  redactConnectionStrings,
  redactSecrets,
} from '@dbreplicator/db-plugin';
import type { LogCriteria, LogEntry, LogLevel } from './domain/log-entry';
import { LogRepositoryPort } from './ports/log.repository.port';

const MAX_MESSAGE_CHARS = 4_000;
/** Log lines older than this are pruned at start-up. */
export const LOG_RETENTION_DAYS = 90;

/**
 * Appends to the log. Every message passes `redactSecrets` and `redactConnectionStrings` before
 * it is stored, so a password that leaks into a tool's error text still never reaches the file.
 */
@Injectable()
export class LogService {
  private readonly logger = new Logger(LogService.name);

  constructor(private readonly entries: LogRepositoryPort) {}

  /** A writer for one run (or the app): ordered, redacting, never throwing. */
  writer(runId: string | null, secrets: readonly string[] = []): LogWriter {
    return new LogWriter(this.entries, this.logger, runId, secrets);
  }

  list(criteria: LogCriteria): Promise<LogEntry[]> {
    return this.entries.list(criteria);
  }

  async pruneOld(now: Date = new Date()): Promise<number> {
    const before = new Date(now.getTime() - LOG_RETENTION_DAYS * 86_400_000);
    return this.entries.prune(before);
  }
}

export class LogWriter {
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private readonly entries: LogRepositoryPort,
    private readonly logger: Logger,
    private readonly runId: string | null,
    private readonly secrets: readonly string[],
  ) {}

  write(level: LogLevel, message: string): void {
    const clean = redactConnectionStrings(redactSecrets(message, this.secrets));
    const text =
      clean.length > MAX_MESSAGE_CHARS
        ? `${clean.slice(0, MAX_MESSAGE_CHARS)} ... (${clean.length - MAX_MESSAGE_CHARS} more characters)`
        : clean;
    // Sequential: lines of one run must keep their order in the table.
    this.chain = this.chain
      .then(() =>
        this.entries.append([{ runId: this.runId, level, message: text }]),
      )
      .catch((error: unknown) => {
        this.logger.error(`Could not write a log entry: ${String(error)}`);
      });
  }

  /** Resolves once everything written so far is stored. */
  flush(): Promise<void> {
    return this.chain;
  }
}
