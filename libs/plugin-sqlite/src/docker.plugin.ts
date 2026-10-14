import { statSync } from 'node:fs';
import { join } from 'node:path';
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
  PluginError,
  type PluginConnection,
  type RestoreRequest,
  type RestoreResult,
  type TestOptions,
  type TestResult,
  validateFields,
} from '@mirrorbase/db-plugin';
import { SQLITE_DUMP_FORMAT } from './sqlite.plugin';

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
    default: 'mirrorbase-sqlite',
    pattern: '[A-Za-z0-9][A-Za-z0-9_.-]*',
  },
  {
    key: 'image',
    type: 'text',
    required: true,
    label: { en: 'Image', 'de-CH': 'Image' },
    help: {
      en: 'An image with the sqlite3 tool, for example keinos/sqlite3:latest.',
      'de-CH':
        'Ein Image mit dem sqlite3-Werkzeug, zum Beispiel keinos/sqlite3:latest.',
    },
    default: 'keinos/sqlite3:latest',
    pattern: '[A-Za-z0-9][A-Za-z0-9_./:@-]*',
  },
  {
    key: 'database',
    type: 'text',
    required: true,
    label: { en: 'Database name', 'de-CH': 'Datenbankname' },
    help: {
      en: 'The file /data/<name>.sqlite inside the container, kept in a Docker volume.',
      'de-CH':
        'Die Datei /data/<Name>.sqlite im Container, abgelegt in einem Docker-Volume.',
    },
    default: 'database',
    pattern: '[A-Za-z0-9][A-Za-z0-9_-]*',
  },
];

const DATA_DIR = '/data';
const EXEC_TIMEOUT_MS = 60_000;

interface DockerSettings {
  readonly name: string;
  readonly image: string;
  readonly database: string;
  /** The database file as the container sees it. */
  readonly file: string;
}

function settings(connection: PluginConnection): DockerSettings {
  const read = (key: string): string => {
    const field = FIELDS.find((candidate) => candidate.key === key);
    return field ? String(fieldValue(field, connection) ?? '') : '';
  };
  const database = read('database');
  return {
    name: read('containerName'),
    image: read('image'),
    database,
    file: `${DATA_DIR}/${database}.sqlite`,
  };
}

function containerSpec(docker: DockerSettings): ContainerSpec {
  return {
    name: docker.name,
    image: docker.image,
    runArgs: ['-v', `${docker.name}-data:${DATA_DIR}`],
    // The image ships only the CLI; something has to keep the container alive.
    entrypoint: { command: 'tail', args: ['-f', '/dev/null'] },
  };
}

function firstLine(text: string): string {
  return (
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? ''
  );
}

async function exec(
  host: HostContext,
  docker: DockerSettings,
  args: readonly string[],
  options: { root?: boolean } = {},
) {
  return host.run({
    command: 'docker',
    args: [
      'exec',
      ...(options.root ? ['-u', 'root'] : []),
      docker.name,
      ...args,
    ],
    timeoutMs: EXEC_TIMEOUT_MS,
  });
}

async function fileExists(
  host: HostContext,
  docker: DockerSettings,
): Promise<boolean> {
  return (await exec(host, docker, ['test', '-e', docker.file])).exitCode === 0;
}

async function integrityCheck(
  host: HostContext,
  docker: DockerSettings,
  file: string,
): Promise<string> {
  const result = await exec(host, docker, [
    'sqlite3',
    '-readonly',
    file,
    'PRAGMA integrity_check;',
  ]);
  if (result.exitCode !== 0) {
    return firstLine(result.stderr) || 'sqlite3 failed';
  }
  return firstLine(result.stdout);
}

async function prepare(
  host: HostContext,
  connection: PluginConnection,
): Promise<DockerSettings> {
  const docker = settings(connection);
  await ensureContainer(host, containerSpec(docker));
  return docker;
}

/**
 * SQLite inside a Docker container Mirrorbase creates and starts itself: a named volume holds the
 * file, `docker cp` moves it in and out and the sqlite3 CLI of the image verifies it.
 */
export const sqliteDockerPlugin: DatabasePlugin = {
  id: 'sqlite-docker',
  name: 'SQLite (Docker)',
  description: {
    en: 'A SQLite file in a container on this computer. The container is created from an image when it does not exist.',
    'de-CH':
      'Eine SQLite-Datei in einem Container auf diesem Computer. Der Container wird aus einem Image angelegt, falls er nicht existiert.',
  },
  version: '1.0.0',
  icon: 'file',
  capabilities: {
    canBeSource: true,
    canBeTarget: true,
    multipleDatabases: false,
    dockerDiscovery: false,
  },
  connectionFields: FIELDS,
  dumpFormat: SQLITE_DUMP_FORMAT,

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
    await ensureContainer(host, containerSpec(docker));
    const version = await exec(host, docker, ['sqlite3', '--version']);
    if (version.exitCode !== 0) {
      return {
        ok: false,
        message: firstLine(version.stderr) || 'sqlite3 is not available',
      };
    }
    if (options.role !== 'target' && !(await fileExists(host, docker))) {
      return {
        ok: false,
        message: `${docker.database}.sqlite does not exist in the container.`,
      };
    }
    return {
      ok: true,
      serverVersion:
        `SQLite ${firstLine(version.stdout).split(' ')[0] ?? ''}`.trim(),
    };
  },

  async listDatabases(
    host: HostContext,
    connection: PluginConnection,
  ): Promise<string[]> {
    const docker = await prepare(host, connection);
    if (!(await fileExists(host, docker))) {
      throw new PluginError(
        'connectionFailed',
        `${docker.database}.sqlite does not exist in the container`,
      );
    }
    return [docker.database];
  },

  async dump(
    host: HostContext,
    connection: PluginConnection,
    request: DumpRequest,
  ): Promise<DumpArtifact> {
    const docker = await prepare(host, connection);
    const file = join(request.outputDir, `${request.database}.sqlite`);
    host.log('info', `Copying ${docker.database}.sqlite out of ${docker.name}`);
    const copied = await host.run({
      command: 'docker',
      args: ['cp', `${docker.name}:${docker.file}`, file],
      timeoutMs: EXEC_TIMEOUT_MS,
    });
    if (copied.exitCode !== 0) {
      throw new PluginError(
        'dumpFailed',
        firstLine(copied.stderr) || 'docker cp failed',
      );
    }
    return {
      database: request.database,
      file,
      bytes: statSync(file).size,
      format: SQLITE_DUMP_FORMAT,
    };
  },

  async restore(
    host: HostContext,
    connection: PluginConnection,
    request: RestoreRequest,
  ): Promise<RestoreResult> {
    if (request.artifact.format !== SQLITE_DUMP_FORMAT) {
      throw new PluginError(
        'restoreFailed',
        `Cannot restore a "${request.artifact.format}" dump into SQLite`,
      );
    }
    const docker = await prepare(host, connection);
    if (!request.replaceExisting && (await fileExists(host, docker))) {
      throw new PluginError(
        'targetExists',
        `${docker.database}.sqlite already exists`,
      );
    }

    // Copied next to the target and moved over it: the target is never half a database.
    const staging = `${docker.file}.restoring`;
    host.log('info', `Copying the database into ${docker.name}`);
    const copied = await host.run({
      command: 'docker',
      args: ['cp', request.artifact.file, `${docker.name}:${staging}`],
      timeoutMs: EXEC_TIMEOUT_MS,
    });
    if (copied.exitCode !== 0) {
      throw new PluginError(
        'restoreFailed',
        firstLine(copied.stderr) || 'docker cp failed',
      );
    }
    try {
      const check = await integrityCheck(host, docker, staging);
      if (check !== 'ok') {
        throw new PluginError('restoreFailed', `Integrity check: ${check}`);
      }
      const moved = await exec(
        host,
        docker,
        [
          'sh',
          '-c',
          `rm -f "${docker.file}-wal" "${docker.file}-shm" "${docker.file}-journal" && mv -f "${staging}" "${docker.file}"`,
        ],
        { root: true },
      );
      if (moved.exitCode !== 0) {
        throw new PluginError(
          'restoreFailed',
          firstLine(moved.stderr) || 'Could not replace the database file',
        );
      }
    } catch (error) {
      await exec(host, docker, ['rm', '-f', staging], { root: true });
      throw error;
    }
    return { warnings: 0 };
  },
};
