import type { DockerContainer } from '@dbreplicator/db-plugin';
import { sqlitePlugin } from '@dbreplicator/plugin-sqlite';
import { postgresPlugin } from '@dbreplicator/plugin-postgres';
import { InMemoryConnectionRepository } from '../../connections/testing/in-memory-connection.repository';
import { PluginRegistry } from '../../plugins/plugin-registry';
import { DockerPort, DockerUnavailableError } from '../ports/docker.port';
import { ListDockerDatabasesHandler } from './docker.handlers';

class FakeDocker extends DockerPort {
  constructor(
    private readonly result: DockerContainer[] | DockerUnavailableError,
  ) {
    super();
  }
  listRunning(): Promise<DockerContainer[]> {
    return this.result instanceof Error
      ? Promise.reject(this.result)
      : Promise.resolve(this.result);
  }
}

const pg = (name: string, hostPort: number): DockerContainer => ({
  id: name,
  name,
  image: 'postgres:16',
  imageTag: '16',
  state: 'running',
  ports: [
    { containerPort: 5432, protocol: 'tcp', hostIp: '0.0.0.0', hostPort },
  ],
  env: { POSTGRES_USER: 'app' },
});

function handler(
  docker: DockerPort,
  repository = new InMemoryConnectionRepository(),
) {
  return {
    repository,
    handler: new ListDockerDatabasesHandler(
      docker,
      new PluginRegistry([postgresPlugin, sqlitePlugin]),
      repository,
    ),
  };
}

describe('ListDockerDatabasesHandler', () => {
  it('collects what every plugin recognises', async () => {
    const { handler: h } = handler(
      new FakeDocker([
        pg('pg-a', 5441),
        pg('pg-b', 5442),
        { ...pg('redis', 6379), image: 'redis:7', env: {}, ports: [] },
      ]),
    );
    const result = await h.execute();
    expect(result.available).toBe(true);
    expect(
      result.items.map((i) => [i.pluginId, i.containerName, i.config['port']]),
    ).toEqual([
      ['postgres', 'pg-a', 5441],
      ['postgres', 'pg-b', 5442],
    ]);
  });

  it('marks a container that already has a saved connection', async () => {
    const { handler: h, repository } = handler(
      new FakeDocker([pg('pg-a', 5441), pg('pg-b', 5442)]),
    );
    const saved = await repository.create({
      name: 'Dev DB',
      pluginId: 'postgres',
      config: { host: '127.0.0.1', port: 5441, user: 'app' },
      sealedSecrets: {},
      dockerName: 'pg-a',
    });
    const result = await h.execute();
    expect(result.items.map((i) => i.savedConnectionId)).toEqual([
      saved.id,
      null,
    ]);
  });

  it('does not fail when Docker is missing or stopped', async () => {
    expect(
      await handler(
        new FakeDocker(new DockerUnavailableError('notInstalled', 'x')),
      ).handler.execute(),
    ).toEqual({
      available: false,
      reason: 'notInstalled',
      items: [],
    });
    expect(
      (
        await handler(
          new FakeDocker(new DockerUnavailableError('notRunning', 'x')),
        ).handler.execute()
      ).reason,
    ).toBe('notRunning');
  });

  it('lets other errors through', async () => {
    const failing = new FakeDocker([]);
    failing.listRunning = () => Promise.reject(new Error('boom'));
    await expect(handler(failing).handler.execute()).rejects.toThrow('boom');
  });
});
