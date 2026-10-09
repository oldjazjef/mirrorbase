import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import {
  createFakeHost,
  PluginError,
  type PluginConnection,
} from '@dbreplicator/db-plugin';
import { SQLITE_DUMP_FORMAT, sqlitePlugin } from './sqlite.plugin';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dr-sqlite-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function connection(path: string): PluginConnection {
  return { config: { path }, secrets: {} };
}

function createSource(name = 'orders.db'): string {
  const path = join(dir, name);
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.exec('create table item (id integer primary key, name text)');
  db.prepare('insert into item (name) values (?)').run('Müller & Söhne');
  db.close();
  return path;
}

describe('sqlite plugin', () => {
  const host = createFakeHost();

  it('declares itself as a single-file source and target', () => {
    expect(sqlitePlugin.id).toBe('sqlite');
    expect(sqlitePlugin.capabilities.multipleDatabases).toBe(false);
    expect(sqlitePlugin.dumpFormat).toBe(SQLITE_DUMP_FORMAT);
  });

  it('requires an absolute path', () => {
    expect(sqlitePlugin.validate(connection('relative.db'))).toEqual([
      { field: 'path', code: 'invalidFormat' },
    ]);
    expect(sqlitePlugin.validate({ config: {}, secrets: {} })).toEqual([
      { field: 'path', code: 'required' },
    ]);
    expect(sqlitePlugin.validate(connection(join(dir, 'x.db')))).toEqual([]);
  });

  it('tests a source and reports the version', async () => {
    const result = await sqlitePlugin.testConnection(
      host,
      connection(createSource()),
    );
    expect(result.ok).toBe(true);
    expect(result.serverVersion).toMatch(/^SQLite 3\./);
  });

  it('fails a missing source but accepts a missing target in a writable folder', async () => {
    const missing = connection(join(dir, 'nope.db'));
    expect((await sqlitePlugin.testConnection(host, missing)).ok).toBe(false);
    expect(
      (await sqlitePlugin.testConnection(host, missing, { role: 'target' })).ok,
    ).toBe(true);
  });

  it('rejects a file that is not a SQLite database', async () => {
    const path = join(dir, 'text.db');
    writeFileSync(
      path,
      'this is not a database, just some text padding'.repeat(30),
    );
    expect((await sqlitePlugin.testConnection(host, connection(path))).ok).toBe(
      false,
    );
  });

  it('lists the file as its only database', async () => {
    expect(
      await sqlitePlugin.listDatabases(host, connection(createSource())),
    ).toEqual(['orders']);
  });

  it('copies a database, including a WAL source, to a new target', async () => {
    const source = createSource();
    const out = join(dir, 'work');
    mkdirSync(out);
    const artifact = await sqlitePlugin.dump(host, connection(source), {
      database: 'orders',
      outputDir: out,
    });
    expect(artifact.format).toBe(SQLITE_DUMP_FORMAT);
    expect(artifact.bytes).toBeGreaterThan(0);

    const target = join(dir, 'copy', 'orders-copy.db');
    await sqlitePlugin.restore(host, connection(target), {
      database: 'orders',
      artifact,
      replaceExisting: false,
    });
    const db = new Database(target, { readonly: true });
    expect(db.prepare('select name from item').all()).toEqual([
      { name: 'Müller & Söhne' },
    ]);
    db.close();
  });

  it('refuses to overwrite unless told to, and leaves the target untouched', async () => {
    const source = createSource();
    const out = join(dir, 'work');
    mkdirSync(out);
    const artifact = await sqlitePlugin.dump(host, connection(source), {
      database: 'orders',
      outputDir: out,
    });
    const target = join(dir, 'existing.db');
    writeFileSync(target, 'keep me');

    await expect(
      sqlitePlugin.restore(host, connection(target), {
        database: 'orders',
        artifact,
        replaceExisting: false,
      }),
    ).rejects.toMatchObject({ code: 'targetExists' });
    expect(readFileSync(target, 'utf8')).toBe('keep me');

    await sqlitePlugin.restore(host, connection(target), {
      database: 'orders',
      artifact,
      replaceExisting: true,
    });
    const db = new Database(target, { readonly: true });
    expect(db.prepare('select count(*) c from item').get()).toEqual({ c: 1 });
    db.close();
  });

  it('refuses a dump of another format', async () => {
    await expect(
      sqlitePlugin.restore(host, connection(join(dir, 't.db')), {
        database: 'x',
        artifact: {
          database: 'x',
          file: 'f',
          bytes: 1,
          format: 'postgres-sql@1',
        },
        replaceExisting: true,
      }),
    ).rejects.toBeInstanceOf(PluginError);
  });
});
