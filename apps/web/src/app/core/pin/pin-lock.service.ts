import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import {
  computed,
  DestroyRef,
  inject,
  Injectable,
  signal,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { apiErrorCode } from '../api/api-error';
import { apiUrl } from '../api/api-url';
import type { PinReset, PinStatus, PinUnlocked } from '../api/api.types';
import { desktopBridge } from '../desktop/desktop-bridge';

/** The header that carries the unlock token on every API request. */
export const UNLOCK_HEADER = 'x-dbreplicator-unlock';

/** What went wrong with a PIN attempt, for the lock screen. */
export interface PinProblem {
  readonly code: string;
  readonly retryAfterSeconds: number;
}

/** How often the idle check looks. */
const IDLE_CHECK_MS = 15_000;
/** Renew the API session at most this often while the person is active. */
const RENEW_EVERY_MS = 60_000;

/**
 * The PIN lock, client side. The API is the authority (it answers 423 without a valid token);
 * this keeps the token IN MEMORY ONLY - a closed window or a reload locks the app again - runs
 * the auto-lock timer, and tells the lock screen whether to ask for a new PIN or the existing one.
 */
@Injectable({ providedIn: 'root' })
export class PinLockService {
  private readonly http = inject(HttpClient);

  readonly status = signal<PinStatus | null>(null);
  private readonly tokenValue = signal<string | null>(null);
  private readonly unlockedValue = signal(false);
  /** Why the app locked itself ('idle', 'system'); shown on the lock screen. */
  readonly lockReason = signal<string | null>(null);

  /** The status is known (the lock screen must not flash before). */
  readonly ready = computed(() => this.status() !== null);
  /** No PIN yet: the app asks for a new one before anything else. */
  readonly needsPin = computed(() => this.ready() && !this.status()?.hasPin);
  /** A PIN exists and this window is not unlocked. */
  readonly locked = computed(
    () => this.ready() && !!this.status()?.hasPin && !this.unlockedValue(),
  );
  readonly unlocked = this.unlockedValue.asReadonly();

  private waiters: (() => void)[] = [];
  private lastActivity = Date.now();
  private lastRenew = 0;

  constructor() {
    const destroy = inject(DestroyRef);
    const activity = (): void => {
      this.lastActivity = Date.now();
    };
    for (const type of ['pointerdown', 'keydown', 'wheel'] as const) {
      document.addEventListener(type, activity, { passive: true });
      destroy.onDestroy(() => document.removeEventListener(type, activity));
    }
    const timer = setInterval(() => void this.tick(), IDLE_CHECK_MS);
    destroy.onDestroy(() => clearInterval(timer));
    const off = desktopBridge()?.lock?.onLocked((reason) =>
      this.markLocked(reason),
    );
    if (off) destroy.onDestroy(off);
  }

  token(): string | null {
    return this.tokenValue();
  }

  /** Asks the API where we stand; call once at start. */
  async refresh(): Promise<void> {
    try {
      const status = await firstValueFrom(
        this.http.get<PinStatus>(apiUrl('/pin/status'), {
          headers: this.headers(),
        }),
      );
      this.status.set(status);
      if (!status.unlocked) this.markLocked(null);
      else this.setUnlocked(true);
    } catch {
      // The API is not reachable (yet): stay not ready, the shell shows a retry.
      this.status.set(null);
    }
  }

  /** @returns the problem, or null when unlocked */
  async unlock(pin: string): Promise<PinProblem | null> {
    try {
      const result = await firstValueFrom(
        this.http.post<PinUnlocked>(apiUrl('/pin/unlock'), { pin }),
      );
      this.accept(result);
      return null;
    } catch (error) {
      return this.problemOf(error);
    }
  }

  /** Sets the first PIN, or changes it (`currentPin` required then). */
  async setPin(
    pin: string,
    currentPin: string | undefined,
    autoLockMinutes: number | undefined,
  ): Promise<PinProblem | null> {
    try {
      const result = await firstValueFrom(
        this.http.put<PinUnlocked>(apiUrl('/pin'), {
          pin,
          ...(currentPin ? { currentPin } : {}),
          ...(autoLockMinutes ? { autoLockMinutes } : {}),
        }),
      );
      this.accept(result);
      return null;
    } catch (error) {
      return this.problemOf(error);
    }
  }

  async setAutoLock(minutes: number): Promise<PinProblem | null> {
    try {
      const status = await firstValueFrom(
        this.http.put<PinStatus>(apiUrl('/pin/auto-lock'), { minutes }),
      );
      this.status.set(status);
      void desktopBridge()?.lock?.setIdleMinutes(status.autoLockMinutes);
      return null;
    } catch (error) {
      return this.problemOf(error);
    }
  }

  /** Locks this window now. */
  async lock(): Promise<void> {
    const token = this.tokenValue();
    this.markLocked(null);
    if (!token) return;
    try {
      await firstValueFrom(
        this.http.post<void>(apiUrl('/pin/lock'), null, {
          headers: { [UNLOCK_HEADER]: token },
        }),
      );
    } catch {
      // The token expires by itself; the window is locked either way.
    }
  }

  /** "PIN forgotten": removes the PIN and every saved password. */
  async forgot(): Promise<PinReset | PinProblem> {
    try {
      const result = await firstValueFrom(
        this.http.post<PinReset>(apiUrl('/pin/forgot'), {
          confirmEraseSecrets: true,
        }),
      );
      this.tokenValue.set(null);
      this.setUnlocked(false);
      this.status.set(result.status);
      return result;
    } catch (error) {
      return this.problemOf(error);
    }
  }

  /** The API said 423 (session expired, the shell locked): show the lock screen. */
  markLocked(reason: string | null): void {
    this.tokenValue.set(null);
    this.lockReason.set(reason);
    this.setUnlocked(false);
    const status = this.status();
    if (status && status.unlocked)
      this.status.set({ ...status, unlocked: false });
  }

  /** The API said there is no PIN (a fresh install): ask for one. */
  markNoPin(): void {
    this.tokenValue.set(null);
    this.setUnlocked(false);
    const status = this.status();
    this.status.set(
      status
        ? { ...status, hasPin: false, unlocked: false }
        : {
            hasPin: false,
            unlocked: false,
            expiresAt: null,
            autoLockMinutes: 15,
            failedAttempts: 0,
            retryAfterSeconds: 0,
          },
    );
  }

  /** Resolves once the app is unlocked (immediately when it already is). */
  whenUnlocked(): Promise<void> {
    if (this.unlockedValue()) return Promise.resolve();
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  private accept(result: PinUnlocked): void {
    this.tokenValue.set(result.token);
    this.status.set(result.status);
    this.lockReason.set(null);
    this.lastActivity = Date.now();
    this.lastRenew = Date.now();
    this.setUnlocked(true);
    void desktopBridge()?.lock?.setIdleMinutes(result.status.autoLockMinutes);
  }

  private setUnlocked(value: boolean): void {
    this.unlockedValue.set(value);
    if (value) {
      const waiting = this.waiters;
      this.waiters = [];
      for (const resolve of waiting) resolve();
    }
  }

  private headers(): Record<string, string> {
    const token = this.tokenValue();
    return token ? { [UNLOCK_HEADER]: token } : {};
  }

  private problemOf(error: unknown): PinProblem {
    if (error instanceof HttpErrorResponse) {
      const body = (error.error ?? {}) as { retryAfterSeconds?: unknown };
      return {
        code:
          apiErrorCode(error) ??
          (error.status === 0 ? 'unreachable' : 'unknown'),
        retryAfterSeconds:
          typeof body.retryAfterSeconds === 'number'
            ? body.retryAfterSeconds
            : 0,
      };
    }
    return { code: 'unknown', retryAfterSeconds: 0 };
  }

  /** The auto-lock and the session renewal, every 15 seconds. */
  private async tick(): Promise<void> {
    if (!this.unlockedValue()) return;
    const minutes = this.status()?.autoLockMinutes ?? 15;
    const now = Date.now();
    if (now - this.lastActivity > minutes * 60_000) {
      this.markLocked('idle');
      return;
    }
    // Active but making no requests (reading the log): keep the API session alive.
    if (
      now - this.lastActivity < RENEW_EVERY_MS &&
      now - this.lastRenew > RENEW_EVERY_MS
    ) {
      this.lastRenew = now;
      try {
        await firstValueFrom(
          this.http.post<PinStatus>(apiUrl('/pin/renew'), null, {
            headers: this.headers(),
          }),
        );
      } catch {
        // A 423 here is handled by the interceptor, anything else by the next request.
      }
    }
  }
}
