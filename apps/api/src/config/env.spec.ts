import 'reflect-metadata';
import { apiDocsEnabled, NodeEnv, validateEnv } from './env';

describe('validateEnv', () => {
  it('accepts a minimal environment and applies defaults', () => {
    const env = validateEnv({ DATABASE_URL: 'file:./.data/x.db' });
    expect(env.PORT).toBe(3333);
    expect(env.SETTINGS_ENCRYPTION_KEY).toBe('');
  });

  it('converts the port explicitly', () => {
    expect(validateEnv({ DATABASE_URL: 'file:x', PORT: '4000' }).PORT).toBe(
      4000,
    );
  });

  it('refuses a non-SQLite database URL at boot', () => {
    expect(() => validateEnv({ DATABASE_URL: 'postgres://u:p@h/db' })).toThrow(
      /DATABASE_URL must be a SQLite file URL/,
    );
  });

  it('shows the API reference outside production unless told otherwise', () => {
    expect(
      apiDocsEnabled({ API_DOCS: '', NODE_ENV: NodeEnv.Development }),
    ).toBe(true);
    expect(apiDocsEnabled({ API_DOCS: '', NODE_ENV: NodeEnv.Production })).toBe(
      false,
    );
    expect(
      apiDocsEnabled({ API_DOCS: 'true', NODE_ENV: NodeEnv.Production }),
    ).toBe(true);
  });
});
