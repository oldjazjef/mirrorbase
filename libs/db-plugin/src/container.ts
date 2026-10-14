import { PluginError } from './error';
import type { CommandResult, HostContext } from './host';

/**
 * Plugins that provision their own Docker container ("PostgreSQL in Docker") share this: find
 * the container by name, start it when stopped, create it when missing. It only asks the host to
 * run the `docker` CLI - no plugin imports a process API.
 */
export type ContainerState = 'missing' | 'stopped' | 'running';

export interface ContainerSpec {
  /** Unique container name; the container is looked up by it on every run. */
  readonly name: string;
  readonly image: string;
  /** Arguments of `docker run -d` between the name and the image (ports, volumes, user). */
  readonly runArgs?: readonly string[];
  /** Replaces the image's own command (`tail -f /dev/null` for an image that only ships a CLI). */
  readonly entrypoint?: {
    readonly command: string;
    readonly args: readonly string[];
  };
  /**
   * Environment for the new container. Passed BY NAME (`-e KEY`), the values travel in the
   * process environment so a password never shows up in the argument list.
   */
  readonly env?: Readonly<Record<string, string>>;
  /** Values to blank out of the log. */
  readonly secrets?: readonly string[];
  /**
   * The host port the container must publish. An existing container that publishes another one (the
   * port was changed after it was created) cannot be reached where the connection points: it is
   * recreated when Mirrorbase made it, otherwise the person is told.
   */
  readonly publish?: {
    readonly containerPort: number;
    readonly hostPort: number;
  };
  /** Polled after a start or create until it answers true. */
  readonly isReady?: () => Promise<boolean>;
}

export type ContainerOutcome = 'existing' | 'started' | 'created';

/** Marks the containers Mirrorbase created itself; only those are ever removed and recreated. */
export const MANAGED_LABEL = 'app.mirrorbase.managed';

const DOCKER_DOWN =
  /cannot connect to the docker daemon|docker daemon running|failed to connect to the docker api|error during connect/i;
const NO_SUCH = /no such (object|container)/i;

const READY_TIMEOUT_MS = 60_000;
const READY_INTERVAL_MS = 1_000;
const PULL_TIMEOUT_MS = 10 * 60_000;
const DOCKER_TIMEOUT_MS = 30_000;

function firstLine(text: string): string {
  return (
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? ''
  );
}

/** Docker could not be asked at all, as a typed error. */
export function dockerUnavailable(
  result: CommandResult,
): PluginError | undefined {
  if (result.failure === 'notFound') {
    return new PluginError(
      'clientToolsMissing',
      'Docker is not installed or not on the PATH',
    );
  }
  if (DOCKER_DOWN.test(result.stderr)) {
    return new PluginError('clientToolsMissing', 'Docker is not running');
  }
  return undefined;
}

export async function containerState(
  host: HostContext,
  name: string,
): Promise<ContainerState> {
  const result = await host.run({
    command: 'docker',
    args: ['inspect', '--format', '{{.State.Status}}', name],
    logCommand: false,
    timeoutMs: DOCKER_TIMEOUT_MS,
  });
  const unavailable = dockerUnavailable(result);
  if (unavailable) throw unavailable;
  if (result.exitCode !== 0) {
    if (NO_SUCH.test(result.stderr)) return 'missing';
    throw new PluginError(
      'connectionFailed',
      firstLine(result.stderr) || 'docker inspect failed',
    );
  }
  return result.stdout.trim() === 'running' ? 'running' : 'stopped';
}

// The contract lib has no Node or DOM typings; a timer is all it needs of either.
declare function setTimeout(handler: () => void, ms: number): unknown;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntilReady(
  host: HostContext,
  spec: ContainerSpec,
): Promise<void> {
  if (!spec.isReady) return;
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (host.signal?.aborted) throw new PluginError('aborted', 'Cancelled');
    if (await spec.isReady()) return;
    await sleep(READY_INTERVAL_MS);
  }
  throw new PluginError(
    'connectionFailed',
    `Container "${spec.name}" did not become ready within ${READY_TIMEOUT_MS / 1000} seconds`,
  );
}

interface ContainerPorts {
  readonly hostPorts: readonly number[];
  readonly managed: boolean;
}

/** What the container was created with; undefined when docker's answer cannot be read. */
async function configuredPorts(
  host: HostContext,
  spec: ContainerSpec,
): Promise<ContainerPorts | undefined> {
  const result = await host.run({
    command: 'docker',
    args: [
      'inspect',
      '--format',
      `{{json .HostConfig.PortBindings}} {{index .Config.Labels "${MANAGED_LABEL}"}}`,
      spec.name,
    ],
    logCommand: false,
    timeoutMs: DOCKER_TIMEOUT_MS,
  });
  if (result.exitCode !== 0) return undefined;
  const text = result.stdout.trim();
  const split = text.lastIndexOf('} ');
  const json = split === -1 ? text : text.slice(0, split + 1);
  const label = split === -1 ? '' : text.slice(split + 2).trim();
  try {
    const bindings = JSON.parse(json) as Record<
      string,
      readonly { HostPort?: string }[] | null
    > | null;
    if (typeof bindings !== 'object') return undefined;
    const hostPorts = Object.values(bindings ?? {})
      .flatMap((list) => list ?? [])
      .map((binding) => Number(binding.HostPort))
      .filter((port) => Number.isInteger(port));
    return { hostPorts, managed: label === 'true' };
  } catch {
    return undefined;
  }
}

/**
 * Makes sure an existing container publishes the wanted port. Returns the state to continue
 * with: 'missing' when it was removed to be created again.
 */
async function reconcilePort(
  host: HostContext,
  spec: ContainerSpec,
  state: ContainerState,
): Promise<ContainerState> {
  if (!spec.publish) return state;
  const configured = await configuredPorts(host, spec);
  if (!configured || configured.hostPorts.includes(spec.publish.hostPort)) {
    return state;
  }
  const have = configured.hostPorts.length
    ? `port ${configured.hostPorts.join(', ')}`
    : 'no port';
  if (!configured.managed) {
    throw new PluginError(
      'connectionFailed',
      `Container "${spec.name}" publishes ${have} on this computer, not ${spec.publish.hostPort}. ` +
        `Change the port of the connection to match, or remove the container (docker rm -f ${spec.name}) so it is created again.`,
    );
  }
  host.log(
    'warn',
    `Container ${spec.name} publishes ${have}, not ${spec.publish.hostPort}: recreating it`,
  );
  await removeContainer(host, spec.name);
  return 'missing';
}

async function removeContainer(host: HostContext, name: string): Promise<void> {
  await host.run({
    command: 'docker',
    args: ['rm', '-f', name],
    logCommand: false,
    timeoutMs: DOCKER_TIMEOUT_MS,
  });
}

/** Makes sure the container exists and runs, and waits until it is ready. */
export async function ensureContainer(
  host: HostContext,
  spec: ContainerSpec,
): Promise<ContainerOutcome> {
  const state = await reconcilePort(
    host,
    spec,
    await containerState(host, spec.name),
  );
  if (state === 'running') {
    await waitUntilReady(host, spec);
    return 'existing';
  }

  if (state === 'stopped') {
    host.log('info', `Starting container ${spec.name}`);
    const started = await host.run({
      command: 'docker',
      args: ['start', spec.name],
      timeoutMs: DOCKER_TIMEOUT_MS,
    });
    if (started.exitCode !== 0) {
      throw new PluginError(
        'connectionFailed',
        firstLine(started.stderr) || `Could not start ${spec.name}`,
      );
    }
    await waitUntilReady(host, spec);
    return 'started';
  }

  host.log('info', `Creating container ${spec.name} from ${spec.image}`);
  const envNames = Object.keys(spec.env ?? {});
  const created = await host.run({
    command: 'docker',
    args: [
      'run',
      '-d',
      '--name',
      spec.name,
      '--label',
      `${MANAGED_LABEL}=true`,
      ...envNames.flatMap((key) => ['-e', key]),
      ...(spec.runArgs ?? []),
      ...(spec.entrypoint ? ['--entrypoint', spec.entrypoint.command] : []),
      spec.image,
      ...(spec.entrypoint?.args ?? []),
    ],
    ...(spec.env ? { env: spec.env } : {}),
    ...(spec.secrets ? { secrets: spec.secrets } : {}),
    // The first run may have to pull the image.
    timeoutMs: PULL_TIMEOUT_MS,
  });
  const unavailable = dockerUnavailable(created);
  if (unavailable) throw unavailable;
  if (created.exitCode !== 0) {
    // docker leaves a half-made container behind (e.g. the port is taken); it would block the name.
    await removeContainer(host, spec.name);
    throw new PluginError(
      'connectionFailed',
      firstLine(created.stderr) || `Could not create ${spec.name}`,
    );
  }
  await waitUntilReady(host, spec);
  return 'created';
}
