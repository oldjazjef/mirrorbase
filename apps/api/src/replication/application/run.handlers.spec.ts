import { sqlitePlugin } from '@mirrorbase/plugin-sqlite';
import { postgresPlugin } from '@mirrorbase/plugin-postgres';
import { CreateConnectionCommand } from '../../connections/application/connection.handlers';
import {
  memoryPlugin,
  newEngine,
  replicationSetup,
} from '../testing/replication-fixture';
import { CancelRunCommand, StartRunCommand } from './run.handlers';

async function setup() {
  const s = replicationSetup([
    postgresPlugin,
    sqlitePlugin,
    memoryPlugin(newEngine()),
  ]);
  const make = (
    name: string,
    pluginId: string,
    config: Record<string, unknown>,
  ) =>
    s.create.execute(
      new CreateConnectionCommand(name, pluginId, config, undefined, undefined),
    );
  return {
    s,
    pg1: await make('PG one', 'postgres', { host: 'one.example', user: 'u' }),
    pg2: await make('PG two', 'postgres', { host: 'two.example', user: 'u' }),
    pgLocal: await make('PG local', 'postgres', {
      host: 'localhost',
      user: 'u',
    }),
    pgLoopback: await make('PG loopback', 'postgres', {
      host: '127.0.0.1',
      user: 'u',
    }),
    lite: await make('Lite', 'sqlite', { path: '/tmp/a.db' }),
    mem: await make('Mem', 'memory', { host: 'm' }),
  };
}

const db = (...names: string[]) => names.map((source) => ({ source }));

describe('StartRunHandler', () => {
  it('queues a run with snapshots of the names and starts it in the background', async () => {
    const { s, pg1, pg2 } = await setup();
    const run = await s.start.execute(
      new StartRunCommand(
        pg1.id,
        pg2.id,
        [{ source: 'shop' }, { source: 'crm', target: 'crm_copy' }],
        true,
      ),
    );
    expect(run).toMatchObject({
      status: 'queued',
      sourceName: 'PG one',
      targetName: 'PG two',
      strategy: 'native',
      replaceExisting: true,
    });
    expect(run.databases.map((d) => [d.source, d.target, d.status])).toEqual([
      ['shop', 'shop', 'pending'],
      ['crm', 'crm_copy', 'pending'],
    ]);
    expect(s.executor.started).toEqual([run.id]);
  });

  it('refuses to copy between database types that cannot (yet)', async () => {
    const { s, pg1, lite } = await setup();
    await expect(
      s.start.execute(new StartRunCommand(pg1.id, lite.id, db('shop'), false)),
    ).rejects.toMatchObject({
      response: {
        code: 'transferUnsupported',
        reason: 'crossEngineUnavailable',
      },
    });
    expect(s.executor.started).toEqual([]);
  });

  it('refuses a source and target on the same server with the same database name', async () => {
    const { s, pgLocal, pgLoopback, pg1 } = await setup();
    await expect(
      s.start.execute(new StartRunCommand(pg1.id, pg1.id, db('shop'), true)),
    ).rejects.toMatchObject({
      response: { code: 'sameDatabase' },
    });
    // localhost and 127.0.0.1 are one server.
    await expect(
      s.start.execute(
        new StartRunCommand(pgLocal.id, pgLoopback.id, db('shop'), true),
      ),
    ).rejects.toMatchObject({
      response: { code: 'sameDatabase' },
    });
    // ...but a different target name on the same server is a legitimate copy.
    await expect(
      s.start.execute(
        new StartRunCommand(
          pg1.id,
          pg1.id,
          [{ source: 'shop', target: 'shop_copy' }],
          false,
        ),
      ),
    ).resolves.toBeDefined();
  });

  it('validates the selection', async () => {
    const { s, pg1, pg2 } = await setup();
    await expect(
      s.start.execute(new StartRunCommand(pg1.id, pg2.id, [], false)),
    ).rejects.toMatchObject({ response: { code: 'noDatabases' } });
    await expect(
      s.start.execute(
        new StartRunCommand(
          pg1.id,
          pg2.id,
          [
            { source: 'a', target: 'x' },
            { source: 'b', target: 'x' },
          ],
          false,
        ),
      ),
    ).rejects.toMatchObject({ response: { code: 'duplicateTarget' } });
    await expect(
      s.start.execute(
        new StartRunCommand(
          pg1.id,
          pg2.id,
          [{ source: 'a', target: '  ' }],
          false,
        ),
      ),
    ).rejects.toMatchObject({ response: { code: 'invalidName' } });
  });

  it('404s a connection that does not exist', async () => {
    const { s, pg1 } = await setup();
    await expect(
      s.start.execute(new StartRunCommand(pg1.id, 'nope', db('a'), false)),
    ).rejects.toMatchObject({
      response: { code: 'connectionNotFound' },
    });
  });

  it('allows one run at a time', async () => {
    const { s, pg1, pg2 } = await setup();
    await s.start.execute(new StartRunCommand(pg1.id, pg2.id, db('a'), false));
    await expect(
      s.start.execute(new StartRunCommand(pg1.id, pg2.id, db('b'), false)),
    ).rejects.toMatchObject({
      response: { code: 'runInProgress' },
    });
  });
});

describe('CancelRunHandler', () => {
  it('asks the executor to stop a run in progress', async () => {
    const { s, pg1, pg2 } = await setup();
    const run = await s.start.execute(
      new StartRunCommand(pg1.id, pg2.id, db('a'), false),
    );
    await s.cancel.execute(new CancelRunCommand(run.id));
    expect(s.executor.cancelled).toEqual([run.id]);
  });

  it('refuses a run that is not in progress and one that does not exist', async () => {
    const { s, pg1, pg2 } = await setup();
    const run = await s.start.execute(
      new StartRunCommand(pg1.id, pg2.id, db('a'), false),
    );
    await s.runs.update(run.id, { status: 'succeeded' });
    await expect(
      s.cancel.execute(new CancelRunCommand(run.id)),
    ).rejects.toMatchObject({ response: { code: 'runNotActive' } });
    await expect(
      s.cancel.execute(new CancelRunCommand('nope')),
    ).rejects.toMatchObject({ response: { code: 'runNotFound' } });
  });
});
