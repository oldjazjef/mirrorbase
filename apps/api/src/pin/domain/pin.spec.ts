import { hashPin, needsRehash, verifyPin } from './pin-hash';
import {
  clampAutoLock,
  delayAfterFailures,
  isValidPin,
  secondsUntil,
} from './pin';

describe('PIN policy', () => {
  it('accepts 4 to 8 digits only', () => {
    expect(['1234', '12345678'].every(isValidPin)).toBe(true);
    expect(['123', '123456789', '12a4', '', '１２３４'].some(isValidPin)).toBe(
      false,
    );
  });

  it('is free for the first typo, then waits longer each time', () => {
    expect([0, 1, 2, 3, 4, 5].map(delayAfterFailures)).toEqual([
      0, 0, 1, 2, 5, 10,
    ]);
    expect(delayAfterFailures(500)).toBe(900);
  });

  it('counts the wait in whole seconds', () => {
    const now = Date.parse('2026-10-09T10:00:00Z');
    expect(secondsUntil(null, now)).toBe(0);
    expect(secondsUntil('2026-10-09T10:00:01.200Z', now)).toBe(2);
    expect(secondsUntil('2026-10-09T09:59:00Z', now)).toBe(0);
  });

  it('keeps the auto-lock time in range', () => {
    expect(clampAutoLock(0)).toBe(1);
    expect(clampAutoLock(9999)).toBe(240);
    expect(clampAutoLock(Number.NaN)).toBe(15);
  });
});

describe('PIN hash', () => {
  it('verifies the right PIN and refuses a wrong one', async () => {
    const hash = await hashPin('4711', { logN: 10, r: 8, p: 1 });
    expect(hash.startsWith('scrypt$')).toBe(true);
    expect(hash).not.toContain('4711');
    expect(await verifyPin('4711', hash)).toBe(true);
    expect(await verifyPin('4712', hash)).toBe(false);
  });

  it('never matches a malformed stored hash and asks for a rehash of weak ones', async () => {
    expect(await verifyPin('4711', 'garbage')).toBe(false);
    expect(needsRehash(await hashPin('4711', { logN: 10, r: 8, p: 1 }))).toBe(
      true,
    );
  });
});
