import { existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PluginError } from '@mirrorbase/db-plugin';
import { CreateConnectionCommand } from '../../connections/application/connection.handlers';
import {
  newEngine,
  memoryPlugin,
  replicationSetup,
} from '../testing/replication-fixture';
import { runReplication } from './run-replication';
import { StartRunCommand } from './run.handlers';

const SOURCE_PASSWORD = 'source-pw-12345';
const TARGET_PASSWORD = 'target-pw-67890';

async function setup() {
  const engine = newEngine();
  engine.stores.set(
    'src.example',
    new Map([
      ['alpha', 'AAAA'],
      ['beta', 'BB'],
    ]),
  );
  const s = replicationSetup([memoryPlugin(engine)]);
  const source = await s.create.execute(
    new CreateConnectionCommand(
      'Source',
      'memory',
      { host: 'src.example' },
      { password: SOURCE_PASSWORD },
      undefined,
    ),
  );
  const target = await s.create.execute(
    new CreateConnectionCommand(
      'Target',
      'memory',
      { host: 'dst.example' },
      { password: TARGET_PASSWORD },
      undefined,
    ),
  );
  const startRun = (names: string[], replace = false) =>
    s.start.execute(
      new StartRunCommand(
        source.id,
        target.id,
        names.map((name) => ({ source: name })),
        replace,
      ),
    );
  return { engine, s, source, target, startRun };
}

describe('runReplication', () => {
  it('copies every selected database and records progress step by step', async () => {
    const { engine, s, startRun } = await setup();
    const run = await startRun(['alpha', 'beta']);
    await runReplication(s.deps, run.id, new AbortController().signal);

    const finished = (await s.runs.find(run.id))!;
    expect(finished.status).toBe('succeeded');
    expect(
      finished.databases.map((d) => [d.source, d.status, d.bytes]),
    ).toEqual([
      ['alpha', 'done', 4],
      ['beta', 'done', 2],
    ]);
    expect(finished.startedAt).not.toBeNull();
    expect(finished.finishedAt).not.toBeNull();
    expect(engine.stores.get('dst.example')?.get('alpha')).toBe('restored:4');

    // A poller sees dumping → restoring → done for the first database.
    const seen = s.runs.history.map((r) => r.databases[0]?.status);
    expect(seen).toEqual(
      expect.arrayContaining(['dumping', 'restoring', 'done']),
    );
  });

  it("uses the target's own password for the target and the source's for the source", async () => {
    const { engine, s, startRun } = await setup();
    await runReplication(
      s.deps,
      (await startRun(['alpha'])).id,
      new AbortController().signal,
    );
    expect(engine.restoreCalls.map((c) => c.password)).toEqual([
      TARGET_PASSWORD,
    ]);
  });

  it('keeps going when one database fails, and says how many', async () => {
    const { engine, s, startRun } = await setup();
    engine.stores.set('dst.example', new Map([['alpha', 'old']]));
    const run = await startRun(['alpha', 'beta']);
    await runReplication(s.deps, run.id, new AbortController().signal);

    const finished = (await s.runs.find(run.id))!;
    expect(finished.status).toBe('failed');
    expect(finished.error).toBe('1 of 2 databases failed (1 copied)');
    expect(finished.databases[0]).toMatchObject({
      status: 'failed',
      errorCode: 'targetExists',
    });
    expect(finished.databases[1]).toMatchObject({ status: 'done' });
    // The existing database was left alone.
    expect(engine.stores.get('dst.example')?.get('alpha')).toBe('old');
  });

  it('replaces an existing database only when the run was started with that confirmation', async () => {
    const { engine, s, startRun } = await setup();
    engine.stores.set('dst.example', new Map([['alpha', 'old']]));
    const run = await startRun(['alpha'], true);
    await runReplication(s.deps, run.id, new AbortController().signal);
    expect((await s.runs.find(run.id))!.status).toBe('succeeded');
    expect(engine.restoreCalls[0]?.replace).toBe(true);
    expect(engine.stores.get('dst.example')?.get('alpha')).toBe('restored:4');
  });

  it('records an unexpected crash of a plugin as that database failing', async () => {
    const { engine, s, startRun } = await setup();
    engine.failRestore.set('alpha', new Error('socket hang up'));
    const run = await startRun(['alpha', 'beta']);
    await runReplication(s.deps, run.id, new AbortController().signal);
    const finished = (await s.runs.find(run.id))!;
    expect(finished.databases[0]).toMatchObject({
      status: 'failed',
      errorCode: 'unexpected',
      error: 'socket hang up',
    });
    expect(finished.databases[1]?.status).toBe('done');
  });

  it('stops on cancel: the database in flight and the rest end as cancelled', async () => {
    const { engine, s, startRun } = await setup();
    const controller = new AbortController();
    engine.onBeforeRestore = () => controller.abort();
    engine.failRestore.set('alpha', new PluginError('aborted', 'aborted'));
    const run = await startRun(['alpha', 'beta']);
    await runReplication(s.deps, run.id, controller.signal);
    const finished = (await s.runs.find(run.id))!;
    expect(finished.status).toBe('cancelled');
    expect(finished.databases.map((d) => d.status)).toEqual([
      'cancelled',
      'cancelled',
    ]);
    expect(engine.stores.get('dst.example')?.has('beta')).toBeFalsy();
  });

  it('never writes a password into the log, even when a plugin error contains it', async () => {
    const { engine, s, startRun } = await setup();
    engine.failRestore.set(
      'alpha',
      new PluginError(
        'connectionFailed',
        `FATAL: password ${TARGET_PASSWORD} rejected`,
      ),
    );
    const run = await startRun(['alpha']);
    await runReplication(s.deps, run.id, new AbortController().signal);
    const log = s.logRepository.messages(run.id).join('\n');
    expect(log).toContain('failed');
    expect(log).not.toContain(TARGET_PASSWORD);
    expect(log).not.toContain(SOURCE_PASSWORD);
  });

  it('removes the work directory (full database dumps) when it is done - success or not', async () => {
    const { engine, s, startRun } = await setup();
    await runReplication(
      s.deps,
      (await startRun(['alpha'])).id,
      new AbortController().signal,
    );
    engine.failRestore.set('beta', new Error('boom'));
    await runReplication(
      s.deps,
      (await startRun(['beta'])).id,
      new AbortController().signal,
    );

    const root = join(tmpdir(), 'mirrorbase');
    const leftovers = existsSync(root)
      ? readdirSync(root).filter((name) => name.startsWith('run-'))
      : [];
    expect(leftovers).toEqual([]);
  });

  it('fails a run whose connection was deleted in the meantime', async () => {
    const { s, source, startRun } = await setup();
    const run = await startRun(['alpha']);
    s.repository.rows.delete(source.id);
    await runReplication(s.deps, run.id, new AbortController().signal);
    const finished = (await s.runs.find(run.id))!;
    expect(finished.status).toBe('failed');
    expect(finished.databases[0]?.status).toBe('failed');
  });

  it('remembers when each connection was last used', async () => {
    const { s, source, target, startRun } = await setup();
    await runReplication(
      s.deps,
      (await startRun(['alpha'])).id,
      new AbortController().signal,
    );
    expect(s.repository.rows.get(source.id)?.lastUsedAt).not.toBeNull();
    expect(s.repository.rows.get(target.id)?.lastUsedAt).not.toBeNull();
  });
});
