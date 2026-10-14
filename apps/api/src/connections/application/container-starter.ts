import { Injectable } from '@nestjs/common';
import {
  type DatabasePlugin,
  type HostContext,
  type LogLevel,
  PluginError,
  type PluginConnection,
} from '@mirrorbase/db-plugin';
import { DockerPort } from '../../docker/ports/docker.port';

export type EnsureOutcome = 'running' | 'started' | 'unavailable';

export type Say = (level: LogLevel, message: string) => void;

const POLL_MS = 1_500;
const READY_TIMEOUT_MS = 60_000;

/**
 * A connection made from a Docker container is only usable while that container runs. This
 * starts it - when a connection is created, before its databases are listed, before a copy - and
 * waits until the database inside accepts connections (a fresh start takes seconds).
 *
 * It never throws for a Docker problem: if the container cannot be started the caller carries on
 * and the plugin's own connection error tells the user, with the reason in the log.
 */
@Injectable()
export class ContainerStarter {
  constructor(private readonly docker: DockerPort) {}

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

  /** Starts the container if needed and, when it was started, waits until the database answers. */
  async ensureReady(
    containerName: string | null,
    plugin: DatabasePlugin,
    connection: PluginConnection,
    host: HostContext,
    role: 'source' | 'target',
  ): Promise<void> {
    const outcome = await this.ensureRunning(containerName, (level, message) =>
      host.log(level, message),
    );
    if (outcome !== 'started') return;

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
