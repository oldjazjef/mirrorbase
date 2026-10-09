import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type KeyCipher,
  loadOrCreateKey,
  PLAIN_KEY_FILE,
  SEALED_KEY_FILE,
} from './secret-key';

/** A "keychain" that scrambles reversibly and can be told to fail. */
class FakeKeychain implements KeyCipher {
  usable = true;
  broken = false;
  available(): boolean {
    return this.usable;
  }
  encrypt(plain: string): Buffer {
    return Buffer.from(`sealed:${Buffer.from(plain).toString('base64')}`);
  }
  decrypt(blob: Buffer): string {
    const text = blob.toString();
    if (this.broken || !text.startsWith('sealed:'))
      throw new Error('cannot decrypt');
    return Buffer.from(text.slice('sealed:'.length), 'base64').toString();
  }
}

const KEY = 'a'.repeat(64);
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dr-key-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('loadOrCreateKey', () => {
  it('creates the key under the keychain and never writes it in the clear', () => {
    const result = loadOrCreateKey(dir, new FakeKeychain(), () => KEY);
    expect(result).toEqual({
      key: KEY,
      protection: 'os-keychain',
      recovered: false,
    });
    expect(existsSync(join(dir, PLAIN_KEY_FILE))).toBe(false);
    expect(readFileSync(join(dir, SEALED_KEY_FILE), 'utf8')).not.toContain(KEY);
  });

  it('reads the same key back on the next start', () => {
    const keychain = new FakeKeychain();
    loadOrCreateKey(dir, keychain, () => KEY);
    expect(loadOrCreateKey(dir, keychain, () => 'b'.repeat(64)).key).toBe(KEY);
  });

  it('falls back to a file only the owner can read when there is no keychain', () => {
    const keychain = new FakeKeychain();
    keychain.usable = false;
    const result = loadOrCreateKey(dir, keychain, () => KEY);
    expect(result).toEqual({ key: KEY, protection: 'file', recovered: false });
    if (process.platform !== 'win32') {
      expect(statSync(join(dir, PLAIN_KEY_FILE)).mode & 0o777).toBe(0o600);
    }
    expect(loadOrCreateKey(dir, keychain, () => 'c'.repeat(64)).key).toBe(KEY);
  });

  it('moves a plain key under the keychain once one is available, keeping the key', () => {
    const keychain = new FakeKeychain();
    keychain.usable = false;
    loadOrCreateKey(dir, keychain, () => KEY);

    keychain.usable = true;
    const upgraded = loadOrCreateKey(dir, keychain, () => 'unused'.repeat(10));
    expect(upgraded).toEqual({
      key: KEY,
      protection: 'os-keychain',
      recovered: false,
    });
    expect(existsSync(join(dir, PLAIN_KEY_FILE))).toBe(false);
    expect(existsSync(join(dir, SEALED_KEY_FILE))).toBe(true);
  });

  it('sets an unreadable sealed key aside instead of deleting it, and says passwords are lost', () => {
    const keychain = new FakeKeychain();
    loadOrCreateKey(dir, keychain, () => KEY);
    keychain.broken = true;

    const result = loadOrCreateKey(
      dir,
      keychain,
      () => 'd'.repeat(64),
      () => new Date('2026-10-09T10:00:00Z'),
    );
    expect(result.recovered).toBe(true);
    expect(result.key).toBe('d'.repeat(64));
    expect(
      readdirSync(dir).some((name) =>
        name.startsWith(`${SEALED_KEY_FILE}.unreadable-`),
      ),
    ).toBe(true);
  });

  it('does the same when the keychain is gone but a sealed key remains', () => {
    const keychain = new FakeKeychain();
    loadOrCreateKey(dir, keychain, () => KEY);
    keychain.usable = false;
    const result = loadOrCreateKey(dir, keychain, () => 'e'.repeat(64));
    expect(result).toMatchObject({ protection: 'file', recovered: true });
  });

  it('ignores a damaged plain key file instead of using a weak key', () => {
    const keychain = new FakeKeychain();
    keychain.usable = false;
    writeFileSync(join(dir, PLAIN_KEY_FILE), 'short\n');
    expect(loadOrCreateKey(dir, keychain, () => KEY).key).toBe(KEY);
  });
});
