import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from 'node:crypto';

export const MIN_EXPORT_PASSWORD_LENGTH = 8;

/** An encrypted export file: everything needed to decrypt it except the password. */
export interface EncryptedEnvelope {
  readonly app: 'mirrorbase';
  readonly kind: 'connections';
  readonly version: 1;
  readonly encrypted: true;
  readonly kdf: 'scrypt';
  readonly salt: string;
  readonly iv: string;
  readonly tag: string;
  readonly data: string;
}

/** Thrown by `decryptEnvelope` for a wrong password or a tampered file (GCM cannot tell which). */
export class WrongExportPasswordError extends Error {
  constructor() {
    super('The password is wrong or the file was changed');
  }
}

function deriveKey(password: string, salt: Buffer): Buffer {
  // The export password is chosen by a person, so the key derivation is deliberately slow.
  return scryptSync(password, salt, 32, {
    N: 2 ** 15,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
}

/** AES-256-GCM with a key from scrypt(password, random salt). Fresh salt and IV per export. */
export function encryptEnvelope(
  plain: string,
  password: string,
): EncryptedEnvelope {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(password, salt), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return {
    app: 'mirrorbase',
    kind: 'connections',
    version: 1,
    encrypted: true,
    kdf: 'scrypt',
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  };
}

/** @throws WrongExportPasswordError */
export function decryptEnvelope(
  envelope: EncryptedEnvelope,
  password: string,
): string {
  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      deriveKey(password, Buffer.from(envelope.salt, 'base64')),
      Buffer.from(envelope.iv, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(envelope.data, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new WrongExportPasswordError();
  }
}
