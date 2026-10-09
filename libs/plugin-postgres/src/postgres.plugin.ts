import { statSync } from 'node:fs';
import {
  type DatabasePlugin,
  type DockerContainer,
  type DumpArtifact,
  type DumpRequest,
  type FieldProblem,
  type HostContext,
  type PluginConnection,
  PluginError,
  type RestoreRequest,
  type RestoreResult,
  type TestResult,
  validateFields,
} from '@dbreplicator/db-plugin';
import {
  clientUnavailable,
  FIELDS,
  firstLine,
  openClient,
  type PgClient,
  pgTarget,
} from './client';
import { discoverPostgres } from './discovery';
import { assertSafeDatabaseName, quoteIdent, quoteLiteral } from './sql';

export const POSTGRES_DUMP_FORMAT = 'postgres-plain-sql@1';

/** Databases the app never offers: the maintenance database itself. */
const LIST_QUERY =
  "SELECT datname FROM pg_database WHERE datistemplate = false AND datname NOT IN ('postgres') ORDER BY datname";

function errorLines(stderr: string): string[] {
  return stderr.split(/\r?\n/).filter((line) => /\bERROR:/.test(line));
}

/** Queries are quick; a server that does not answer in two minutes is not going to. */
const QUERY_TIMEOUT_MS = 120_000;

async function scalar(
  client: PgClient,
  database: string,
  sql: string,
): Promise<{ ok: boolean; out: string; error: string }> {
  const result = await client.run(
    'psql',
    database,
    ['-X', '-t', '-A', '-c', sql],
    { timeoutMs: QUERY_TIMEOUT_MS },
  );
  const unavailable = clientUnavailable(result, client.mode);
  if (unavailable) throw unavailable;
  return {
    ok: result.exitCode === 0,
    out: result.stdout.trim(),
    error: firstLine(result.stderr),
  };
}

/** PostgreSQL through psql / pg_dump: installed locally, or from a Docker image. */
export const postgresPlugin: DatabasePlugin = {
  id: 'postgres',
  name: 'PostgreSQL',
  description: {
    en: 'A PostgreSQL server: local, remote or in a Docker container.',
    'de-CH':
      'Ein PostgreSQL-Server: lokal, entfernt oder in einem Docker-Container.',
  },
  version: '1.0.0',
  icon: 'database',
  capabilities: {
    canBeSource: true,
    canBeTarget: true,
    multipleDatabases: true,
    dockerDiscovery: true,
  },
  connectionFields: FIELDS,
  dumpFormat: POSTGRES_DUMP_FORMAT,

  validate(connection: PluginConnection): FieldProblem[] {
    return validateFields(FIELDS, connection);
  },

  async testConnection(
    host: HostContext,
    connection: PluginConnection,
  ): Promise<TestResult> {
    const target = pgTarget(connection);
    const client = await openClient(host, target);
    const answer = await scalar(
      client,
      target.maintenanceDb,
      'SELECT version()',
    );
    if (!answer.ok) return { ok: false, message: answer.error };
    // "PostgreSQL 16.4 (Debian 16.4-1) on x86_64-pc-linux-gnu, ..." -> "PostgreSQL 16.4"
    const version = /^PostgreSQL\s+[\w.]+/.exec(answer.out)?.[0] ?? answer.out;
    return { ok: true, serverVersion: version };
  },

  async listDatabases(
    host: HostContext,
    connection: PluginConnection,
  ): Promise<string[]> {
    const target = pgTarget(connection);
    const client = await openClient(host, target);
    const answer = await scalar(client, target.maintenanceDb, LIST_QUERY);
    if (!answer.ok) throw new PluginError('connectionFailed', answer.error);
    return answer.out.split(/\r?\n/).filter((line) => line.length > 0);
  },

  async dump(
    host: HostContext,
    connection: PluginConnection,
    request: DumpRequest,
  ): Promise<DumpArtifact> {
    assertSafeDatabaseName(request.database);
    const target = pgTarget(connection);
    const client = await openClient(host, target);
    const fileName = `${request.database.replace(/[^A-Za-z0-9._-]/g, '_')}.sql`;
    host.log('info', `Dumping ${request.database} (pg_dump, ${client.mode})`);
    const result = await client.run(
      'pg_dump',
      request.database,
      [
        '--no-owner',
        '--no-acl',
        '--encoding=UTF8',
        '-f',
        client.toolPath(request.outputDir, fileName),
      ],
      { mountDir: request.outputDir },
    );
    const unavailable = clientUnavailable(result, client.mode);
    if (unavailable) throw unavailable;
    if (result.exitCode !== 0) {
      const reason = firstLine(result.stderr);
      if (/server version mismatch/i.test(result.stderr)) {
        host.log(
          'warn',
          'pg_dump is older than the server: set "Client tools" to Docker and the image tag to the server version',
        );
      }
      throw new PluginError('dumpFailed', reason || 'pg_dump failed');
    }
    const file = client.toolPath(request.outputDir, fileName);
    // The file lives on the host in both modes (Docker mounts the directory).
    const hostFile =
      client.mode === 'docker'
        ? `${request.outputDir.replace(/[\\/]+$/, '')}${host.platform === 'win32' ? '\\' : '/'}${fileName}`
        : file;
    return {
      database: request.database,
      file: hostFile,
      bytes: statSync(hostFile).size,
      format: POSTGRES_DUMP_FORMAT,
    };
  },

  async restore(
    host: HostContext,
    connection: PluginConnection,
    request: RestoreRequest,
  ): Promise<RestoreResult> {
    assertSafeDatabaseName(request.database);
    if (request.artifact.format !== POSTGRES_DUMP_FORMAT) {
      throw new PluginError(
        'restoreFailed',
        `Cannot restore a "${request.artifact.format}" dump into PostgreSQL`,
      );
    }
    const target = pgTarget(connection);
    const client = await openClient(host, target);
    const name = request.database;

    const exists = await scalar(
      client,
      target.maintenanceDb,
      `SELECT 1 FROM pg_database WHERE datname = ${quoteLiteral(name)}`,
    );
    if (!exists.ok) throw new PluginError('connectionFailed', exists.error);

    if (exists.out === '1') {
      if (!request.replaceExisting) {
        throw new PluginError(
          'targetExists',
          `Database "${name}" already exists`,
        );
      }
      host.log('info', `Dropping existing database ${name}`);
      let dropped = await scalar(
        client,
        target.maintenanceDb,
        `DROP DATABASE ${quoteIdent(name)} WITH (FORCE)`,
      );
      if (!dropped.ok && /syntax error/i.test(dropped.error)) {
        // WITH (FORCE) is PostgreSQL 13+.
        dropped = await scalar(
          client,
          target.maintenanceDb,
          `DROP DATABASE ${quoteIdent(name)}`,
        );
      }
      if (!dropped.ok) throw new PluginError('restoreFailed', dropped.error);
    }

    host.log('info', `Creating database ${name}`);
    const created = await scalar(
      client,
      target.maintenanceDb,
      `CREATE DATABASE ${quoteIdent(name)}`,
    );
    if (!created.ok) throw new PluginError('restoreFailed', created.error);

    const directory = dirOf(request.artifact.file);
    const fileName = request.artifact.file.slice(directory.length + 1);
    host.log('info', `Restoring ${name} (psql, ${client.mode})`);
    const result = await client.run(
      'psql',
      name,
      ['-X', '-q', '-f', client.toolPath(directory, fileName)],
      { mountDir: directory },
    );
    const unavailable = clientUnavailable(result, client.mode);
    if (unavailable) throw unavailable;
    const errors = errorLines(result.stderr);
    for (const line of errors.slice(0, 20)) host.log('warn', line);
    if (errors.length > 20) {
      host.log('warn', `... and ${errors.length - 20} more errors`);
    }
    if (result.exitCode !== 0) {
      throw new PluginError(
        'restoreFailed',
        firstLine(result.stderr) || 'psql failed',
      );
    }
    return { warnings: errors.length };
  },

  discoverDocker(containers: readonly DockerContainer[]) {
    return discoverPostgres(containers);
  },
};

function dirOf(file: string): string {
  const index = Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\'));
  return index > 0 ? file.slice(0, index) : '.';
}
