import { connectionSetup } from '../testing/connection-fixture';
import { CreateConnectionCommand } from './connection.handlers';
import {
  ExportConnectionsQuery,
  ImportConnectionsCommand,
  type PlainExport,
} from './connection-transfer.handlers';

const PG = { host: 'db.example.com', port: '5433', user: 'admin' };

async function withTwoConnections() {
  const s = connectionSetup();
  const prod = await s.create.execute(
    new CreateConnectionCommand(
      'Prod',
      'postgres',
      PG,
      { password: 'Sup3r-Secret!' },
      'pg-prod',
      'Work',
    ),
  );
  const dev = await s.create.execute(
    new CreateConnectionCommand(
      'Dev',
      'postgres',
      { ...PG, host: 'localhost' },
      undefined,
      undefined,
    ),
  );
  return { s, prod, dev };
}

describe('exporting connections', () => {
  it('exports settings without passwords as plain JSON', async () => {
    const { s } = await withTwoConnections();
    const file = (await s.exporter.execute(
      new ExportConnectionsQuery(undefined, false, undefined),
    )) as PlainExport;
    expect(file.encrypted).toBe(false);
    expect(
      file.connections.map((c) => [c.name, c.group, c.dockerName]),
    ).toEqual([
      ['Dev', null, null],
      ['Prod', 'Work', 'pg-prod'],
    ]);
    expect(JSON.stringify(file)).not.toContain('Sup3r-Secret!');
    expect(file.connections.every((c) => !('secrets' in c))).toBe(true);
  });

  it('exports only the chosen connections', async () => {
    const { s, dev } = await withTwoConnections();
    const file = (await s.exporter.execute(
      new ExportConnectionsQuery([dev.id], false, undefined),
    )) as PlainExport;
    expect(file.connections.map((c) => c.name)).toEqual(['Dev']);
  });

  it('refuses passwords without an export password, and a short one', async () => {
    const { s } = await withTwoConnections();
    await expect(
      s.exporter.execute(
        new ExportConnectionsQuery(undefined, true, undefined),
      ),
    ).rejects.toMatchObject({ response: { code: 'exportPasswordRequired' } });
    await expect(
      s.exporter.execute(new ExportConnectionsQuery(undefined, false, 'short')),
    ).rejects.toMatchObject({ response: { code: 'exportPasswordTooShort' } });
  });

  it('encrypts the file, passwords included, and imports it back with the password', async () => {
    const { s } = await withTwoConnections();
    const file = await s.exporter.execute(
      new ExportConnectionsQuery(undefined, true, 'export-pw-1'),
    );
    const text = JSON.stringify(file);
    expect(file.encrypted).toBe(true);
    expect(text).not.toContain('Sup3r-Secret!');
    expect(text).not.toContain('db.example.com');

    const target = connectionSetup();
    const result = await target.importer.execute(
      new ImportConnectionsCommand(text, 'export-pw-1'),
    );
    expect(result).toEqual({ imported: 2, renamed: 0, skipped: [] });
    const prod = [...target.repository.rows.values()].find(
      (c) => c.name === 'Prod',
    )!;
    expect(prod).toMatchObject({ group: 'Work', dockerName: 'pg-prod' });
    expect(target.secrets.open(prod)).toEqual({ password: 'Sup3r-Secret!' });
  });

  it('asks for the password of an encrypted file, and refuses a wrong one', async () => {
    const { s } = await withTwoConnections();
    const text = JSON.stringify(
      await s.exporter.execute(
        new ExportConnectionsQuery(undefined, false, 'export-pw-1'),
      ),
    );
    const target = connectionSetup();
    await expect(
      target.importer.execute(new ImportConnectionsCommand(text, undefined)),
    ).rejects.toMatchObject({ response: { code: 'exportPasswordRequired' } });
    await expect(
      target.importer.execute(
        new ImportConnectionsCommand(text, 'nope-nope-1'),
      ),
    ).rejects.toMatchObject({ response: { code: 'wrongExportPassword' } });
    expect(target.repository.rows.size).toBe(0);
  });
});

describe('importing connections', () => {
  it('numbers a name that is taken instead of overwriting', async () => {
    const { s } = await withTwoConnections();
    const text = JSON.stringify(
      await s.exporter.execute(
        new ExportConnectionsQuery(undefined, false, undefined),
      ),
    );
    const result = await s.importer.execute(
      new ImportConnectionsCommand(text, undefined),
    );
    expect(result).toEqual({ imported: 2, renamed: 2, skipped: [] });
    expect([...s.repository.rows.values()].map((c) => c.name).sort()).toEqual([
      'Dev',
      'Dev (2)',
      'Prod',
      'Prod (2)',
    ]);
  });

  it('skips an entry of an unknown database type and keeps the rest', async () => {
    const s = connectionSetup();
    const text = JSON.stringify({
      app: 'mirrorbase',
      kind: 'connections',
      version: 1,
      encrypted: false,
      connections: [
        { name: 'Oracle', pluginId: 'oracle', config: {} },
        {
          name: 'Ok',
          pluginId: 'postgres',
          config: PG,
          secrets: { password: 'x-x-x-x' },
        },
        'garbage',
      ],
    });
    const result = await s.importer.execute(
      new ImportConnectionsCommand(text, undefined),
    );
    expect(result).toEqual({
      imported: 1,
      renamed: 0,
      skipped: [
        { name: 'Oracle', reason: 'unknownPlugin' },
        { name: '?', reason: 'invalidEntry' },
      ],
    });
  });

  it('refuses text that is not an export', async () => {
    const s = connectionSetup();
    for (const text of ['not json', '{}', '{"app":"other"}']) {
      await expect(
        s.importer.execute(new ImportConnectionsCommand(text, undefined)),
      ).rejects.toMatchObject({ response: { code: 'invalidExportFile' } });
    }
  });
});
