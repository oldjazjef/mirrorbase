import { randomBytes } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

/** The key that seals the saved passwords, protected by the operating system's keychain. */
export const SEALED_KEY_FILE = 'dbreplicator.key.enc';
/** The fallback where no keychain exists: the key itself, readable only by the owner. */
export const PLAIN_KEY_FILE = 'dbreplicator.key';

/**
 * What the OS keychain can do for us. In the app this is Electron's `safeStorage` (Windows DPAPI,
 * macOS Keychain, Linux libsecret/kwallet); a spec passes a fake.
 */
export interface KeyCipher {
  /** True only when there is a real keychain behind it (not Linux's "basic text" fallback). */
  available(): boolean;
  encrypt(plain: string): Buffer;
  /** Throws when the blob cannot be opened (another user, another machine, a reset keychain). */
  decrypt(blob: Buffer): string;
}

export type KeyProtection = 'os-keychain' | 'file';

export interface SecretKey {
  readonly key: string;
  readonly protection: KeyProtection;
  /** The sealed key could not be opened, so a new one was made: saved passwords are unreadable. */
  readonly recovered: boolean;
}

const MIN_KEY_LENGTH = 32;

/**
 * The secret behind SETTINGS_ENCRYPTION_KEY, created on first start.
 *
 * With a keychain the key is stored only encrypted by it - copying the data folder to another
 * computer or user account gives nobody the passwords. Without one, the key sits next to the
 * database in a file only the owner can read (honest about its limit: it protects against a copied
 * database, not against someone with the whole folder). Moving from the file to a keychain
 * happens by itself the first time one is available, and the plain file is then deleted.
 *
 * A sealed key that cannot be opened is never "fixed" by guessing: it is set aside, a new key is
 * created and `recovered` says so - the saved passwords are unreadable then and the app asks for
 * them again. Nothing is deleted.
 */
export function loadOrCreateKey(
  dir: string,
  cipher: KeyCipher,
  newKey: () => string = () => randomBytes(32).toString('hex'),
  now: () => Date = () => new Date(),
): SecretKey {
  mkdirSync(dir, { recursive: true });
  const sealedFile = join(dir, SEALED_KEY_FILE);
  const plainFile = join(dir, PLAIN_KEY_FILE);
  const keychain = cipher.available();

  if (existsSync(sealedFile)) {
    if (keychain) {
      try {
        const key = cipher.decrypt(readFileSync(sealedFile)).trim();
        if (key.length >= MIN_KEY_LENGTH) {
          return { key, protection: 'os-keychain', recovered: false };
        }
      } catch {
        // Falls through to setting it aside.
      }
    }
    renameSync(sealedFile, `${sealedFile}.unreadable-${stamp(now())}`);
    return create(dir, cipher, newKey, true);
  }

  if (existsSync(plainFile)) {
    const existing = readFileSync(plainFile, 'utf8').trim();
    if (existing.length >= MIN_KEY_LENGTH) {
      if (keychain) {
        // Upgrade: the key goes under the keychain's protection, the plain copy is removed.
        writeFileSync(sealedFile, cipher.encrypt(existing), { mode: 0o600 });
        rmSync(plainFile, { force: true });
        return { key: existing, protection: 'os-keychain', recovered: false };
      }
      return { key: existing, protection: 'file', recovered: false };
    }
  }

  return create(dir, cipher, newKey, false);
}

function create(
  dir: string,
  cipher: KeyCipher,
  newKey: () => string,
  recovered: boolean,
): SecretKey {
  const key = newKey();
  if (cipher.available()) {
    writeFileSync(join(dir, SEALED_KEY_FILE), cipher.encrypt(key), {
      mode: 0o600,
    });
    return { key, protection: 'os-keychain', recovered };
  }
  writeFileSync(join(dir, PLAIN_KEY_FILE), `${key}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  return { key, protection: 'file', recovered };
}

function stamp(date: Date): string {
  return date.toISOString().replace(/[:.]/g, '-');
}
