import { type IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { ConnectionRepositoryPort } from '../../connections/ports/connection.repository.port';
import { PluginRegistry } from '../../plugins/plugin-registry';
import {
  DockerPort,
  DockerUnavailableError,
  type DockerUnavailableReason,
} from '../ports/docker.port';

export interface DockerDatabase {
  readonly pluginId: string;
  readonly pluginName: string;
  readonly containerId: string;
  readonly containerName: string;
  readonly name: string;
  readonly config: Readonly<Record<string, string | number | boolean>>;
  readonly summary: string;
  /** A saved connection that already points at this container's published port. */
  readonly savedConnectionId: string | null;
}

export interface DockerDatabases {
  readonly available: boolean;
  readonly reason: DockerUnavailableReason | null;
  readonly items: readonly DockerDatabase[];
}

const LOCAL = new Set(['localhost', '127.0.0.1', '::1']);

export class ListDockerDatabasesQuery {}

/**
 * Asks Docker what runs, then asks EVERY plugin what it recognises among it. Which images count
 * as which database is each plugin's knowledge - nothing here mentions PostgreSQL.
 */
@QueryHandler(ListDockerDatabasesQuery)
export class ListDockerDatabasesHandler implements IQueryHandler<
  ListDockerDatabasesQuery,
  DockerDatabases
> {
  constructor(
    private readonly docker: DockerPort,
    private readonly registry: PluginRegistry,
    private readonly connections: ConnectionRepositoryPort,
  ) {}

  async execute(): Promise<DockerDatabases> {
    let containers;
    try {
      containers = await this.docker.listRunning();
    } catch (error) {
      if (error instanceof DockerUnavailableError) {
        return { available: false, reason: error.reason, items: [] };
      }
      throw error;
    }

    const saved = await this.connections.list();
    const items: DockerDatabase[] = [];
    for (const plugin of this.registry.all()) {
      if (!plugin.discoverDocker) continue;
      for (const endpoint of plugin.discoverDocker(containers)) {
        const match = saved.find(
          (connection) =>
            connection.pluginId === plugin.id &&
            Number(connection.config['port']) ===
              Number(endpoint.config['port']) &&
            LOCAL.has(String(connection.config['host'] ?? '').toLowerCase()),
        );
        items.push({
          pluginId: plugin.id,
          pluginName: plugin.name,
          containerId: endpoint.containerId,
          containerName: endpoint.containerName,
          name: endpoint.name,
          config: endpoint.config,
          summary: endpoint.summary,
          savedConnectionId: match?.id ?? null,
        });
      }
    }
    return { available: true, reason: null, items };
  }
}
