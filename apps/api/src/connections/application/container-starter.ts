import { Injectable } from '@nestjs/common';
import {
  type DatabasePlugin,
  type HostContext,
  type LogLevel,
  PluginError,
  type PluginConnection,
} from '@mirrorbase/db-plugin';
import { DockerPort } from '../../docker/ports/docker.port';
import { PluginHostFactory } from '../../plugins/plugin-host';
import type { StoredConnection } from '../domain/connection';
import { ConnectionSecrets } from './secrets';

export type EnsureOutcome = 'running' | 'started' | 'unavailable';

export type Say = (level: LogLevel, message: string) => void;

const POLL_MS = 1_500;
const READY_TIMEOUT_MS = 60_000;

/**
 * Brings up what a connection needs before it is used - the Docker container behind it:
 *
 * - a plugin that runs its own container (`plugin.prepare`, e.g. "PostgreSQL (Docker)") creates
 *   or starts it and waits until it is ready;
 * - a connection made from an existing container (`dockerName`) gets that container started
 *   when it is stopped, and the database awaited.
 *
 * Calls for one connection run one after the other: a container being created in the background
 * after saving must not be created a second time by the run that starts right after.
 */
@Injectable()
export class ContainerStarter {
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly background = new Set<Promise<unknown>>();

  constructor(
    private readonly docker: DockerPort,
    private readonly hosts: PluginHostFactory,
    private readonly secrets: ConnectionSecrets,
  ) {}

  /**
   * Prepares a freshly saved connection without making the person wait (a first start may pull an
   * image). The outcome goes to the log; the connection is saved either way.
   */
  prepareInBackground(stored: StoredConnection, plugin: DatabasePlugin): void {
    if (!plugin.prepare && !stored.dockerName) return;
    const connection = this.secrets.toPluginConnection(stored);
    const run = this.hosts.create({
      runId: null,
      secrets: Object.values(connection.secrets),
    });
    const task = this.ensureReady(
      stored,
      plugin,
      connection,
      run.host,
      'target',
    )
      .catch((error: unknown) => {
        run.log.write(
          'warn',
          `Could not start the container of "${stored.name}": ${error instanceof Error ? error.message : String(error)}`,
        );
      })
      .finally(() => run.dispose())
      .finally(() => this.background.delete(task));
    this.background.add(task);
  }

  /** Resolves when every background preparation has finished (specs, shutdown). */
  async settled(): Promise<void> {
    await Promise.all([...this.background]);
  }

  /**
   * Makes the connection's container run and waits until the database answers. A plugin's own
   * `prepare` failing throws its `PluginError`; a problem with a `dockerName` container is only
   * logged - the real call then reports it.
   */
  ensureReady(
    stored: Pick<StoredConnection, 'id' | 'dockerName'>,
    plugin: DatabasePlugin,
    connection: PluginConnection,
    host: HostContext,
    role: 'source' | 'target',
  ): Promise<void> {
    const previous = this.queues.get(stored.id) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(() => this.prepare(stored, plugin, connection, host, role));
    this.queues.set(stored.id, next);
    const forget = (): void => {
      if (this.queues.get(stored.id) === next) this.queues.delete(stored.id);
    };
    next.then(forget, forget);
    return next;
  }

  private async prepare(
    stored: Pick<StoredConnection, 'dockerName'>,
    plugin: DatabasePlugin,
    connection: PluginConnection,
    host: HostContext,
    role: 'source' | 'target',
  ): Promise<void> {
    if (plugin.prepare) {
      await plugin.prepare(host, connection, { role });
      return;
    }
    const outcome = await this.ensureRunning(
      stored.dockerName,
      (level, message) => host.log(level, message),
    );
    if (outcome !== 'started') return;
    await this.waitUntilAnswering(
      stored.dockerName,
      plugin,
      connection,
      host,
      role,
    );
  }

  /** Starts the container when it is stopped. Does not wait for the database. */
  async ensureRunning(
    containerName: string | null,
    say: Say,
  ): Promise<EnsureOutcome> {
    if (!containerName) return 'running';
    try {
      const containers = await this.docker.list();
      const container = containers.find(
        (candidate) =>
          candidate.name === containerName || candidate.id === containerName,
      );
      if (!container) {
        say('warn', `Docker container "${containerName}" no longer exists`);
        return 'unavailable';
      }
      if (container.state === 'running') return 'running';
      say('info', `Starting Docker container "${containerName}"`);
      await this.docker.start(container.id);
      return 'started';
    } catch (error) {
      say(
        'warn',
        `Could not start Docker container "${containerName}": ${error instanceof Error ? error.message : String(error)}`,
      );
      return 'unavailable';
    }
  }

  private async waitUntilAnswering(
    containerName: string | null,
    plugin: DatabasePlugin,
    connection: PluginConnection,
    host: HostContext,
    role: 'source' | 'target',
  ): Promise<void> {
    const deadline = Date.now() + READY_TIMEOUT_MS;
    host.log('info', `Waiting for "${containerName}" to accept connections`);
    while (!host.signal?.aborted) {
      try {
        const result = await plugin.testConnection(host, connection, { role });
        if (result.ok) {
          host.log('info', `"${containerName}" is ready`);
          return;
        }
      } catch (error) {
        // Tools missing or settings invalid: waiting will not fix that, the real call reports it.
        if (error instanceof PluginError) return;
        throw error;
      }
      if (Date.now() >= deadline) {
        host.log(
          'warn',
          `"${containerName}" did not accept connections within ${READY_TIMEOUT_MS / 1000}s`,
        );
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
  }
}
