import { type DatabasePlugin, PluginError } from '@mirrorbase/db-plugin';
import { sqlitePlugin } from '@mirrorbase/plugin-sqlite';
import { connectionSetup } from '../testing/connection-fixture';
import {
  CreateConnectionCommand,
  DeleteConnectionCommand,
  GetConnectionQuery,
  ListConnectionDatabasesQuery,
  ListConnectionsQuery,
  TestConnectionCommand,
  UpdateConnectionCommand,
} from './connection.handlers';

const PG = {
  host: 'db.example.com',
  port: '5433',
  user: 'admin',
};

describe('connection handlers', () => {
  it('saves a connection with its password sealed and never returns the password', async () => {
    const s = connectionSetup();
    const created = await s.create.execute(
      new CreateConnectionCommand(
        'Prod',
        'postgres',
        PG,
        { password: 'Sup3r-Secret!' },
        undefined,
      ),
    );
    expect(created).toMatchObject({
      name: 'Prod',
      pluginId: 'postgres',
      config: { host: 'db.example.com', port: 5433, user: 'admin' },
      secretKeys: ['password'],
    });
    expect(JSON.stringify(created)).not.toContain('Sup3r-Secret!');

    const stored = s.repository.rows.get(created.id)!;
    expect(stored.sealedSecrets['password']).toMatch(/^enc:v1:/);
    expect(JSON.stringify([...s.repository.rows.values()])).not.toContain(
      'Sup3r-Secret!',
    );
    expect(s.secrets.open(stored)).toEqual({ password: 'Sup3r-Secret!' });

    const listed = await s.list.execute(new ListConnectionsQuery());
    expect(JSON.stringify(listed)).not.toContain('enc:v1');
    expect(listed[0]).not.toHaveProperty('sealedSecrets');
  });

  it('refuses to save a password when the app has no encryption key', async () => {
    const s = connectionSetup(undefined, { SETTINGS_ENCRYPTION_KEY: '' });
    await expect(
      s.create.execute(
        new CreateConnectionCommand(
          'X',
          'postgres',
          PG,
          { password: 'p' },
          undefined,
        ),
      ),
    ).rejects.toMatchObject({ response: { code: 'secretsUnavailable' } });
    // Without a password nothing needs the key.
    await expect(
      s.create.execute(
        new CreateConnectionCommand('Y', 'postgres', PG, undefined, undefined),
      ),
    ).resolves.toBeDefined();
  });

  it('validates through the plugin and reports the field problems', async () => {
    const s = connectionSetup();
    await expect(
      s.create.execute(
        new CreateConnectionCommand(
          'Bad',
          'postgres',
          { port: '99999' },
          undefined,
          undefined,
        ),
      ),
    ).rejects.toMatchObject({
      response: {
        code: 'invalidConnection',
        problems: expect.arrayContaining([
          { field: 'host', code: 'required' },
          { field: 'port', code: 'outOfRange' },
        ]),
      },
    });
    expect(s.repository.rows.size).toBe(0);
  });

  it('works for any plugin through its declared fields', async () => {
    const s = connectionSetup();
    const created = await s.create.execute(
      new CreateConnectionCommand(
        'Local file',
        'sqlite',
        { path: '/data/app.db', junk: 1 },
        { password: 'ignored' },
        undefined,
      ),
    );
    expect(created.config).toEqual({ path: '/data/app.db' });
    expect(created.secretKeys).toEqual([]);
  });

  it('rejects an unknown plugin and a duplicate or empty name', async () => {
    const s = connectionSetup();
    await expect(
      s.create.execute(
        new CreateConnectionCommand('A', 'oracle', {}, undefined, undefined),
      ),
    ).rejects.toMatchObject({ response: { code: 'unknownPlugin' } });
    await s.create.execute(
      new CreateConnectionCommand(
        'A',
        'sqlite',
        { path: '/a.db' },
        undefined,
        undefined,
      ),
    );
    await expect(
      s.create.execute(
        new CreateConnectionCommand(
          '  A ',
          'sqlite',
          { path: '/b.db' },
          undefined,
          undefined,
        ),
      ),
    ).rejects.toMatchObject({ response: { code: 'nameTaken' } });
    await expect(
      s.create.execute(
        new CreateConnectionCommand(
          '   ',
          'sqlite',
          { path: '/b.db' },
          undefined,
          undefined,
        ),
      ),
    ).rejects.toMatchObject({ response: { code: 'invalidName' } });
  });

  describe('update', () => {
    async function saved() {
      const s = connectionSetup();
      const created = await s.create.execute(
        new CreateConnectionCommand(
          'Prod',
          'postgres',
          PG,
          { password: 'old-secret' },
          undefined,
        ),
      );
      return { s, id: created.id };
    }

    it('keeps the saved password when none is sent', async () => {
      const { s, id } = await saved();
      const before = s.repository.rows.get(id)!.sealedSecrets['password'];
      const updated = await s.update.execute(
        new UpdateConnectionCommand(
          id,
          'Prod 2',
          { ...PG, port: 5434 },
          undefined,
          undefined,
        ),
      );
      expect(updated).toMatchObject({
        name: 'Prod 2',
        config: { port: 5434 },
        secretKeys: ['password'],
      });
      expect(s.repository.rows.get(id)!.sealedSecrets['password']).toBe(before);
    });

    it('replaces the password when a new one is sent', async () => {
      const { s, id } = await saved();
      await s.update.execute(
        new UpdateConnectionCommand(
          id,
          undefined,
          undefined,
          { password: 'new-secret' },
          undefined,
        ),
      );
      expect(s.secrets.open(s.repository.rows.get(id)!)).toEqual({
        password: 'new-secret',
      });
    });

    it('forgets a password on request', async () => {
      const { s, id } = await saved();
      const updated = await s.update.execute(
        new UpdateConnectionCommand(id, undefined, undefined, undefined, [
          'password',
        ]),
      );
      expect(updated.secretKeys).toEqual([]);
    });

    it('404s a connection that is gone', async () => {
      const { s } = await saved();
      await expect(
        s.update.execute(
          new UpdateConnectionCommand(
            'nope',
            'x',
            undefined,
            undefined,
            undefined,
          ),
        ),
      ).rejects.toMatchObject({ response: { code: 'connectionNotFound' } });
    });

    it("refuses to take another connection's name", async () => {
      const { s, id } = await saved();
      await s.create.execute(
        new CreateConnectionCommand(
          'Other',
          'sqlite',
          { path: '/o.db' },
          undefined,
          undefined,
        ),
      );
      await expect(
        s.update.execute(
          new UpdateConnectionCommand(
            id,
            'Other',
            undefined,
            undefined,
            undefined,
          ),
        ),
      ).rejects.toMatchObject({ response: { code: 'nameTaken' } });
    });
  });

  it('gets and deletes', async () => {
    const s = connectionSetup();
    const { id } = await s.create.execute(
      new CreateConnectionCommand(
        'A',
        'sqlite',
        { path: '/a.db' },
        undefined,
        undefined,
      ),
    );
    expect((await s.get.execute(new GetConnectionQuery(id))).name).toBe('A');
    await s.remove.execute(new DeleteConnectionCommand(id));
    await expect(
      s.get.execute(new GetConnectionQuery(id)),
    ).rejects.toMatchObject({ response: { code: 'connectionNotFound' } });
    await expect(
      s.remove.execute(new DeleteConnectionCommand(id)),
    ).rejects.toMatchObject({ response: { code: 'connectionNotFound' } });
  });
});

describe('testing a connection', () => {
  /** A plugin whose test result we control and whose connection we can inspect. */
  function spyPlugin(
    onTest: (connection: unknown) => void,
    result = { ok: true, serverVersion: 'Spy 1.0' },
  ): DatabasePlugin {
    return {
      ...sqlitePlugin,
      id: 'spy',
      name: 'Spy',
      connectionFields: [
        { key: 'url', type: 'text', label: { en: 'URL' }, required: true },
        {
          key: 'token',
          type: 'password',
          secret: true,
          label: { en: 'Token' },
        },
      ],
      validate: () => [],
      testConnection: (_host, connection) => {
        onTest(connection);
        return Promise.resolve(result);
      },
    };
  }

  it('uses the typed password, falling back to the saved one for a blank field', async () => {
    const seen: unknown[] = [];
    const s = connectionSetup([spyPlugin((c) => seen.push(c))]);
    const { id } = await s.create.execute(
      new CreateConnectionCommand(
        'Saved',
        'spy',
        { url: 'u' },
        { token: 'saved-token' },
        undefined,
      ),
    );

    await s.test.execute(
      new TestConnectionCommand('spy', { url: 'u2' }, undefined, id, 'source'),
    );
    await s.test.execute(
      new TestConnectionCommand(
        'spy',
        { url: 'u2' },
        { token: 'typed-token' },
        id,
        'target',
      ),
    );
    await s.test.execute(
      new TestConnectionCommand(
        'spy',
        { url: 'u3' },
        undefined,
        undefined,
        'source',
      ),
    );

    expect(seen).toEqual([
      { config: { url: 'u2' }, secrets: { token: 'saved-token' } },
      { config: { url: 'u2' }, secrets: { token: 'typed-token' } },
      { config: { url: 'u3' }, secrets: {} },
    ]);
  });

  it('logs the outcome and never the password', async () => {
    const s = connectionSetup([
      spyPlugin(() => undefined, {
        ok: false,
        serverVersion: undefined as never,
      }),
    ]);
    await s.test.execute(
      new TestConnectionCommand(
        'spy',
        { url: 'u' },
        { token: 'tok-12345' },
        undefined,
        'source',
      ),
    );
    expect(s.logRepository.messages(null).join('\n')).toMatch(
      /Connection failed/,
    );
    expect(s.logRepository.messages().join('\n')).not.toContain('tok-12345');
  });

  it('turns a plugin error into a failed result with its code', async () => {
    const s = connectionSetup([
      {
        ...spyPlugin(() => undefined),
        testConnection: () =>
          Promise.reject(new PluginError('clientToolsMissing', 'psql missing')),
      },
    ]);
    expect(
      await s.test.execute(
        new TestConnectionCommand(
          'spy',
          { url: 'u' },
          undefined,
          undefined,
          'source',
        ),
      ),
    ).toEqual({
      ok: false,
      message: 'psql missing',
      code: 'clientToolsMissing',
    });
  });

  it('tests a real SQLite file end to end', async () => {
    const s = connectionSetup();
    const result = await s.test.execute(
      new TestConnectionCommand(
        'sqlite',
        { path: '/definitely/not/there.db' },
        undefined,
        undefined,
        'target',
      ),
    );
    expect(result.ok).toBe(true); // a target may not exist yet
    const source = await s.test.execute(
      new TestConnectionCommand(
        'sqlite',
        { path: '/definitely/not/there.db' },
        undefined,
        undefined,
        'source',
      ),
    );
    expect(source.ok).toBe(false);
  });

  it('refuses to borrow the passwords of a connection of another database type', async () => {
    const s = connectionSetup();
    const { id } = await s.create.execute(
      new CreateConnectionCommand(
        'A',
        'sqlite',
        { path: '/a.db' },
        undefined,
        undefined,
      ),
    );
    await expect(
      s.test.execute(
        new TestConnectionCommand('postgres', PG, undefined, id, 'source'),
      ),
    ).rejects.toMatchObject({ response: { code: 'pluginMismatch' } });
  });
});

describe('listing databases', () => {
  it('asks the plugin with the opened password and wraps its failures', async () => {
    const seen: unknown[] = [];
    const plugin: DatabasePlugin = {
      ...sqlitePlugin,
      id: 'lister',
      name: 'Lister',
      connectionFields: [
        { key: 'pw', type: 'password', secret: true, label: { en: 'PW' } },
      ],
      validate: () => [],
      listDatabases: (_host, connection) => {
        seen.push(connection.secrets);
        return Promise.resolve(['a', 'b']);
      },
    };
    const s = connectionSetup([plugin]);
    const { id } = await s.create.execute(
      new CreateConnectionCommand(
        'L',
        'lister',
        {},
        { pw: 'pw-123' },
        undefined,
      ),
    );
    expect(
      await s.databases.execute(new ListConnectionDatabasesQuery(id)),
    ).toEqual(['a', 'b']);
    expect(seen).toEqual([{ pw: 'pw-123' }]);

    const failing = connectionSetup([
      {
        ...plugin,
        listDatabases: () =>
          Promise.reject(new PluginError('connectionFailed', 'no route')),
      },
    ]);
    const created = await failing.create.execute(
      new CreateConnectionCommand('L', 'lister', {}, undefined, undefined),
    );
    await expect(
      failing.databases.execute(new ListConnectionDatabasesQuery(created.id)),
    ).rejects.toMatchObject({
      response: { code: 'connectionFailed' },
    });
  });
});
