import {
  containerState,
  type ContainerSpec,
  type DatabasePlugin,
  type DumpArtifact,
  type DumpRequest,
  ensureContainer,
  fieldValue,
  type FieldDescriptor,
  type FieldProblem,
  type HostContext,
  type PluginConnection,
  type RestoreRequest,
  type RestoreResult,
  type TestOptions,
  type TestResult,
  validateFields,
} from '@mirrorbase/db-plugin';
import { postgresPlugin } from './postgres.plugin';

const FIELDS: readonly FieldDescriptor[] = [
  {
    key: 'containerName',
    type: 'text',
    required: true,
    label: { en: 'Container name', 'de-CH': 'Container-Name' },
    help: {
      en: 'Created when it does not exist yet, started when it is stopped.',
      'de-CH':
        'Wird angelegt, falls er noch nicht existiert, und gestartet, falls er gestoppt ist.',
    },
    default: 'mirrorbase-postgres',
    pattern: '[A-Za-z0-9][A-Za-z0-9_.-]*',
  },
  {
    key: 'image',
    type: 'text',
    required: true,
    label: { en: 'Image', 'de-CH': 'Image' },
    help: {
      en: 'A PostgreSQL image, for example postgres:16 or postgres:15-alpine.',
      'de-CH':
        'Ein PostgreSQL-Image, zum Beispiel postgres:16 oder postgres:15-alpine.',
    },
    default: 'postgres:16',
    pattern: '[A-Za-z0-9][A-Za-z0-9_./:@-]*',
  },
  {
    key: 'hostPort',
    type: 'number',
    required: true,
    label: { en: 'Port on this computer', 'de-CH': 'Port auf diesem Computer' },
    help: {
      en: 'The container is reachable on localhost at this port.',
      'de-CH': 'Der Container ist auf localhost unter diesem Port erreichbar.',
    },
    default: 5433,
    min: 1,
    max: 65535,
  },
  {
    key: 'password',
    type: 'password',
    secret: true,
    required: true,
    label: { en: 'Password', 'de-CH': 'Passwort' },
    help: {
      en: 'The password of the "postgres" user. Set when the container is created.',
      'de-CH':
        'Das Passwort des Benutzers «postgres». Wird beim Anlegen des Containers gesetzt.',
    },
  },
];

interface DockerSettings {
  readonly name: string;
  readonly image: string;
  readonly port: number;
  readonly password: string;
}

function settings(connection: PluginConnection): DockerSettings {
  const read = (key: string): string => {
    const field = FIELDS.find((candidate) => candidate.key === key);
    return field ? String(fieldValue(field, connection) ?? '') : '';
  };
  return {
    name: read('containerName'),
    image: read('image'),
    port: Number(read('hostPort')),
    password: read('password'),
  };
}

/** `postgres:16-alpine` -> `16`; only an official image's tag names the server version. */
export function clientTagFor(image: string): string {
  const lastSlash = image.lastIndexOf('/');
  const colon = image.indexOf(':', lastSlash + 1);
  const repository = colon === -1 ? image : image.slice(0, colon);
  const tag = colon === -1 ? 'latest' : image.slice(colon + 1);
  const official =
    repository === 'postgres' || repository === 'docker.io/library/postgres';
  return (official && /^(\d+)/.exec(tag)?.[1]) || 'latest';
}

function asPostgres(
  connection: PluginConnection,
  port: number,
): PluginConnection {
  const { image, password } = settings(connection);
  return {
    config: {
      host: 'localhost',
      port,
      user: 'postgres',
      maintenanceDb: 'postgres',
      ssl: 'disable',
      clientMode: 'auto',
      pgImage: clientTagFor(image),
    },
    secrets: { password },
  };
}

function containerSpec(
  host: HostContext,
  docker: DockerSettings,
): ContainerSpec {
  return {
    name: docker.name,
    image: docker.image,
    runArgs: ['-p', `127.0.0.1:${docker.port}:5432`],
    publish: { containerPort: 5432, hostPort: docker.port },
    env: { POSTGRES_PASSWORD: docker.password },
    secrets: [docker.password],
    // The entrypoint first runs a temporary server that listens on the socket only: asking over
    // TCP is what tells that the final server is up.
    isReady: async () => {
      const result = await host.run({
        command: 'docker',
        args: [
          'exec',
          docker.name,
          'pg_isready',
          '-h',
          '127.0.0.1',
          '-U',
          'postgres',
        ],
        logCommand: false,
        timeoutMs: 15_000,
      });
      return result.exitCode === 0;
    },
  };
}

/** The port the running container really publishes (it may have been created by hand). */
async function publishedPort(
  host: HostContext,
  docker: DockerSettings,
): Promise<number> {
  const result = await host.run({
    command: 'docker',
    args: ['port', docker.name, '5432/tcp'],
    logCommand: false,
    timeoutMs: 15_000,
  });
  const match = /:(\d+)\s*$/m.exec(result.stdout);
  return result.exitCode === 0 && match ? Number(match[1]) : docker.port;
}

/** Brings the container up and returns the plain PostgreSQL connection to it. */
async function prepare(
  host: HostContext,
  connection: PluginConnection,
): Promise<PluginConnection> {
  const docker = settings(connection);
  await ensureContainer(host, containerSpec(host, docker));
  return asPostgres(connection, await publishedPort(host, docker));
}

/**
 * PostgreSQL in a Docker container Mirrorbase creates and starts itself. Everything else - dump,
 * restore, listing - is the PostgreSQL plugin, pointed at that container.
 */
export const postgresDockerPlugin: DatabasePlugin = {
  id: 'postgres-docker',
  name: 'PostgreSQL (Docker)',
  description: {
    en: 'A PostgreSQL container on this computer. Created from an image when it does not exist.',
    'de-CH':
      'Ein PostgreSQL-Container auf diesem Computer. Wird aus einem Image angelegt, falls er nicht existiert.',
  },
  version: '1.0.0',
  icon: 'database',
  capabilities: {
    canBeSource: true,
    canBeTarget: true,
    multipleDatabases: true,
    dockerDiscovery: false,
  },
  connectionFields: FIELDS,
  dumpFormat: postgresPlugin.dumpFormat,

  validate(connection: PluginConnection): FieldProblem[] {
    return validateFields(FIELDS, connection);
  },

  async prepare(
    host: HostContext,
    connection: PluginConnection,
  ): Promise<void> {
    await prepare(host, connection);
  },

  async testConnection(
    host: HostContext,
    connection: PluginConnection,
    options: TestOptions = {},
  ): Promise<TestResult> {
    const docker = settings(connection);
    const state = await containerState(host, docker.name);
    if (state === 'missing') {
      return options.role === 'target'
        ? {
            ok: true,
            message: `Container "${docker.name}" does not exist yet and will be created from ${docker.image}.`,
          }
        : { ok: false, message: `Container "${docker.name}" does not exist.` };
    }
    return postgresPlugin.testConnection(
      host,
      await prepare(host, connection),
      options,
    );
  },

  async listDatabases(
    host: HostContext,
    connection: PluginConnection,
  ): Promise<string[]> {
    return postgresPlugin.listDatabases(host, await prepare(host, connection));
  },

  async dump(
    host: HostContext,
    connection: PluginConnection,
    request: DumpRequest,
  ): Promise<DumpArtifact> {
    return postgresPlugin.dump(host, await prepare(host, connection), request);
  },

  async restore(
    host: HostContext,
    connection: PluginConnection,
    request: RestoreRequest,
  ): Promise<RestoreResult> {
    return postgresPlugin.restore(
      host,
      await prepare(host, connection),
      request,
    );
  },
};
