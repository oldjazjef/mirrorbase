import {
  type CommandSpec,
  createFakeHost,
  type PluginConnection,
} from '@mirrorbase/db-plugin';
import { sqliteDockerPlugin } from './docker.plugin';
import { SQLITE_DUMP_FORMAT } from './sqlite.plugin';

function connection(): PluginConnection {
  return {
    config: {
      containerName: 'mb-sqlite',
      image: 'keinos/sqlite3:latest',
      database: 'copy',
    },
    secrets: {},
  };
}

function respond(options: { exists: boolean; fileExists?: boolean }) {
  let exists = options.exists;
  return (spec: CommandSpec) => {
    const args = spec.args;
    if (args[0] === 'inspect') {
      return exists
        ? { stdout: 'running\n' }
        : { exitCode: 1, stderr: 'Error: No such object: mb-sqlite' };
    }
    if (args[0] === 'run') {
      exists = true;
      return { stdout: 'abc\n' };
    }
    if (args[0] === 'exec' && args.includes('test')) {
      return { exitCode: options.fileExists ? 0 : 1 };
    }
    if (args[0] === 'exec' && args.includes('PRAGMA integrity_check;')) {
      return { stdout: 'ok\n' };
    }
    return undefined;
  };
}

const ARTIFACT = {
  database: 'copy',
  file: '/tmp/fake-work/copy.sqlite',
  bytes: 1,
  format: SQLITE_DUMP_FORMAT,
};

describe('sqlite docker plugin', () => {
  it('shares the SQLite dump format and can be a target', () => {
    expect(sqliteDockerPlugin.id).toBe('sqlite-docker');
    expect(sqliteDockerPlugin.dumpFormat).toBe(SQLITE_DUMP_FORMAT);
    expect(sqliteDockerPlugin.capabilities.canBeTarget).toBe(true);
    expect(sqliteDockerPlugin.capabilities.multipleDatabases).toBe(false);
  });

  it('validates the database name', () => {
    expect(sqliteDockerPlugin.validate(connection())).toEqual([]);
    expect(
      sqliteDockerPlugin.validate({
        config: { ...connection().config, database: '../etc/passwd' },
        secrets: {},
      }),
    ).toContainEqual({ field: 'database', code: 'invalidFormat' });
  });

  it('creates the container with a volume, copies the file in and checks it', async () => {
    const host = createFakeHost(respond({ exists: false }));
    const result = await sqliteDockerPlugin.restore(host, connection(), {
      database: 'copy',
      artifact: ARTIFACT,
      replaceExisting: false,
    });
    expect(result.warnings).toBe(0);
    const run = host.commands.find((c) => c.args[0] === 'run');
    expect(run?.args).toEqual(
      expect.arrayContaining([
        '-v',
        'mb-sqlite-data:/data',
        'keinos/sqlite3:latest',
      ]),
    );
    const copy = host.commands.find((c) => c.args[0] === 'cp');
    expect(copy?.args).toEqual([
      'cp',
      '/tmp/fake-work/copy.sqlite',
      'mb-sqlite:/data/copy.sqlite.restoring',
    ]);
    const move = host.commands.find((c) => c.args.includes('sh'));
    expect(move?.args.join(' ')).toContain(
      'mv -f "/data/copy.sqlite.restoring" "/data/copy.sqlite"',
    );
  });

  it('refuses to replace an existing file without confirmation', async () => {
    const host = createFakeHost(respond({ exists: true, fileExists: true }));
    await expect(
      sqliteDockerPlugin.restore(host, connection(), {
        database: 'copy',
        artifact: ARTIFACT,
        replaceExisting: false,
      }),
    ).rejects.toMatchObject({ code: 'targetExists' });
    expect(host.commands.some((c) => c.args[0] === 'cp')).toBe(false);
  });

  it('removes the staged copy when the integrity check fails', async () => {
    const host = createFakeHost((spec) =>
      spec.args.includes('PRAGMA integrity_check;')
        ? { stdout: 'database disk image is malformed\n' }
        : respond({ exists: true })(spec),
    );
    await expect(
      sqliteDockerPlugin.restore(host, connection(), {
        database: 'copy',
        artifact: ARTIFACT,
        replaceExisting: true,
      }),
    ).rejects.toMatchObject({ code: 'restoreFailed' });
    expect(
      host.commands.some(
        (c) =>
          c.args.includes('rm') &&
          c.args.includes('/data/copy.sqlite.restoring'),
      ),
    ).toBe(true);
  });

  it('refuses a dump of another format', async () => {
    const host = createFakeHost(respond({ exists: true }));
    await expect(
      sqliteDockerPlugin.restore(host, connection(), {
        database: 'copy',
        artifact: { ...ARTIFACT, format: 'postgres-plain-sql@1' },
        replaceExisting: true,
      }),
    ).rejects.toMatchObject({ code: 'restoreFailed' });
  });
});
