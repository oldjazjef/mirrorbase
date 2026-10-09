import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { sqlitePlugin } from '@dbreplicator/plugin-sqlite';
import { CreateConnectionCommand } from '../../connections/application/connection.handlers';
import { replicationSetup } from '../testing/replication-fixture';
import { runReplication } from './run-replication';
import { StartRunCommand } from './run.handlers';

/**
 * The whole pipeline with a REAL plugin, the REAL host (processes, work directory) and real files:
 * only the persistence is in memory. SQLite is the one database that needs no server.
 */
describe('replicating SQLite → SQLite through the real pipeline', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dr-pipeline-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  async function prepare() {
    const sourceFile = join(dir, 'orders.db');
    const db = new Database(sourceFile);
    db.exec(
      "create table customer (id integer primary key, name text); insert into customer (name) values ('Müller & Söhne'), ('Zoë');",
    );
    db.close();

    const s = replicationSetup([sqlitePlugin], { WORK_DIR: join(dir, 'work') });
    const make = (name: string, path: string) =>
      s.create.execute(
        new CreateConnectionCommand(
          name,
          'sqlite',
          { path },
          undefined,
          undefined,
        ),
      );
    const source = await make('Orders', sourceFile);
    const targetFile = join(dir, 'copies', 'orders-copy.db');
    const target = await make('Copy', targetFile);
    return { s, source, target, targetFile };
  }

  it('copies the file, keeps umlauts and leaves no dump behind', async () => {
    const { s, source, target, targetFile } = await prepare();
    const run = await s.start.execute(
      new StartRunCommand(source.id, target.id, [{ source: 'orders' }], false),
    );
    await runReplication(s.deps, run.id, new AbortController().signal);

    const finished = (await s.runs.find(run.id))!;
    expect(finished.status).toBe('succeeded');
    expect(finished.databases[0]).toMatchObject({ status: 'done' });
    expect(finished.databases[0]?.bytes).toBeGreaterThan(0);

    const copy = new Database(targetFile, { readonly: true });
    expect(copy.prepare('select name from customer order by id').all()).toEqual(
      [{ name: 'Müller & Söhne' }, { name: 'Zoë' }],
    );
    copy.close();

    expect(readdirSync(join(dir, 'work'))).toEqual([]);
    expect(s.logRepository.messages(run.id).join('\n')).toMatch(
      /Run succeeded: 1 of 1 copied/,
    );
  });

  it('refuses to overwrite an existing target unless confirmed', async () => {
    const { s, source, target } = await prepare();
    const first = await s.start.execute(
      new StartRunCommand(source.id, target.id, [{ source: 'orders' }], false),
    );
    await runReplication(s.deps, first.id, new AbortController().signal);

    const again = await s.start.execute(
      new StartRunCommand(source.id, target.id, [{ source: 'orders' }], false),
    );
    await runReplication(s.deps, again.id, new AbortController().signal);
    const refused = (await s.runs.find(again.id))!;
    expect(refused.status).toBe('failed');
    expect(refused.databases[0]).toMatchObject({
      status: 'failed',
      errorCode: 'targetExists',
    });

    const confirmed = await s.start.execute(
      new StartRunCommand(source.id, target.id, [{ source: 'orders' }], true),
    );
    await runReplication(s.deps, confirmed.id, new AbortController().signal);
    expect((await s.runs.find(confirmed.id))!.status).toBe('succeeded');
  });
});
