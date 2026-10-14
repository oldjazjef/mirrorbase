import type { ConfigService } from '@nestjs/config';
import { postgresPlugin } from '@mirrorbase/plugin-postgres';
import { sqlitePlugin } from '@mirrorbase/plugin-sqlite';
import type { DatabasePlugin, DockerContainer } from '@mirrorbase/db-plugin';
import type { Env } from '../../config/env';
import { LogService } from '../../logs/log.service';
import { InMemoryLogRepository } from '../../logs/testing/in-memory-log.repository';
import { PluginHostFactory } from '../../plugins/plugin-host';
import {
  DockerPort,
  DockerUnavailableError,
} from '../../docker/ports/docker.port';
import { PluginRegistry } from '../../plugins/plugin-registry';
import {
  CONNECTION_HANDLERS,
  CreateConnectionHandler,
  DeleteConnectionHandler,
  GetConnectionHandler,
  ListConnectionDatabasesHandler,
  ListConnectionsHandler,
  TestConnectionHandler,
  UpdateConnectionHandler,
} from '../application/connection.handlers';
import { ContainerStarter } from '../application/container-starter';
import {
  ExportConnectionsHandler,
  ImportConnectionsHandler,
} from '../application/connection-transfer.handlers';
import { ConnectionSecrets } from '../application/secrets';
import { InMemoryConnectionRepository } from './in-memory-connection.repository';

export const TEST_KEY = 'a-long-random-test-key-for-the-secret-box';

export function fakeConfig(
  values: Record<string, unknown> = {},
): ConfigService<Env, true> {
  const all: Record<string, unknown> = {
    SETTINGS_ENCRYPTION_KEY: TEST_KEY,
    WORK_DIR: '',
    ...values,
  };
  return { get: (key: string) => all[key] } as unknown as ConfigService<
    Env,
    true
  >;
}

/** A Docker double: the given containers, `start` flips them to running. */
export class FakeDocker extends DockerPort {
  readonly started: string[] = [];
  constructor(
    readonly containers: DockerContainer[] = [],
    private readonly down = false,
  ) {
    super();
  }
  list(): Promise<DockerContainer[]> {
    return this.down
      ? Promise.reject(new DockerUnavailableError('notRunning', 'down'))
      : Promise.resolve(this.containers);
  }
  start(nameOrId: string): Promise<void> {
    this.started.push(nameOrId);
    for (const [index, container] of this.containers.entries()) {
      if (container.id === nameOrId) {
        this.containers[index] = { ...container, state: 'running' };
      }
    }
    return Promise.resolve();
  }
}

/** Every connection handler over port doubles, for the given plugins (default: both installed). */
export function connectionSetup(
  plugins: readonly DatabasePlugin[] = [postgresPlugin, sqlitePlugin],
  configValues: Record<string, unknown> = {},
  docker: FakeDocker = new FakeDocker(),
) {
  const repository = new InMemoryConnectionRepository();
  const logRepository = new InMemoryLogRepository();
  const logs = new LogService(logRepository);
  const registry = new PluginRegistry(plugins);
  const config = fakeConfig(configValues);
  const secrets = new ConnectionSecrets(config);
  const hosts = new PluginHostFactory(config, logs);
  const containers = new ContainerStarter(docker);
  void CONNECTION_HANDLERS;
  return {
    docker,
    containers,
    repository,
    logRepository,
    registry,
    secrets,
    hosts,
    logs,
    list: new ListConnectionsHandler(repository),
    get: new GetConnectionHandler(repository),
    create: new CreateConnectionHandler(
      repository,
      registry,
      secrets,
      containers,
      logs,
    ),
    exporter: new ExportConnectionsHandler(repository, secrets),
    importer: new ImportConnectionsHandler(repository, registry, secrets),
    update: new UpdateConnectionHandler(repository, registry, secrets),
    remove: new DeleteConnectionHandler(repository),
    test: new TestConnectionHandler(repository, registry, secrets, hosts),
    databases: new ListConnectionDatabasesHandler(
      repository,
      registry,
      secrets,
      hosts,
      containers,
    ),
  };
}
