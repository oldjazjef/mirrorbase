import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type DatabasePlugin,
  type DumpArtifact,
  PluginError,
  type PluginConnection,
  type RestoreRequest,
} from '@mirrorbase/db-plugin';
import { connectionSetup } from '../../connections/testing/connection-fixture';
import type { ReplicationDeps } from '../application/run-replication';
import {
  StartRunHandler,
  CancelRunHandler,
  GetRunHandler,
  ListRunsHandler,
} from '../application/run.handlers';
import type { ReplicationExecutor } from '../application/replication-executor';
import { InMemoryRunRepository } from './in-memory-run.repository';

/** What a test controls about the in-memory "database engine". */
export interface MemoryEngine {
  /** database → content, per target connection `host`. */
  readonly stores: Map<string, Map<string, string>>;
  readonly restoreCalls: {
    host: string;
    database: string;
    replace: boolean;
    password: string | undefined;
  }[];
  /** Make restoring this database fail with this error. */
  failRestore: Map<string, PluginError | Error>;
  /** Called between dump and restore - to cancel in the middle of a run. */
  onBeforeRestore: (database: string) => void;
}

/**
 * A complete database plugin that keeps "databases" in a Map. It dumps to a real file (so the
 * work directory and its cleanup are exercised) and can be told to fail.
 */
export function memoryPlugin(
  engine: MemoryEngine,
  id = 'memory',
): DatabasePlugin {
  const storeOf = (c: PluginConnection): Map<string, string> => {
    const host = String(c.config['host']);
    if (!engine.stores.has(host)) engine.stores.set(host, new Map());
    return engine.stores.get(host)!;
  };
  return {
    id,
    name: 'Memory',
    description: { en: 'In-memory test database' },
    version: '1.0.0',
    icon: 'database',
    capabilities: {
      canBeSource: true,
      canBeTarget: true,
      multipleDatabases: true,
      dockerDiscovery: false,
    },
    connectionFields: [
      { key: 'host', type: 'text', label: { en: 'Host' }, required: true },
      {
        key: 'password',
        type: 'password',
        secret: true,
        label: { en: 'Password' },
      },
    ],
    dumpFormat: `${id}-dump@1`,
    validate: () => [],
    testConnection: () => Promise.resolve({ ok: true }),
    listDatabases: (_host, c) => Promise.resolve([...storeOf(c).keys()]),
    dump(host, c, request): Promise<DumpArtifact> {
      const content = storeOf(c).get(request.database);
      if (content === undefined) {
        return Promise.reject(
          new PluginError('dumpFailed', `no database ${request.database}`),
        );
      }
      mkdirSync(request.outputDir, { recursive: true });
      const file = join(request.outputDir, `${request.database}.dump`);
      writeFileSync(file, content);
      host.log('info', `dumped ${request.database}`);
      return Promise.resolve({
        database: request.database,
        file,
        bytes: content.length,
        format: `${id}-dump@1`,
      });
    },
    restore(host, c, request: RestoreRequest) {
      engine.restoreCalls.push({
        host: String(c.config['host']),
        database: request.database,
        replace: request.replaceExisting,
        password: c.secrets['password'],
      });
      engine.onBeforeRestore(request.database);
      const failure = engine.failRestore.get(request.database);
      if (failure) return Promise.reject(failure);
      const store = storeOf(c);
      if (store.has(request.database) && !request.replaceExisting) {
        return Promise.reject(
          new PluginError('targetExists', `${request.database} exists`),
        );
      }
      store.set(request.database, `restored:${request.artifact.bytes}`);
      host.log('info', `restored ${request.database}`);
      return Promise.resolve({ warnings: 0 });
    },
  };
}

export function newEngine(): MemoryEngine {
  return {
    stores: new Map(),
    restoreCalls: [],
    failRestore: new Map(),
    onBeforeRestore: () => undefined,
  };
}

export class FakeExecutor {
  started: string[] = [];
  cancelled: string[] = [];
  activeIds = new Set<string>();
  start(id: string): void {
    this.started.push(id);
    this.activeIds.add(id);
  }
  cancel(id: string): boolean {
    this.cancelled.push(id);
    return this.activeIds.has(id);
  }
}

export function replicationSetup(
  plugins: readonly DatabasePlugin[],
  configValues: Record<string, unknown> = {},
) {
  const base = connectionSetup(plugins, configValues);
  const runs = new InMemoryRunRepository();
  const executor = new FakeExecutor();
  const deps: ReplicationDeps = {
    runs,
    connections: base.repository,
    registry: base.registry,
    secrets: base.secrets,
    hosts: base.hosts,
  };
  return {
    ...base,
    runs,
    executor,
    deps,
    start: new StartRunHandler(
      runs,
      base.repository,
      base.registry,
      executor as unknown as ReplicationExecutor,
      base.logs,
    ),
    cancel: new CancelRunHandler(
      runs,
      executor as unknown as ReplicationExecutor,
      base.logs,
    ),
    getRun: new GetRunHandler(runs),
    listRuns: new ListRunsHandler(runs),
  };
}
