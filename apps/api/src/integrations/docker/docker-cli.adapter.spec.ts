import { DockerUnavailableError } from '../../docker/ports/docker.port';
import type { runProcess } from '../process/run-process';
import { DockerCliAdapter, parseInspect, tagOf } from './docker-cli.adapter';

const INSPECT = JSON.stringify([
  {
    Id: 'b'.repeat(64),
    Name: '/pg16',
    Config: {
      Image: 'postgres:16-alpine',
      Env: [
        'POSTGRES_USER=app',
        'POSTGRES_PASSWORD=do-not-leak',
        'POSTGRES_DB=appdb',
        'API_TOKEN=also-secret',
        'PATH=/usr/bin',
      ],
    },
    State: { Status: 'running' },
    NetworkSettings: {
      Ports: {
        '5432/tcp': [{ HostIp: '0.0.0.0', HostPort: '5441' }],
        '9187/tcp': null,
      },
    },
  },
  {
    Id: 'a'.repeat(64),
    Name: '/alpha',
    Config: { Image: 'redis', Env: null },
    NetworkSettings: { Ports: null },
  },
]);

function runner(
  answers: Record<string, Awaited<ReturnType<typeof runProcess>>>,
): typeof runProcess {
  return (options) => {
    const key = options.args[0] ?? '';
    return Promise.resolve(
      answers[key] ?? { exitCode: 0, stdout: '', stderr: '' },
    );
  };
}

describe('DockerCliAdapter', () => {
  it('lists running containers with published ports and a secret-free environment', async () => {
    const adapter = new DockerCliAdapter(
      runner({
        ps: {
          exitCode: 0,
          stdout: `${'b'.repeat(64)}\n${'a'.repeat(64)}\n`,
          stderr: '',
        },
        inspect: { exitCode: 0, stdout: INSPECT, stderr: '' },
      }),
    );
    const containers = await adapter.list();
    expect(containers.map((c) => c.name)).toEqual(['alpha', 'pg16']);
    const pg = containers[1]!;
    expect(pg).toMatchObject({
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
    });
    expect(pg.env).toEqual({
      POSTGRES_USER: 'app',
      POSTGRES_DB: 'appdb',
      PATH: '/usr/bin',
    });
    expect(JSON.stringify(containers)).not.toContain('do-not-leak');
  });

  it('asks for stopped containers as well', async () => {
    let args: readonly string[] = [];
    const adapter = new DockerCliAdapter((options) => {
      args = options.args;
      return Promise.resolve({ exitCode: 0, stdout: '', stderr: '' });
    });
    await adapter.list();
    expect(args).toContain('-a');
  });

  it('reads the published ports of a stopped container from its host config', () => {
    const [container] = parseInspect(
      JSON.stringify([
        {
          Id: 'c'.repeat(64),
          Name: '/pg-off',
          Config: { Image: 'postgres:16', Env: [] },
          State: { Status: 'exited' },
          HostConfig: { PortBindings: { '5432/tcp': [{ HostPort: '5450' }] } },
          NetworkSettings: { Ports: {} },
        },
      ]),
    );
    expect(container).toMatchObject({
      state: 'exited',
      ports: [{ containerPort: 5432, hostPort: 5450 }],
    });
  });

  it('starts a container, and reports why it could not', async () => {
    const ok = new DockerCliAdapter(
      runner({ start: { exitCode: 0, stdout: 'pg\n', stderr: '' } }),
    );
    await expect(ok.start('pg')).resolves.toBeUndefined();

    const gone = new DockerCliAdapter(
      runner({
        start: { exitCode: 1, stdout: '', stderr: 'No such container: pg\n' },
      }),
    );
    await expect(gone.start('pg')).rejects.toThrow('No such container: pg');

    const down = new DockerCliAdapter(
      runner({
        start: {
          exitCode: 1,
          stdout: '',
          stderr: 'failed to connect to the docker API',
        },
      }),
    );
    await expect(down.start('pg')).rejects.toBeInstanceOf(
      DockerUnavailableError,
    );
  });

  it('answers an empty list without inspecting when nothing runs', async () => {
    const calls: string[] = [];
    const adapter = new DockerCliAdapter((options) => {
      calls.push(options.args[0] ?? '');
      return Promise.resolve({ exitCode: 0, stdout: '', stderr: '' });
    });
    expect(await adapter.list()).toEqual([]);
    expect(calls).toEqual(['ps']);
  });

  it('tells a missing Docker from a stopped daemon', async () => {
    const missing = new DockerCliAdapter(
      runner({
        ps: { exitCode: -1, stdout: '', stderr: '', failure: 'notFound' },
      }),
    );
    await expect(missing.list()).rejects.toMatchObject({
      reason: 'notInstalled',
    });

    const stopped = new DockerCliAdapter(
      runner({
        ps: {
          exitCode: 1,
          stdout: '',
          stderr: 'Cannot connect to the Docker daemon\nmore',
        },
      }),
    );
    const error = await stopped.list().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DockerUnavailableError);
    expect(error).toMatchObject({
      reason: 'notRunning',
      message: 'Cannot connect to the Docker daemon',
    });
  });

  it('survives garbage from inspect', () => {
    expect(parseInspect('not json')).toEqual([]);
    expect(parseInspect('{}')).toEqual([]);
  });

  it('reads the tag out of every image notation', () => {
    expect(tagOf('postgres')).toBe('latest');
    expect(tagOf('postgres:15')).toBe('15');
    expect(tagOf('registry:5000/team/postgres')).toBe('latest');
    expect(tagOf('registry:5000/team/postgres:14.2')).toBe('14.2');
    expect(tagOf('postgres@sha256:abc')).toBe('latest');
  });
});
