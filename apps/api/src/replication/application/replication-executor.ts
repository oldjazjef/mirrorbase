import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConnectionSecrets } from '../../connections/application/secrets';
import { ConnectionRepositoryPort } from '../../connections/ports/connection.repository.port';
import { LogService } from '../../logs/log.service';
import { PluginHostFactory } from '../../plugins/plugin-host';
import { PluginRegistry } from '../../plugins/plugin-registry';
import { RunRepositoryPort } from '../ports/run.repository.port';
import { runReplication } from './run-replication';

/**
 * Runs replications in the background, one at a time, and lets the user cancel. The HTTP request
 * that starts a run returns at once; the UI polls the run and the log.
 */
@Injectable()
export class ReplicationExecutor implements OnModuleInit {
  private readonly logger = new Logger(ReplicationExecutor.name);
  private readonly active = new Map<string, AbortController>();

  constructor(
    private readonly runs: RunRepositoryPort,
    private readonly connections: ConnectionRepositoryPort,
    private readonly registry: PluginRegistry,
    private readonly secrets: ConnectionSecrets,
    private readonly hosts: PluginHostFactory,
    private readonly logs: LogService,
  ) {}

  async onModuleInit(): Promise<void> {
    // A run that was in flight when the app closed will never finish.
    const interrupted = await this.runs.failInterrupted(
      new Date(),
      'The app was closed while this run was in progress',
    );
    const app = this.logs.writer(null);
    if (interrupted > 0) {
      app.write(
        'warn',
        `${interrupted} unfinished run${interrupted === 1 ? '' : 's'} marked as failed (the app was closed)`,
      );
    }
    const pruned = await this.logs.pruneOld();
    app.write(
      'info',
      `DB Replicator started${pruned > 0 ? ` (${pruned} old log entries removed)` : ''}`,
    );
    await app.flush();
  }

  start(runId: string): void {
    const controller = new AbortController();
    this.active.set(runId, controller);
    void runReplication(
      {
        runs: this.runs,
        connections: this.connections,
        registry: this.registry,
        secrets: this.secrets,
        hosts: this.hosts,
      },
      runId,
      controller.signal,
    )
      .catch((error: unknown) => {
        this.logger.error(`Run ${runId} crashed: ${String(error)}`);
      })
      .finally(() => this.active.delete(runId));
  }

  /** True when the run was in flight and has been asked to stop. */
  cancel(runId: string): boolean {
    const controller = this.active.get(runId);
    if (!controller) return false;
    controller.abort();
    return true;
  }
}
