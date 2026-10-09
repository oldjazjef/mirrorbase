import type { ConfigService } from '@nestjs/config';
import { postgresPlugin } from '@dbreplicator/plugin-postgres';
import { sqlitePlugin } from '@dbreplicator/plugin-sqlite';
import type { DatabasePlugin } from '@dbreplicator/db-plugin';
import type { Env } from '../../config/env';
import { LogService } from '../../logs/log.service';
import { InMemoryLogRepository } from '../../logs/testing/in-memory-log.repository';
import { PluginHostFactory } from '../../plugins/plugin-host';
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

/** Every connection handler over port doubles, for the given plugins (default: both installed). */
export function connectionSetup(
  plugins: readonly DatabasePlugin[] = [postgresPlugin, sqlitePlugin],
  configValues: Record<string, unknown> = {},
) {
  const repository = new InMemoryConnectionRepository();
  const logRepository = new InMemoryLogRepository();
  const logs = new LogService(logRepository);
  const registry = new PluginRegistry(plugins);
  const config = fakeConfig(configValues);
  const secrets = new ConnectionSecrets(config);
  const hosts = new PluginHostFactory(config, logs);
  void CONNECTION_HANDLERS;
  return {
    repository,
    logRepository,
    registry,
    secrets,
    hosts,
    logs,
    list: new ListConnectionsHandler(repository),
    get: new GetConnectionHandler(repository),
    create: new CreateConnectionHandler(repository, registry, secrets),
    update: new UpdateConnectionHandler(repository, registry, secrets),
    remove: new DeleteConnectionHandler(repository),
    test: new TestConnectionHandler(repository, registry, secrets, hosts),
    databases: new ListConnectionDatabasesHandler(
      repository,
      registry,
      secrets,
      hosts,
    ),
  };
}
