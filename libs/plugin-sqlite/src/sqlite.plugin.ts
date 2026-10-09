import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { accessSync, constants } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join } from 'node:path';
import Database from 'better-sqlite3';
import {
  type DatabasePlugin,
  type DumpArtifact,
  type DumpRequest,
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

export const SQLITE_DUMP_FORMAT = 'sqlite-file@1';

const FIELDS: readonly FieldDescriptor[] = [
  {
    key: 'path',
    type: 'path',
    required: true,
    label: { en: 'Database file', 'de-CH': 'Datenbankdatei' },
    help: {
      en: 'Absolute path of the SQLite file. A target file is created if it does not exist.',
      'de-CH':
        'Absoluter Pfad der SQLite-Datei. Eine Zieldatei wird angelegt, falls sie nicht existiert.',
    },
    placeholder: '/home/me/data/app.db',
  },
];

function filePath(connection: PluginConnection): string {
  const value = connection.config['path'];
  if (typeof value !== 'string' || value.length === 0) {
    throw new PluginError('invalidConfig', 'The database file path is missing');
  }
  return value;
}

/** The file's name without extension — what the app shows as the "database". */
function databaseName(path: string): string {
  const name = basename(path, extname(path));
  return name.length > 0 ? name : basename(path);
}

function removeSidecars(path: string): void {
  for (const suffix of ['-wal', '-shm', '-journal']) {
    rmSync(`${path}${suffix}`, { force: true });
  }
}

function openReadonly(path: string): Database.Database {
  try {
    return new Database(path, { readonly: true, fileMustExist: true });
  } catch (error) {
    throw new PluginError('connectionFailed', messageOf(error));
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** SQLite: the connection IS one database file. Copies use SQLite's online backup. */
export const sqlitePlugin: DatabasePlugin = {
  id: 'sqlite',
  name: 'SQLite',
  description: {
    en: 'A single database file on this computer.',
    'de-CH': 'Eine einzelne Datenbankdatei auf diesem Computer.',
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
    const problems = validateFields(FIELDS, connection);
    const path = connection.config['path'];
    if (
      problems.length === 0 &&
      typeof path === 'string' &&
      !isAbsolute(path)
    ) {
      problems.push({ field: 'path', code: 'invalidFormat' });
    }
    return problems;
  },

  async testConnection(
    _host: HostContext,
    connection: PluginConnection,
    options: TestOptions = {},
  ): Promise<TestResult> {
    const path = filePath(connection);
    if (options.role === 'target' && !existsSync(path)) {
      try {
        accessSync(findExistingDirectory(dirname(path)), constants.W_OK);
        return {
          ok: true,
          message: 'The file does not exist yet and will be created.',
        };
      } catch {
        return {
          ok: false,
          message: 'The folder of the file is not writable.',
        };
      }
    }
    try {
      const db = openReadonly(path);
      try {
        const row = db.prepare('select sqlite_version() as v').get() as {
          v: string;
        };
        db.pragma('schema_version', { simple: true });
        return { ok: true, serverVersion: `SQLite ${row.v}` };
      } finally {
        db.close();
      }
    } catch (error) {
      return { ok: false, message: messageOf(error) };
    }
  },

  async listDatabases(
    _host: HostContext,
    connection: PluginConnection,
  ): Promise<string[]> {
    const path = filePath(connection);
    openReadonly(path).close();
    return [databaseName(path)];
  },

  async dump(
    host: HostContext,
    connection: PluginConnection,
    request: DumpRequest,
  ): Promise<DumpArtifact> {
    const source = filePath(connection);
    const file = join(request.outputDir, `${request.database}.sqlite`);
    host.log(
      'info',
      `Backing up ${basename(source)} with the SQLite backup API`,
    );
    const db = openReadonly(source);
    try {
      await db.backup(file);
    } catch (error) {
      throw new PluginError('dumpFailed', messageOf(error));
    } finally {
      db.close();
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
    const target = filePath(connection);
    if (request.artifact.format !== SQLITE_DUMP_FORMAT) {
      throw new PluginError(
        'restoreFailed',
        `Cannot restore a "${request.artifact.format}" dump into SQLite`,
      );
    }
    if (existsSync(target) && !request.replaceExisting) {
      throw new PluginError(
        'targetExists',
        `${basename(target)} already exists`,
      );
    }
    mkdirSync(dirname(target), { recursive: true });
    // Written next to the target and renamed over it: the target is never half a database.
    const staging = `${target}.restoring-${randomBytes(4).toString('hex')}`;
    try {
      const copy = new Database(request.artifact.file, {
        readonly: true,
        fileMustExist: true,
      });
      try {
        // The dump is a copy of a consistent database; verify before it replaces anything.
        const check = copy.pragma('integrity_check', { simple: true });
        if (check !== 'ok') {
          throw new PluginError('restoreFailed', `Integrity check: ${check}`);
        }
        host.log('info', `Writing ${basename(target)}`);
      } finally {
        copy.close();
      }
      return await copyThenSwap(request.artifact.file, staging, target);
    } catch (error) {
      rmSync(staging, { force: true });
      if (error instanceof PluginError) throw error;
      throw new PluginError('restoreFailed', messageOf(error));
    }
  },
};

async function copyAsync(from: string, to: string): Promise<void> {
  const db = new Database(from, { readonly: true, fileMustExist: true });
  try {
    await db.backup(to);
  } finally {
    db.close();
  }
}

async function copyThenSwapAsync(
  from: string,
  staging: string,
  target: string,
): Promise<RestoreResult> {
  await copyAsync(from, staging);
  removeSidecars(target);
  renameSync(staging, target);
  return { warnings: 0 };
}

function copyThenSwap(
  from: string,
  staging: string,
  target: string,
): Promise<RestoreResult> {
  return copyThenSwapAsync(from, staging, target).catch((error: unknown) => {
    rmSync(staging, { force: true });
    throw error instanceof PluginError
      ? error
      : new PluginError('restoreFailed', messageOf(error));
  });
}

function findExistingDirectory(path: string): string {
  let current = path;
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return current;
}
