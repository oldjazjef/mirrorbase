import type {
  DockerContainer,
  DockerPortBinding,
} from '@dbreplicator/db-plugin';
import {
  DockerPort,
  DockerUnavailableError,
} from '../../docker/ports/docker.port';
import type { runProcess } from '../process/run-process';

/** Names that look like credentials are dropped before a plugin ever sees the environment. */
const SECRET_NAME = /pass|secret|token|key|credential|auth/i;

const TIMEOUT_MS = 15_000;

interface InspectedContainer {
  Id?: string;
  Name?: string;
  Config?: { Image?: string; Env?: string[] | null };
  State?: { Status?: string };
  NetworkSettings?: {
    Ports?: Record<
      string,
      { HostIp?: string; HostPort?: string }[] | null
    > | null;
  };
}

/** Docker through its CLI - nothing to install beyond Docker itself, same as the old script. */
export class DockerCliAdapter extends DockerPort {
  constructor(private readonly run: typeof runProcess) {
    super();
  }

  async listRunning(): Promise<DockerContainer[]> {
    const listed = await this.run({
      command: 'docker',
      args: ['ps', '-q', '--no-trunc'],
      timeoutMs: TIMEOUT_MS,
    });
    if (listed.failure === 'notFound') {
      throw new DockerUnavailableError(
        'notInstalled',
        'docker is not installed',
      );
    }
    if (listed.exitCode !== 0) {
      throw new DockerUnavailableError(
        'notRunning',
        listed.stderr.trim().split(/\r?\n/)[0] ?? 'docker is not running',
      );
    }
    const ids = listed.stdout.split(/\s+/).filter((id) => id.length > 0);
    if (ids.length === 0) return [];

    const inspected = await this.run({
      command: 'docker',
      args: ['inspect', ...ids],
      timeoutMs: TIMEOUT_MS,
    });
    if (inspected.exitCode !== 0) {
      throw new DockerUnavailableError(
        'notRunning',
        inspected.stderr.trim().split(/\r?\n/)[0] ?? 'docker inspect failed',
      );
    }
    return parseInspect(inspected.stdout);
  }
}

export function parseInspect(json: string): DockerContainer[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const containers: DockerContainer[] = [];
  for (const raw of parsed as InspectedContainer[]) {
    if (!raw.Id) continue;
    const image = raw.Config?.Image ?? '';
    containers.push({
      id: raw.Id,
      name: (raw.Name ?? raw.Id).replace(/^\//, ''),
      image,
      imageTag: tagOf(image),
      state: raw.State?.Status ?? 'unknown',
      ports: portsOf(raw.NetworkSettings?.Ports),
      env: safeEnv(raw.Config?.Env),
    });
  }
  return containers.sort((a, b) => a.name.localeCompare(b.name));
}

/** `postgres:16-alpine` → `16-alpine`; no tag or a digest → `latest`. */
export function tagOf(image: string): string {
  if (image.includes('@')) return 'latest';
  const lastSlash = image.lastIndexOf('/');
  const colon = image.indexOf(':', lastSlash + 1);
  return colon === -1 ? 'latest' : image.slice(colon + 1);
}

function portsOf(
  ports:
    | Record<string, { HostIp?: string; HostPort?: string }[] | null>
    | null
    | undefined,
): DockerPortBinding[] {
  const result: DockerPortBinding[] = [];
  for (const [key, bindings] of Object.entries(ports ?? {})) {
    const [port, protocol = 'tcp'] = key.split('/');
    const containerPort = Number(port);
    if (!Number.isInteger(containerPort)) continue;
    for (const binding of bindings ?? []) {
      const hostPort = Number(binding.HostPort);
      if (!Number.isInteger(hostPort) || hostPort <= 0) continue;
      result.push({
        containerPort,
        protocol,
        hostIp: binding.HostIp ?? '',
        hostPort,
      });
    }
  }
  return result;
}

function safeEnv(env: string[] | null | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  for (const entry of env ?? []) {
    const index = entry.indexOf('=');
    if (index <= 0) continue;
    const name = entry.slice(0, index);
    if (SECRET_NAME.test(name)) continue;
    result[name] = entry.slice(index + 1);
  }
  return result;
}
