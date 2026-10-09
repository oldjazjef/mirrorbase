import 'reflect-metadata';

import { execFileSync } from 'node:child_process';
import {
  CreateConnectionCommand,
  TestConnectionCommand,
  ListConnectionDatabasesQuery,
} from '../connections/application/connection.handlers';
import { replicationSetup } from '../replication/testing/replication-fixture';
import { runReplication } from '../replication/application/run-replication';
import { StartRunCommand } from '../replication/application/run.handlers';
import { postgresPlugin } from '@mirrorbase/plugin-postgres';

/**
 * The PostgreSQL plugin against a REAL server, through the real host (psql / pg_dump processes).
 * Needs a server: set MB_TEST_PG_HOST, MB_TEST_PG_PORT, MB_TEST_PG_USER, MB_TEST_PG_PASSWORD
 * (CI uses a service container). Without them the suite is skipped.
 */
const HOST = process.env['MB_TEST_PG_HOST'];
const PORT = process.env['MB_TEST_PG_PORT'] ?? '5432';
const USER = process.env['MB_TEST_PG_USER'] ?? 'postgres';
const PASSWORD = process.env['MB_TEST_PG_PASSWORD'] ?? '';

function psql(database: string, sql: string): string {
  return execFileSync(
    'psql',
    [
      '-h',
      HOST!,
      '-p',
      PORT,
      '-U',
      USER,
      '-d',
      database,
      '-X',
      '-t',
      '-A',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      sql,
    ],
    { env: { ...process.env, PGPASSWORD: PASSWORD }, encoding: 'utf8' },
  ).trim();
}

const SUFFIX = `${Date.now()}`;
const SHOP = `dr_shop_${SUFFIX}`;
const RESERVED = `authorization`;
const COPY = (name: string) => `${name}_copy`;

describe.skipIf(!HOST)('postgres plugin against a real server', () => {
  async function setup(pgImage = 'latest', clientMode = 'auto') {
    const s = replicationSetup([postgresPlugin], { WORK_DIR: '' });
    const config = (host: string) => ({
      host,
      port: PORT,
      user: USER,
      clientMode,
      pgImage,
    });
    const source = await s.create.execute(
      new CreateConnectionCommand(
        'Source',
        'postgres',
        config(HOST!),
        { password: PASSWORD },
        undefined,
      ),
    );
    // Same server, reached through another spelling: the copies get other names.
    const target = await s.create.execute(
      new CreateConnectionCommand(
        'Target',
        'postgres',
        config(HOST === '127.0.0.1' ? 'localhost' : HOST!),
        { password: PASSWORD },
        undefined,
      ),
    );
    return { s, source, target };
  }

  beforeAll(() => {
    for (const name of [SHOP, RESERVED, COPY(SHOP), COPY(RESERVED)]) {
      psql('postgres', `DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    }
    psql('postgres', `CREATE DATABASE "${SHOP}"`);
    psql(
      SHOP,
      `CREATE TABLE customer (id serial primary key, name text, note text);
      INSERT INTO customer (name, note) VALUES ('Müller & Söhne', 'Grüezi – ''quoted'' "text"'), ('Zoë', 'ß€');
      CREATE VIEW customer_names AS SELECT name FROM customer;`,
    );
    psql('postgres', `CREATE DATABASE "${RESERVED}"`);
    psql(
      RESERVED,
      `CREATE TABLE t (v int); INSERT INTO t VALUES (1), (2), (3);`,
    );
  });

  afterAll(() => {
    for (const name of [SHOP, RESERVED, COPY(SHOP), COPY(RESERVED)]) {
      psql('postgres', `DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    }
  });

  it('tests the connection and lists databases (not postgres itself)', async () => {
    const { s, source } = await setup();
    const result = await s.test.execute(
      new TestConnectionCommand(
        'postgres',
        { host: HOST, port: PORT, user: USER },
        { password: PASSWORD },
        undefined,
        'source',
      ),
    );
    expect(result.ok).toBe(true);
    expect(result.serverVersion).toMatch(/^PostgreSQL \d+/);
    const databases = await s.databases.execute(
      new ListConnectionDatabasesQuery(source.id),
    );
    expect(databases).toEqual(expect.arrayContaining([SHOP, RESERVED]));
    expect(databases).not.toContain('postgres');
    expect(databases).not.toContain('template0');
  });

  it('reports a wrong password without leaking it', async () => {
    const { s } = await setup();
    const wrong = 'definitely-wrong-pw-9';
    const result = await s.test.execute(
      new TestConnectionCommand(
        'postgres',
        { host: HOST, port: PORT, user: USER },
        { password: wrong },
        undefined,
        'source',
      ),
    );
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/authentication failed/i);
    expect(s.logRepository.messages().join('\n')).not.toContain(wrong);
  });

  it('copies databases including umlauts, views and a reserved-word name', async () => {
    const { s, source, target } = await setup();
    const run = await s.start.execute(
      new StartRunCommand(
        source.id,
        target.id,
        [
          { source: SHOP, target: COPY(SHOP) },
          { source: RESERVED, target: COPY(RESERVED) },
        ],
        false,
      ),
    );
    await runReplication(s.deps, run.id, new AbortController().signal);

    const finished = (await s.runs.find(run.id))!;
    expect(finished.databases.map((d) => d.status)).toEqual(['done', 'done']);
    expect(finished.status).toBe('succeeded');
    expect(psql(COPY(SHOP), 'SELECT name FROM customer ORDER BY id')).toBe(
      'Müller & Söhne\nZoë',
    );
    expect(psql(COPY(SHOP), 'SELECT note FROM customer ORDER BY id')).toBe(
      `Grüezi – 'quoted' "text"\nß€`,
    );
    expect(psql(COPY(SHOP), 'SELECT count(*) FROM customer_names')).toBe('2');
    expect(psql(COPY(RESERVED), 'SELECT sum(v) FROM t')).toBe('6');
    // The password never reached the log.
    expect(s.logRepository.messages(run.id).join('\n')).not.toContain(
      PASSWORD || '\u0000',
    );
    expect(s.logRepository.messages(run.id).join('\n')).toMatch(
      /Run succeeded: 2 of 2 copied/,
    );
  });

  it('will not overwrite an existing database unless the person confirmed it', async () => {
    const { s, source, target } = await setup();
    const selection = [{ source: RESERVED, target: COPY(RESERVED) }];
    psql(COPY(RESERVED), `INSERT INTO t VALUES (100)`);

    const refused = await s.start.execute(
      new StartRunCommand(source.id, target.id, selection, false),
    );
    await runReplication(s.deps, refused.id, new AbortController().signal);
    expect((await s.runs.find(refused.id))!.databases[0]).toMatchObject({
      status: 'failed',
      errorCode: 'targetExists',
    });
    expect(psql(COPY(RESERVED), 'SELECT sum(v) FROM t')).toBe('106'); // untouched

    const confirmed = await s.start.execute(
      new StartRunCommand(source.id, target.id, selection, true),
    );
    await runReplication(s.deps, confirmed.id, new AbortController().signal);
    expect((await s.runs.find(confirmed.id))!.status).toBe('succeeded');
    expect(psql(COPY(RESERVED), 'SELECT sum(v) FROM t')).toBe('6'); // replaced, even with the copy open
  });

  it('says what is wrong when the Docker client is chosen but Docker is not running', async () => {
    const { s, source, target } = await setup('16', 'docker');
    const run = await s.start.execute(
      new StartRunCommand(
        source.id,
        target.id,
        [{ source: RESERVED, target: COPY(RESERVED) }],
        true,
      ),
    );
    await runReplication(s.deps, run.id, new AbortController().signal);
    const finished = (await s.runs.find(run.id))!;
    expect(finished.status).toBe('failed');
    expect(finished.databases[0]?.errorCode).toBe('clientToolsMissing');
  });
});
