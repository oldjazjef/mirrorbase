import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  CONFIG_FILE,
  defaultDataDir,
  readConfig,
  resolveDataDir,
  writeConfig,
} from './storage';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mb-storage-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('desktop config', () => {
  it('round-trips the language and survives a missing or broken file', () => {
    expect(readConfig(dir)).toEqual({});
    writeConfig(dir, { locale: 'de-CH' });
    expect(readConfig(dir)).toEqual({ locale: 'de-CH' });
    writeFileSync(join(dir, CONFIG_FILE), '{ not json');
    expect(readConfig(dir)).toEqual({});
  });

  it('ignores a language the app does not ship', () => {
    writeFileSync(join(dir, CONFIG_FILE), JSON.stringify({ locale: 'fr' }));
    expect(readConfig(dir)).toEqual({});
  });
});

describe('resolveDataDir', () => {
  it('defaults to <userData>/data and takes DR_DATA_DIR over it', () => {
    expect(resolveDataDir('/u', {})).toBe(defaultDataDir('/u'));
    expect(resolveDataDir('/u', { DR_DATA_DIR: '  /elsewhere ' })).toBe(
      resolve('/elsewhere'),
    );
    expect(resolveDataDir('/u', { DR_DATA_DIR: '   ' })).toBe(
      defaultDataDir('/u'),
    );
  });
});
