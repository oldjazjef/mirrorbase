import {
  type CommandSpec,
  createFakeHost,
  type PluginConnection,
} from '@mirrorbase/db-plugin';
import { clientTagFor, postgresDockerPlugin } from './docker.plugin';

const PASSWORD = 'Sup3r-Secret!';

function connection(
  config: Record<string, string | number> = {},
): PluginConnection {
  return {
    config: {
      containerName: 'mb-pg',
      image: 'postgres:16-alpine',
      hostPort: 5440,
      ...config,
    },
    secrets: { password: PASSWORD },
  };
}

/** A Docker daemon that knows the container or not, local psql installed, a server that answers. */
function respond(state: { exists: boolean }) {
  return (spec: CommandSpec) => {
    const [first, second] = spec.args;
    if (spec.command === 'docker' && first === 'inspect') {
      return state.exists
        ? { stdout: 'running\n' }
        : { exitCode: 1, stderr: 'Error: No such object: mb-pg' };
    }
    if (spec.command === 'docker' && first === 'run') {
      state.exists = true;
      return { stdout: 'abc123\n' };
    }
    if (spec.command === 'docker' && first === 'port') {
      return { stdout: '127.0.0.1:5440\n' };
    }
    if (spec.command === 'docker' && first === 'exec') {
      return { stdout: '' };
    }
    if (spec.command === 'psql' && second === '--version') {
      return { stdout: 'psql 16' };
    }
    if (spec.command === 'pg_dump' && second === '--version') {
      return { stdout: 'pg_dump 16' };
    }
    if (spec.command === 'psql') return { stdout: 'PostgreSQL 16.4 (Debian)' };
    return undefined;
  };
}

describe('postgres docker plugin', () => {
  it('has its own id, shares the PostgreSQL dump format and can be a target', () => {
    expect(postgresDockerPlugin.id).toBe('postgres-docker');
    expect(postgresDockerPlugin.dumpFormat).toBe('postgres-plain-sql@1');
    expect(postgresDockerPlugin.capabilities.canBeTarget).toBe(true);
  });

  it('requires a container name, an image, a port and a password', () => {
    expect(
      postgresDockerPlugin.validate({ config: {}, secrets: {} }),
    ).toContainEqual({ field: 'password', code: 'required' });
    expect(postgresDockerPlugin.validate(connection())).toEqual([]);
    expect(
      postgresDockerPlugin.validate(connection({ image: '-v /:/host' })),
    ).toContainEqual({ field: 'image', code: 'invalidFormat' });
  });

  it('reports a missing container as fine for a target and as a problem for a source', async () => {
    const host = createFakeHost(respond({ exists: false }));
    const asTarget = await postgresDockerPlugin.testConnection(
      host,
      connection(),
      { role: 'target' },
    );
    expect(asTarget.ok).toBe(true);
    expect(asTarget.message).toMatch(/will be created/);
    const asSource = await postgresDockerPlugin.testConnection(
      host,
      connection(),
      { role: 'source' },
    );
    expect(asSource.ok).toBe(false);
    expect(host.commands.some((c) => c.args[0] === 'run')).toBe(false);
  });

  it('creates the container on first use and keeps the password out of the arguments', async () => {
    const host = createFakeHost(respond({ exists: false }));
    await postgresDockerPlugin.listDatabases(host, connection());
    const run = host.commands.find((c) => c.args[0] === 'run');
    expect(run).toBeDefined();
    expect(run?.args).toEqual(
      expect.arrayContaining([
        '--name',
        'mb-pg',
        '-p',
        '127.0.0.1:5440:5432',
        'postgres:16-alpine',
      ]),
    );
    expect(run?.env?.['POSTGRES_PASSWORD']).toBe(PASSWORD);
    expect(host.commands.flatMap((c) => c.args).join(' ')).not.toContain(
      PASSWORD,
    );
  });

  it('prepare creates a missing container and waits for it, without touching the database', async () => {
    const host = createFakeHost(respond({ exists: false }));
    await postgresDockerPlugin.prepare?.(host, connection(), {
      role: 'target',
    });
    expect(host.commands.some((c) => c.args[0] === 'run')).toBe(true);
    expect(host.commands.some((c) => c.args[0] === 'exec')).toBe(true);
    expect(
      host.commands.some(
        (c) => c.command === 'psql' || c.command === 'pg_dump',
      ),
    ).toBe(false);
  });

  it('prepare starts a stopped container and leaves a running one alone', async () => {
    const stopped = createFakeHost((spec) => {
      if (spec.args[0] === 'inspect') return { stdout: 'exited\n' };
      return respond({ exists: true })(spec);
    });
    await postgresDockerPlugin.prepare?.(stopped, connection());
    expect(stopped.commands.some((c) => c.args[0] === 'start')).toBe(true);

    const running = createFakeHost(respond({ exists: true }));
    await postgresDockerPlugin.prepare?.(running, connection());
    expect(running.commands.some((c) => c.args[0] === 'start')).toBe(false);
    expect(running.commands.some((c) => c.args[0] === 'run')).toBe(false);
  });

  it('does not create a container that already exists', async () => {
    const host = createFakeHost(respond({ exists: true }));
    await postgresDockerPlugin.listDatabases(host, connection());
    expect(host.commands.some((c) => c.args[0] === 'run')).toBe(false);
  });

  it('starts a stopped container', async () => {
    const host = createFakeHost((spec) => {
      if (spec.args[0] === 'inspect') return { stdout: 'exited\n' };
      return respond({ exists: true })(spec);
    });
    await postgresDockerPlugin.listDatabases(host, connection());
    expect(host.commands.some((c) => c.args[0] === 'start')).toBe(true);
  });

  it('recreates a container Mirrorbase made when its published port no longer matches', async () => {
    const host = createFakeHost((spec) => {
      if (spec.args[0] === 'inspect' && spec.args.includes('--format')) {
        return spec.args[2]?.includes('PortBindings')
          ? {
              stdout:
                '{"5432/tcp":[{"HostIp":"127.0.0.1","HostPort":"5433"}]} true',
            }
          : { stdout: 'running' };
      }
      return respond({ exists: true })(spec);
    });
    await postgresDockerPlugin.prepare?.(host, connection());
    const verbs = host.commands.map((c) => c.args[0]);
    expect(verbs).toContain('rm');
    expect(verbs).toContain('run');
    expect(verbs.indexOf('rm')).toBeLessThan(verbs.indexOf('run'));
  });

  it('refuses to remove a container it did not create when the port differs', async () => {
    const host = createFakeHost((spec) => {
      if (
        spec.args[0] === 'inspect' &&
        spec.args[2]?.includes('PortBindings')
      ) {
        return { stdout: '{} ' };
      }
      return respond({ exists: true })(spec);
    });
    await expect(
      postgresDockerPlugin.prepare?.(host, connection()),
    ).rejects.toMatchObject({ code: 'connectionFailed' });
    expect(host.commands.some((c) => c.args[0] === 'rm')).toBe(false);
  });

  it('removes the half-made container when creating it fails', async () => {
    const host = createFakeHost((spec) => {
      if (spec.args[0] === 'inspect') {
        return { exitCode: 1, stderr: 'Error: No such object: mb-pg' };
      }
      if (spec.args[0] === 'run') {
        return { exitCode: 125, stderr: 'port is already allocated' };
      }
      return undefined;
    });
    await expect(
      postgresDockerPlugin.prepare?.(host, connection()),
    ).rejects.toMatchObject({ code: 'connectionFailed' });
    expect(host.commands.some((c) => c.args[0] === 'rm')).toBe(true);
  });

  it('says so when Docker is not running', async () => {
    const host = createFakeHost((spec) =>
      spec.args[0] === 'inspect'
        ? {
            exitCode: 1,
            stderr: 'failed to connect to the docker API at npipe',
          }
        : undefined,
    );
    await expect(
      postgresDockerPlugin.testConnection(host, connection()),
    ).rejects.toMatchObject({ code: 'clientToolsMissing' });
  });
});

describe('clientTagFor', () => {
  it('takes the major version of an official image and falls back to latest', () => {
    expect(clientTagFor('postgres:16-alpine')).toBe('16');
    expect(clientTagFor('postgres')).toBe('latest');
    expect(clientTagFor('timescale/timescaledb:2.14-pg16')).toBe('latest');
    expect(clientTagFor('registry:5000/postgres:15')).toBe('latest');
  });
});
