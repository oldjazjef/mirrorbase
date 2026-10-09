import { sqlitePlugin } from '@mirrorbase/plugin-sqlite';
import { postgresPlugin } from '@mirrorbase/plugin-postgres';
import { cleanName, normalizeConfig, pickSecrets } from './connection';

describe('normalizeConfig', () => {
  it('keeps declared fields with their types and drops everything else', () => {
    expect(
      normalizeConfig(postgresPlugin, {
        host: ' db.example.com ',
        port: '5433',
        user: 'admin',
        password: 'must-not-end-up-in-config',
        evil: 'x',
        ssl: '',
      }),
    ).toEqual({ host: 'db.example.com', port: 5433, user: 'admin' });
  });

  it('works for any plugin through its declared fields', () => {
    expect(
      normalizeConfig(sqlitePlugin, { path: '/data/a.db', port: 1 }),
    ).toEqual({
      path: '/data/a.db',
    });
  });

  it('leaves an unparsable number as text so validation can reject it', () => {
    expect(normalizeConfig(postgresPlugin, { port: 'abc' })['port']).toBe(
      'abc',
    );
  });
});

describe('pickSecrets', () => {
  it('takes only declared secret fields that have a value', () => {
    expect(pickSecrets(postgresPlugin, { password: 'p', host: 'h' })).toEqual({
      password: 'p',
    });
    expect(pickSecrets(postgresPlugin, { password: '' })).toEqual({});
    expect(pickSecrets(sqlitePlugin, { password: 'p' })).toEqual({});
    expect(pickSecrets(postgresPlugin, undefined)).toEqual({});
  });
});

describe('cleanName', () => {
  it('trims and collapses whitespace', () => {
    expect(cleanName('  Prod   DB ')).toBe('Prod DB');
  });
});
