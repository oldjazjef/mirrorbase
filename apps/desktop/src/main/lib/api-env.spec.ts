import { desktopApiEnv } from './api-env';

describe('desktopApiEnv', () => {
  const env = desktopApiEnv({
    dataDir: '/data',
    encryptionKey: 'k'.repeat(64),
    workDir: '/tmp/work',
  });

  it('points the API at the data folder and hands it the key', () => {
    expect(env['DATABASE_URL']).toMatch(/^file:.*mirrorbase\.db$/);
    expect(env['SETTINGS_ENCRYPTION_KEY']).toBe('k'.repeat(64));
    expect(env['WORK_DIR']).toBe('/tmp/work');
  });

  it('runs as production without the API reference or a stray .env', () => {
    expect(env['NODE_ENV']).toBe('production');
    expect(env['API_DOCS']).toBe('false');
    expect(env['DR_IGNORE_ENV_FILE']).toBe('true');
  });
});
