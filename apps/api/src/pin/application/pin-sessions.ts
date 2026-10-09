import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { AppPin } from '../domain/pin';
import { AppPinRepositoryPort } from '../ports/app-pin.repository.port';

/** The header that carries the unlock token on every data request. */
export const UNLOCK_HEADER = 'x-dbreplicator-unlock';

/** At most this many open sessions (windows); the oldest goes first. */
const MAX_SESSIONS = 5;

/** The time, replaceable in specs. */
@Injectable()
export class PinClock {
  now(): number {
    return Date.now();
  }
}

export interface UnlockGrant {
  /** Opaque, 256 bits; sent back in `x-dbreplicator-unlock`. */
  readonly token: string;
  /** ISO timestamp; every request with the token moves it on (sliding). */
  readonly expiresAt: string;
}

interface Session {
  readonly idleMs: number;
  readonly createdAt: number;
  expiresAt: number;
}

/**
 * The unlocked sessions, **in memory** - on purpose: a restart of the API (every start of the
 * desktop app, which runs it in-process) locks everything, which is exactly "PIN on every start".
 * A token is valid for the auto-lock time after its last use; only its SHA-256 is kept.
 */
@Injectable()
export class PinSessions {
  private readonly sessions = new Map<string, Session>();

  constructor(private readonly clock: PinClock) {}

  issue(idleMinutes: number): UnlockGrant {
    const now = this.clock.now();
    this.prune(now);
    const oldest = [...this.sessions.entries()].sort(
      ([, a], [, b]) => a.createdAt - b.createdAt,
    );
    for (const [key] of oldest.slice(
      0,
      Math.max(0, oldest.length - MAX_SESSIONS + 1),
    )) {
      this.sessions.delete(key);
    }
    const token = randomBytes(32).toString('base64url');
    const idleMs = idleMinutes * 60_000;
    this.sessions.set(digest(token), {
      idleMs,
      createdAt: now,
      expiresAt: now + idleMs,
    });
    return { token, expiresAt: new Date(now + idleMs).toISOString() };
  }

  /**
   * Whether `token` unlocks now; a valid token is renewed (its idle time starts again). Returns
   * the new expiry, or `undefined`.
   */
  touch(token: string | undefined): string | undefined {
    if (!token) return undefined;
    const key = digest(token);
    const session = this.sessions.get(key);
    const now = this.clock.now();
    if (!session) return undefined;
    if (session.expiresAt <= now) {
      this.sessions.delete(key);
      return undefined;
    }
    session.expiresAt = now + session.idleMs;
    return new Date(session.expiresAt).toISOString();
  }

  revoke(token: string | undefined): void {
    if (token) this.sessions.delete(digest(token));
  }

  /** Locks everything - the desktop shell calls it on OS lock / suspend. */
  revokeAll(): void {
    this.sessions.clear();
  }

  private prune(now: number): void {
    for (const [key, session] of this.sessions) {
      if (session.expiresAt <= now) this.sessions.delete(key);
    }
  }
}

function digest(token: string): string {
  return createHash('sha256').update(token).digest('base64url');
}

/**
 * Whether a PIN exists, cached - the lock guard asks on every request. Every write goes through
 * the PIN handlers, which call `forget`.
 */
@Injectable()
export class PinLockState {
  private cache: { pin: AppPin | null } | undefined;

  constructor(private readonly pins: AppPinRepositoryPort) {}

  async pin(): Promise<AppPin | null> {
    this.cache ??= { pin: (await this.pins.find()) ?? null };
    return this.cache.pin;
  }

  forget(): void {
    this.cache = undefined;
  }
}
