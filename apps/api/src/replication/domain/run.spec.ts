import { finalStatus, isActive, type RunDatabase, sameEndpoint } from './run';

const db = (status: RunDatabase['status']): RunDatabase => ({
  source: 'a',
  target: 'a',
  status,
  bytes: null,
  warnings: 0,
  errorCode: null,
  error: null,
});

describe('finalStatus', () => {
  it('succeeds when nothing failed', () => {
    expect(finalStatus([db('done'), db('done')], false)).toEqual({
      status: 'succeeded',
      error: null,
    });
  });

  it('fails and counts when any database failed', () => {
    expect(finalStatus([db('done'), db('failed')], false)).toEqual({
      status: 'failed',
      error: '1 of 2 databases failed (1 copied)',
    });
  });

  it('is cancelled when the user stopped it', () => {
    expect(finalStatus([db('done'), db('cancelled')], true).status).toBe(
      'cancelled',
    );
  });
});

describe('isActive', () => {
  it('is true for queued and running only', () => {
    expect(['queued', 'running'].every((s) => isActive(s as 'queued'))).toBe(
      true,
    );
    expect(
      ['succeeded', 'failed', 'cancelled'].some((s) => isActive(s as 'failed')),
    ).toBe(false);
  });
});

describe('sameEndpoint', () => {
  it('treats localhost spellings as one server', () => {
    expect(
      sameEndpoint(
        { pluginId: 'postgres', config: { host: 'localhost', port: 5432 } },
        { pluginId: 'postgres', config: { port: 5432, host: '127.0.0.1' } },
      ),
    ).toBe(true);
  });

  it('tells different ports and different plugins apart', () => {
    expect(
      sameEndpoint(
        { pluginId: 'postgres', config: { host: 'h', port: 5432 } },
        { pluginId: 'postgres', config: { host: 'h', port: 5433 } },
      ),
    ).toBe(false);
    expect(
      sameEndpoint(
        { pluginId: 'a', config: { host: 'h' } },
        { pluginId: 'b', config: { host: 'h' } },
      ),
    ).toBe(false);
  });
});
