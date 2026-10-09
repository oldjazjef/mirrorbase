import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type CommandSpec,
  createFakeHost,
  type DockerContainer,
  type PluginConnection,
} from '@mirrorbase/db-plugin';
import { POSTGRES_DUMP_FORMAT, postgresPlugin } from './postgres.plugin';

const PASSWORD = 'Sup3r-Secret!';

function connection(
  config: Record<string, string | number> = {},
): PluginConnection {
  return {
    config: { host: 'db.example.com', port: 5433, user: 'admin', ...config },
    secrets: { password: PASSWORD },
  };
}

const NO_LOCAL = (spec: CommandSpec) =>
  spec.command === 'psql' || spec.command === 'pg_dump'
    ? { exitCode: -1, failure: 'notFound' as const }
    : undefined;

let work: string;
beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), 'mb-pg-'));
});
afterEach(() => rmSync(work, { recursive: true, force: true }));

function everyArg(host: { commands: CommandSpec[] }): string {
  return host.commands.flatMap((c) => [c.command, ...c.args]).join(' ');
}

describe('postgres plugin', () => {
  it('is a multi-database plugin that can discover Docker containers', () => {
    expect(postgresPlugin.capabilities).toMatchObject({
      multipleDatabases: true,
      dockerDiscovery: true,
    });
  });

  it('validates the connection fields', () => {
    expect(postgresPlugin.validate({ config: {}, secrets: {} })).toContainEqual(
      {
        field: 'host',
        code: 'required',
      },
    );
    expect(
      postgresPlugin.validate(connection({ host: '-oProxy=evil' })),
    ).toContainEqual({ field: 'host', code: 'invalidFormat' });
    expect(postgresPlugin.validate(connection())).toEqual([]);
  });

  it('uses local tools when installed and keeps the password out of the arguments', async () => {
    const host = createFakeHost((spec) =>
      spec.args.includes('SELECT version()')
        ? { stdout: 'PostgreSQL 16.4 (Debian 16.4-1) on x86_64\n' }
        : undefined,
    );
    const result = await postgresPlugin.testConnection(host, connection());
    expect(result).toEqual({ ok: true, serverVersion: 'PostgreSQL 16.4' });
    const query = host.commands.at(-1)!;
    expect(query.command).toBe('psql');
    expect(query.env?.['PGPASSWORD']).toBe(PASSWORD);
    expect(query.secrets).toEqual([PASSWORD]);
    expect(everyArg(host)).not.toContain(PASSWORD);
  });

  it('reports a failed login without throwing', async () => {
    const host = createFakeHost((spec) =>
      spec.args.includes('SELECT version()')
        ? {
            exitCode: 2,
            stderr:
              'psql: error: password authentication failed for user "admin"\n',
          }
        : undefined,
    );
    expect(await postgresPlugin.testConnection(host, connection())).toEqual({
      ok: false,
      message: 'psql: error: password authentication failed for user "admin"',
    });
  });

  it('falls back to the Docker client with --network host on Linux', async () => {
    const host = createFakeHost((spec) => {
      const missing = NO_LOCAL(spec);
      if (missing) return missing;
      return spec.command === 'docker'
        ? { stdout: 'PostgreSQL 15.2 on x\n' }
        : undefined;
    });
    await postgresPlugin.testConnection(
      host,
      connection({ pgImage: '15-alpine' }),
    );
    const run = host.commands.find((c) => c.command === 'docker')!;
    expect(run.args.slice(0, 4)).toEqual(['run', '--rm', '--network', 'host']);
    expect(run.args).toContain('postgres:15-alpine');
    expect(run.args).toContain('PGPASSWORD');
    expect(run.args).not.toContain(PASSWORD);
    expect(run.env?.['PGPASSWORD']).toBe(PASSWORD);
  });

  it('reaches a host-local server from Docker Desktop through host.docker.internal', async () => {
    const host = createFakeHost(
      (spec) => NO_LOCAL(spec) ?? { stdout: 'PostgreSQL 16.1 on x\n' },
      { platform: 'darwin' },
    );
    await postgresPlugin.testConnection(
      host,
      connection({ host: 'localhost' }),
    );
    const run = host.commands.find((c) => c.command === 'docker')!;
    expect(run.args).not.toContain('--network');
    expect(run.args).toContain('host.docker.internal');
  });

  it('says so when neither psql nor Docker exists', async () => {
    const host = createFakeHost((spec) => ({
      exitCode: -1,
      failure: 'notFound',
      ...(spec ? {} : {}),
    }));
    await expect(
      postgresPlugin.testConnection(host, connection()),
    ).rejects.toMatchObject({ code: 'clientToolsMissing' });
  });

  it('lists user databases', async () => {
    const host = createFakeHost((spec) =>
      spec.args.some((a) => a.includes('FROM pg_database'))
        ? { stdout: 'alpha\nauthorization\n\nbeta\n' }
        : undefined,
    );
    expect(await postgresPlugin.listDatabases(host, connection())).toEqual([
      'alpha',
      'authorization',
      'beta',
    ]);
  });

  it('dumps with the options of the original script', async () => {
    const host = createFakeHost((spec) => {
      if (spec.command === 'pg_dump' && spec.args.includes('-f')) {
        writeFileSync(spec.args[spec.args.indexOf('-f') + 1]!, '-- dump\n');
      }
      return undefined;
    });
    const artifact = await postgresPlugin.dump(host, connection(), {
      database: 'shop',
      outputDir: work,
    });
    const dump = host.commands.find(
      (c) => c.command === 'pg_dump' && c.args.includes('-f'),
    )!;
    expect(dump.args).toEqual(
      expect.arrayContaining([
        '--no-owner',
        '--no-acl',
        '--encoding=UTF8',
        '-d',
        'shop',
      ]),
    );
    expect(artifact).toMatchObject({
      database: 'shop',
      format: POSTGRES_DUMP_FORMAT,
      bytes: 8,
    });
  });

  it('explains a pg_dump older than the server', async () => {
    const host = createFakeHost((spec) =>
      spec.command === 'pg_dump' && spec.args.includes('-f')
        ? {
            exitCode: 1,
            stderr:
              'pg_dump: error: aborting because of server version mismatch\n',
          }
        : undefined,
    );
    await expect(
      postgresPlugin.dump(host, connection(), {
        database: 'shop',
        outputDir: work,
      }),
    ).rejects.toMatchObject({ code: 'dumpFailed' });
    expect(
      host.logs.some((l) => l.level === 'warn' && /Docker/.test(l.message)),
    ).toBe(true);
  });

  describe('restore', () => {
    const artifact = {
      database: 'shop',
      file: '/tmp/work/shop.sql',
      bytes: 10,
      format: POSTGRES_DUMP_FORMAT,
    };
    const sqlOf = (host: { commands: CommandSpec[] }) =>
      host.commands.flatMap((c) =>
        c.args.filter((a) => /^(SELECT|DROP|CREATE)/.test(a)),
      );

    it('creates a new database and loads the dump', async () => {
      const host = createFakeHost();
      const result = await postgresPlugin.restore(host, connection(), {
        database: 'shop',
        artifact,
        replaceExisting: false,
      });
      expect(sqlOf(host)).toEqual([
        "SELECT 1 FROM pg_database WHERE datname = 'shop'",
        'CREATE DATABASE "shop"',
      ]);
      const load = host.commands.at(-1)!;
      expect(load.args).toEqual(
        expect.arrayContaining(['-f', '/tmp/work/shop.sql', '-d', 'shop']),
      );
      expect(result.warnings).toBe(0);
    });

    it('refuses an existing database unless replacing was confirmed', async () => {
      const host = createFakeHost((spec) =>
        spec.args.some((a) => a.startsWith('SELECT 1'))
          ? { stdout: '1\n' }
          : undefined,
      );
      await expect(
        postgresPlugin.restore(host, connection(), {
          database: 'shop',
          artifact,
          replaceExisting: false,
        }),
      ).rejects.toMatchObject({ code: 'targetExists' });
      expect(sqlOf(host)).toHaveLength(1);
    });

    it('drops, creates and counts harmless errors when replacing', async () => {
      const host = createFakeHost((spec) => {
        if (spec.args.some((a) => a.startsWith('SELECT 1')))
          return { stdout: '1\n' };
        if (spec.args.includes('-f')) {
          return {
            stderr: 'psql:x.sql:4: ERROR:  role "app" does not exist\n',
          };
        }
        return undefined;
      });
      const result = await postgresPlugin.restore(host, connection(), {
        database: 'we"ird',
        artifact,
        replaceExisting: true,
      });
      expect(sqlOf(host)).toEqual([
        `SELECT 1 FROM pg_database WHERE datname = 'we"ird'`,
        'DROP DATABASE "we""ird" WITH (FORCE)',
        'CREATE DATABASE "we""ird"',
      ]);
      expect(result.warnings).toBe(1);
      expect(
        host.logs.some(
          (l) => l.level === 'warn' && /role "app"/.test(l.message),
        ),
      ).toBe(true);
    });

    it('retries the drop without FORCE on servers older than 13', async () => {
      const host = createFakeHost((spec) => {
        if (spec.args.some((a) => a.startsWith('SELECT 1')))
          return { stdout: '1\n' };
        if (spec.args.some((a) => a.includes('WITH (FORCE)'))) {
          return {
            exitCode: 1,
            stderr: 'ERROR:  syntax error at or near "("\n',
          };
        }
        return undefined;
      });
      await postgresPlugin.restore(host, connection(), {
        database: 'shop',
        artifact,
        replaceExisting: true,
      });
      expect(sqlOf(host)).toContain('DROP DATABASE "shop"');
    });

    it('refuses a dump from another database type', async () => {
      await expect(
        postgresPlugin.restore(createFakeHost(), connection(), {
          database: 'shop',
          artifact: { ...artifact, format: 'sqlite-file@1' },
          replaceExisting: true,
        }),
      ).rejects.toMatchObject({ code: 'restoreFailed' });
    });
  });

  describe('docker discovery', () => {
    const container = (over: Partial<DockerContainer>): DockerContainer => ({
      id: 'abc',
      name: 'pg16',
      image: 'postgres:16-alpine',
      imageTag: '16-alpine',
      state: 'running',
      ports: [
        {
          containerPort: 5432,
          protocol: 'tcp',
          hostIp: '0.0.0.0',
          hostPort: 5441,
        },
      ],
      env: { POSTGRES_USER: 'app', POSTGRES_DB: 'appdb' },
      ...over,
    });

    it('recognises published Postgres containers and prefills non-secret settings', () => {
      expect(postgresPlugin.discoverDocker!([container({})])).toEqual([
        expect.objectContaining({
          containerName: 'pg16',
          config: {
            host: 'localhost',
            port: 5441,
            user: 'app',
            maintenanceDb: 'appdb',
            pgImage: '16',
          },
        }),
      ]);
    });

    it('skips other images and unpublished databases', () => {
      expect(
        postgresPlugin.discoverDocker!([
          container({ id: 'r', image: 'redis:7', env: {}, ports: [] }),
          container({ id: 'u', ports: [] }),
        ]),
      ).toEqual([]);
    });
  });
});

describe('postgres plugin in Docker mode with a work directory', () => {
  it('runs the container as the current user so it can write the private dump directory', async () => {
    const host = createFakeHost(
      (spec) => {
        if (spec.command === 'psql' || spec.command === 'pg_dump') {
          return { exitCode: -1, failure: 'notFound' as const };
        }
        if (spec.args.includes('pg_dump')) {
          const mounted = spec.args[spec.args.indexOf('-v') + 1]!;
          writeFileSync(`${mounted.split(':/work')[0]}/shop.sql`, '-- dump\n');
        }
        return undefined;
      },
      { runAsUser: '1000:1000' },
    );
    const dir = mkdtempSync(join(tmpdir(), 'mb-pg-docker-'));
    try {
      const artifact = await postgresPlugin.dump(host, connection(), {
        database: 'shop',
        outputDir: dir,
      });
      const run = host.commands.find((c) => c.args.includes('pg_dump'))!;
      expect(run.args).toEqual(
        expect.arrayContaining(['--user', '1000:1000', '-v', `${dir}:/work`]),
      );
      expect(run.args).toContain('/work/shop.sql');
      expect(artifact.file).toBe(`${dir}/shop.sql`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('a Docker daemon that is not running', () => {
  it.each([
    'Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?',
    'failed to connect to the docker API at unix:///var/run/docker.sock; check if the path is correct and if the daemon is running',
  ])('is reported as clientToolsMissing: %s', async (stderr) => {
    const host = createFakeHost((spec) => {
      if (spec.command === 'psql' || spec.command === 'pg_dump') {
        return { exitCode: -1, failure: 'notFound' as const };
      }
      return { exitCode: 125, stderr };
    });
    await expect(
      postgresPlugin.testConnection(host, connection()),
    ).rejects.toMatchObject({
      code: 'clientToolsMissing',
      message: 'Docker is not running',
    });
  });
});
