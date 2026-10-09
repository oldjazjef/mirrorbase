import {
  type CommandResult,
  type CommandSpec,
  fieldValue,
  type FieldDescriptor,
  type HostContext,
  type PluginConnection,
  PluginError,
} from '@mirrorbase/db-plugin';

export const FIELDS: readonly FieldDescriptor[] = [
  {
    key: 'host',
    type: 'text',
    required: true,
    label: { en: 'Host', 'de-CH': 'Host' },
    placeholder: 'localhost',
    pattern: '(?!-)[A-Za-z0-9._:%\\[\\]-]+',
  },
  {
    key: 'port',
    type: 'number',
    label: { en: 'Port', 'de-CH': 'Port' },
    default: 5432,
    min: 1,
    max: 65535,
  },
  {
    key: 'user',
    type: 'text',
    required: true,
    label: { en: 'User', 'de-CH': 'Benutzer' },
    default: 'postgres',
    pattern: '(?!-)\\S+',
  },
  {
    key: 'password',
    type: 'password',
    secret: true,
    label: { en: 'Password', 'de-CH': 'Passwort' },
  },
  {
    key: 'maintenanceDb',
    type: 'text',
    advanced: true,
    label: {
      en: 'Database for the initial connection',
      'de-CH': 'Datenbank für die erste Verbindung',
    },
    help: {
      en: 'Used to list databases and to create or drop them. Usually "postgres".',
      'de-CH':
        'Wird zum Auflisten sowie zum Erstellen und Löschen von Datenbanken verwendet. Meist «postgres».',
    },
    default: 'postgres',
    pattern: '[^=\\s]+',
  },
  {
    key: 'ssl',
    type: 'select',
    advanced: true,
    label: { en: 'SSL mode', 'de-CH': 'SSL-Modus' },
    default: 'prefer',
    options: [
      { value: 'disable', label: { en: 'Disable' } },
      { value: 'prefer', label: { en: 'Prefer' } },
      { value: 'require', label: { en: 'Require' } },
    ],
  },
  {
    key: 'clientMode',
    type: 'select',
    advanced: true,
    label: { en: 'Client tools', 'de-CH': 'Client-Werkzeuge' },
    help: {
      en: 'psql and pg_dump from this computer, or from a Docker image. Automatic uses local tools when installed.',
      'de-CH':
        'psql und pg_dump von diesem Computer oder aus einem Docker-Image. Automatisch nimmt lokale Werkzeuge, falls installiert.',
    },
    default: 'auto',
    options: [
      { value: 'auto', label: { en: 'Automatic', 'de-CH': 'Automatisch' } },
      {
        value: 'local',
        label: { en: 'Installed locally', 'de-CH': 'Lokal installiert' },
      },
      {
        value: 'docker',
        label: { en: 'Docker image', 'de-CH': 'Docker-Image' },
      },
    ],
  },
  {
    key: 'pgImage',
    type: 'text',
    advanced: true,
    label: {
      en: 'PostgreSQL image tag for the Docker client',
      'de-CH': 'PostgreSQL-Image-Tag für den Docker-Client',
    },
    help: {
      en: 'For example 16 or 15-alpine. pg_dump must not be older than the server.',
      'de-CH':
        'Zum Beispiel 16 oder 15-alpine. pg_dump darf nicht älter als der Server sein.',
    },
    default: 'latest',
    pattern: '[A-Za-z0-9_][A-Za-z0-9_.-]*',
  },
];

export interface PgTarget {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly password: string | undefined;
  readonly maintenanceDb: string;
  readonly ssl: string;
  readonly clientMode: 'auto' | 'local' | 'docker';
  readonly image: string;
}

export function pgTarget(connection: PluginConnection): PgTarget {
  const read = (key: string): string | number | boolean | undefined => {
    const field = FIELDS.find((candidate) => candidate.key === key);
    return field ? fieldValue(field, connection) : undefined;
  };
  const host = String(read('host') ?? '');
  const user = String(read('user') ?? '');
  if (host.length === 0 || user.length === 0) {
    throw new PluginError('invalidConfig', 'Host and user are required');
  }
  const mode = String(read('clientMode') ?? 'auto');
  const password = connection.secrets['password'];
  return {
    host,
    port: Number(read('port') ?? 5432),
    user,
    password: password && password.length > 0 ? password : undefined,
    maintenanceDb: String(read('maintenanceDb') ?? 'postgres'),
    ssl: String(read('ssl') ?? 'prefer'),
    clientMode: mode === 'local' || mode === 'docker' ? mode : 'auto',
    image: `postgres:${String(read('pgImage') ?? 'latest')}`,
  };
}

export type PgTool = 'psql' | 'pg_dump';

/** Which side of the bridge the client tools run on, decided once per operation. */
export interface PgClient {
  readonly mode: 'local' | 'docker';
  /** Runs `tool` against `database`, mounting `mountDir` at `/work` in Docker mode. */
  run(
    tool: PgTool,
    database: string,
    args: readonly string[],
    options?: { mountDir?: string; timeoutMs?: number },
  ): Promise<CommandResult>;
  /** The path of a file in `dir` as the tool sees it. */
  toolPath(dir: string, fileName: string): string;
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * Docker on Linux shares the host network (`--network host`, what the original script did). On
 * Windows and macOS the daemon runs in a VM where `localhost` is the VM, so a host-local server is
 * reached as `host.docker.internal`.
 */
function dockerHost(
  host: string,
  platform: string,
): { host: string; network: string[] } {
  if (platform === 'linux') return { host, network: ['--network', 'host'] };
  return {
    host: LOCAL_HOSTS.has(host.toLowerCase()) ? 'host.docker.internal' : host,
    network: [],
  };
}

async function toolInstalled(
  host: HostContext,
  tool: PgTool,
): Promise<boolean> {
  const result = await host.run({
    command: tool,
    args: ['--version'],
    logCommand: false,
    timeoutMs: 15_000,
  });
  return result.exitCode === 0;
}

/** Picks local tools or the Docker image, following `clientMode`. */
export async function openClient(
  host: HostContext,
  target: PgTarget,
): Promise<PgClient> {
  let mode: 'local' | 'docker';
  if (target.clientMode === 'auto') {
    const local =
      (await toolInstalled(host, 'psql')) &&
      (await toolInstalled(host, 'pg_dump'));
    mode = local ? 'local' : 'docker';
    host.log(
      'info',
      local
        ? 'Using the PostgreSQL client tools installed on this computer'
        : `psql/pg_dump not installed - using Docker (${target.image})`,
    );
  } else {
    mode = target.clientMode;
  }

  const env: Record<string, string> = {
    PGSSLMODE: target.ssl,
    PGCLIENTENCODING: 'UTF8',
    ...(target.password ? { PGPASSWORD: target.password } : {}),
  };
  const secrets = target.password ? [target.password] : [];

  return {
    mode,
    toolPath: (dir, fileName) =>
      mode === 'docker'
        ? `/work/${fileName}`
        : joinPath(dir, fileName, host.platform),
    run(tool, database, args, options = {}) {
      const connectionArgs = (hostName: string): string[] => [
        '-h',
        hostName,
        '-p',
        String(target.port),
        '-U',
        target.user,
        '-d',
        database,
      ];
      let spec: CommandSpec;
      if (mode === 'local') {
        spec = {
          command: tool,
          args: [...connectionArgs(target.host), ...args],
          env,
          secrets,
          ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
        };
      } else {
        const bridge = dockerHost(target.host, host.platform);
        spec = {
          command: 'docker',
          args: [
            'run',
            '--rm',
            ...bridge.network,
            // The mounted directory is private to this user; the container must be too.
            ...(host.runAsUser && options.mountDir
              ? ['--user', host.runAsUser]
              : []),
            // Names only: Docker copies the values from our process environment, so the password
            // never appears in the argument list.
            '-e',
            'PGPASSWORD',
            '-e',
            'PGSSLMODE',
            '-e',
            'PGCLIENTENCODING',
            ...(options.mountDir ? ['-v', `${options.mountDir}:/work`] : []),
            target.image,
            tool,
            ...connectionArgs(bridge.host),
            ...args,
          ],
          env,
          secrets,
          ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
        };
      }
      return host.run(spec);
    },
  };
}

function joinPath(dir: string, fileName: string, platform: string): string {
  const separator = platform === 'win32' ? '\\' : '/';
  return `${dir.replace(/[\\/]+$/, '')}${separator}${fileName}`;
}

/**
 * How the docker CLI says the daemon is unreachable - the wording changed between releases
 * ("Cannot connect to the Docker daemon" up to 28, "failed to connect to the docker API" in 29).
 */
const DOCKER_DOWN =
  /cannot connect to the docker daemon|docker daemon running|failed to connect to the docker api|error during connect/i;

export function firstLine(text: string): string {
  return (
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? ''
  );
}

/** A client that could not run at all, as a typed error. */
export function clientUnavailable(
  result: CommandResult,
  mode: string,
): PluginError | undefined {
  if (result.failure === 'notFound') {
    return new PluginError(
      'clientToolsMissing',
      mode === 'docker'
        ? 'Docker is not installed or not on the PATH'
        : 'psql / pg_dump are not installed',
    );
  }
  if (DOCKER_DOWN.test(result.stderr)) {
    return new PluginError('clientToolsMissing', 'Docker is not running');
  }
  return undefined;
}
