import { rm } from 'node:fs/promises';
import { PluginError } from '@dbreplicator/db-plugin';
import { ConnectionSecrets } from '../../connections/application/secrets';
import { ConnectionRepositoryPort } from '../../connections/ports/connection.repository.port';
import { PluginHostFactory } from '../../plugins/plugin-host';
import { PluginRegistry } from '../../plugins/plugin-registry';
import { finalStatus, type RunDatabase } from '../domain/run';
import { RunRepositoryPort } from '../ports/run.repository.port';

export interface ReplicationDeps {
  readonly runs: RunRepositoryPort;
  readonly connections: ConnectionRepositoryPort;
  readonly registry: PluginRegistry;
  readonly secrets: ConnectionSecrets;
  readonly hosts: PluginHostFactory;
  readonly now?: () => Date;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Executes one stored run: for every database, dump it from the source with the SOURCE plugin and
 * restore it into the target with the TARGET plugin. It names no database type - the strategy
 * (`native` today) only decides that the dump of one plugin is handed to the other.
 *
 * A database that fails does not stop the others (the old script did the same). The run's state
 * is saved after every step, so the UI can poll it, and the work directory - which holds whole
 * databases in plain text - is removed in a `finally`, whatever happens.
 */
export async function runReplication(
  deps: ReplicationDeps,
  runId: string,
  signal: AbortSignal,
): Promise<void> {
  const now = deps.now ?? (() => new Date());
  const run = await deps.runs.find(runId);
  if (!run) return;

  const [source, target] = await Promise.all([
    run.sourceConnectionId
      ? deps.connections.find(run.sourceConnectionId)
      : null,
    run.targetConnectionId
      ? deps.connections.find(run.targetConnectionId)
      : null,
  ]);
  const hostRun = deps.hosts.create({
    runId,
    secrets: [source, target].flatMap((stored) =>
      stored ? Object.values(deps.secrets.open(stored)) : [],
    ),
    signal,
  });
  const { host, log } = hostRun;

  let databases: RunDatabase[] = run.databases.map((database) => ({
    ...database,
  }));
  const save = async (): Promise<void> => {
    await deps.runs.update(runId, { databases });
  };
  const setDatabase = async (
    index: number,
    patch: Partial<RunDatabase>,
  ): Promise<void> => {
    databases = databases.map((database, i) =>
      i === index ? { ...database, ...patch } : database,
    );
    await save();
  };

  try {
    await deps.runs.update(runId, { status: 'running', startedAt: now() });
    log.write(
      'info',
      `Run started: ${run.sourceName} -> ${run.targetName} (${run.strategy}, ${databases.length} database${databases.length === 1 ? '' : 's'})`,
    );

    if (!source || !target) {
      throw new PluginError(
        'sourceMissing',
        'A connection of this run has been deleted',
      );
    }
    if (run.strategy !== 'native') {
      throw new PluginError(
        'invalidConfig',
        `The "${run.strategy}" transfer is not available yet`,
      );
    }
    const sourcePlugin = deps.registry.require(source.pluginId);
    const targetPlugin = deps.registry.require(target.pluginId);
    const sourceConnection = deps.secrets.toPluginConnection(source);
    const targetConnection = deps.secrets.toPluginConnection(target);
    const workDir = await host.workDir();

    for (const [index, database] of [...databases].entries()) {
      if (signal.aborted) {
        await setDatabase(index, { status: 'cancelled' });
        continue;
      }
      log.write(
        'info',
        `[${index + 1}/${databases.length}] ${database.source} -> ${database.target}`,
      );
      let dumpFile: string | undefined;
      try {
        await setDatabase(index, { status: 'dumping' });
        const artifact = await sourcePlugin.dump(host, sourceConnection, {
          database: database.source,
          outputDir: workDir,
        });
        dumpFile = artifact.file;
        log.write(
          'info',
          `Dump of ${database.source}: ${formatBytes(artifact.bytes)}`,
        );
        await setDatabase(index, {
          status: 'restoring',
          bytes: artifact.bytes,
        });
        const restored = await targetPlugin.restore(host, targetConnection, {
          database: database.target,
          artifact,
          replaceExisting: run.replaceExisting,
        });
        await setDatabase(index, {
          status: 'done',
          warnings: restored.warnings,
        });
        log.write(
          'info',
          restored.warnings > 0
            ? `Restored ${database.target} with ${restored.warnings} warning${restored.warnings === 1 ? '' : 's'}`
            : `Restored ${database.target}`,
        );
      } catch (error) {
        if (signal.aborted) {
          await setDatabase(index, { status: 'cancelled' });
          log.write('warn', `Cancelled while copying ${database.source}`);
        } else {
          const code = error instanceof PluginError ? error.code : 'unexpected';
          const message =
            error instanceof Error ? error.message : String(error);
          await setDatabase(index, {
            status: 'failed',
            errorCode: code,
            error: message,
          });
          log.write('error', `${database.source} failed: ${message}`);
        }
      } finally {
        // One dump at a time on disk: a whole server's worth must not pile up.
        if (dumpFile) await rm(dumpFile, { force: true });
      }
    }

    const outcome = finalStatus(databases, signal.aborted);
    await deps.runs.update(runId, {
      status: outcome.status,
      error: outcome.error,
      finishedAt: now(),
    });
    const copied = databases.filter(
      (database) => database.status === 'done',
    ).length;
    log.write(
      outcome.status === 'succeeded' ? 'info' : 'warn',
      `Run ${outcome.status}: ${copied} of ${databases.length} copied`,
    );
    await deps.connections.markUsed(source.id, now());
    await deps.connections.markUsed(target.id, now());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.write('error', `Run failed: ${message}`);
    databases = databases.map((database) =>
      database.status === 'pending'
        ? { ...database, status: 'failed', error: message }
        : database,
    );
    await deps.runs.update(runId, {
      status: signal.aborted ? 'cancelled' : 'failed',
      databases,
      error: message,
      finishedAt: now(),
    });
  } finally {
    await hostRun.dispose();
  }
}
