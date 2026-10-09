/**
 * The PIN lock - hand-written domain types and the pure policy: what a PIN looks like and how
 * long the person waits after wrong attempts. There is one user, so there is one PIN.
 */

/** 4–8 digits, nothing else. */
export const PIN_PATTERN = /^\d{4,8}$/;

/**
 * Seconds to wait after the n-th wrong attempt in a row (index n − 1); the last value repeats.
 * The first wrong attempt costs nothing (a typo), then the wait grows. This - not the hash - is
 * what stops brute force on the lock screen.
 */
export const PIN_DELAYS_SECONDS = [
  0, 1, 2, 5, 10, 30, 60, 120, 300, 600, 900,
] as const;

export const AUTO_LOCK_MINUTES = { min: 1, max: 240, default: 15 } as const;

export interface AppPin {
  /** `scrypt$…` (pin-hash.ts) - never the PIN. */
  readonly pinHash: string;
  readonly failedAttempts: number;
  /** ISO timestamp: no attempt before it; null = right away. */
  readonly nextAttemptAt: string | null;
  readonly autoLockMinutes: number;
  readonly updatedAt: string | null;
}

export type SaveAppPinInput = Omit<AppPin, 'updatedAt'>;

export function isValidPin(pin: string): boolean {
  return PIN_PATTERN.test(pin);
}

/** The wait after `failures` wrong attempts in a row, in seconds. */
export function delayAfterFailures(failures: number): number {
  if (failures <= 0) return 0;
  const index = Math.min(failures, PIN_DELAYS_SECONDS.length) - 1;
  return PIN_DELAYS_SECONDS[index] ?? 0;
}

/** Whole seconds until `nextAttemptAt`, 0 when an attempt is allowed now. */
export function secondsUntil(
  nextAttemptAt: string | null,
  nowMs: number,
): number {
  if (!nextAttemptAt) return 0;
  const wait = Date.parse(nextAttemptAt) - nowMs;
  return wait > 0 ? Math.ceil(wait / 1000) : 0;
}

export function clampAutoLock(minutes: number): number {
  if (!Number.isFinite(minutes)) return AUTO_LOCK_MINUTES.default;
  return Math.min(
    AUTO_LOCK_MINUTES.max,
    Math.max(AUTO_LOCK_MINUTES.min, Math.round(minutes)),
  );
}
