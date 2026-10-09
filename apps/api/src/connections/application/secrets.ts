import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { PluginConnection } from '@dbreplicator/db-plugin';
import { conflict } from '../../common/http/api-errors';
import { SecretBox } from '../../common/crypto/secret-box';
import type { Env } from '../../config/env';
import type { StoredConnection } from '../domain/connection';

/**
 * Seals and opens a connection's passwords with the app's key. Opened values exist only inside a
 * handler, for the duration of one call; they are never stored, returned or logged.
 */
@Injectable()
export class ConnectionSecrets {
  private readonly box: SecretBox;

  constructor(config: ConfigService<Env, true>) {
    this.box = new SecretBox(
      config.get('SETTINGS_ENCRYPTION_KEY', { infer: true }),
    );
  }

  /** Seals each value; 409 `secretsUnavailable` when the app has no key to seal with. */
  seal(secrets: Readonly<Record<string, string>>): Record<string, string> {
    const entries = Object.entries(secrets);
    if (entries.length > 0 && !this.box.available) {
      throw conflict(
        'secretsUnavailable',
        'No encryption key is configured, so a password cannot be saved',
      );
    }
    return Object.fromEntries(
      entries.map(([key, value]) => [key, this.box.seal(value)]),
    );
  }

  /**
   * The stored passwords in the clear. A value that cannot be opened (the key changed) is left
   * out, so the connection behaves as if no password were saved and the user is asked again.
   */
  open(
    stored: Pick<StoredConnection, 'sealedSecrets'>,
  ): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, sealed] of Object.entries(stored.sealedSecrets)) {
      const plain = this.box.open(sealed);
      if (plain !== undefined) result[key] = plain;
    }
    return result;
  }

  /** The connection as a plugin receives it. */
  toPluginConnection(stored: StoredConnection): PluginConnection {
    return { config: stored.config, secrets: this.open(stored) };
  }
}
