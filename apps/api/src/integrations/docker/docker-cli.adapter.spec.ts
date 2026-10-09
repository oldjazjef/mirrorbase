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
    const containers = await adapter.listRunning();
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

  it('answers an empty list without inspecting when nothing runs', async () => {
    const calls: string[] = [];
    const adapter = new DockerCliAdapter((options) => {
      calls.push(options.args[0] ?? '');
      return Promise.resolve({ exitCode: 0, stdout: '', stderr: '' });
    });
    expect(await adapter.listRunning()).toEqual([]);
    expect(calls).toEqual(['ps']);
  });

  it('tells a missing Docker from a stopped daemon', async () => {
    const missing = new DockerCliAdapter(
      runner({
        ps: { exitCode: -1, stdout: '', stderr: '', failure: 'notFound' },
      }),
    );
    await expect(missing.listRunning()).rejects.toMatchObject({
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
    const error = await stopped.listRunning().catch((e: unknown) => e);
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
