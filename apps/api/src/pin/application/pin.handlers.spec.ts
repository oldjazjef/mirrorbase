import {
  ForgotPinCommand,
  GetPinStatusQuery,
  SetAutoLockCommand,
  SetPinCommand,
  UnlockCommand,
} from './pin.handlers';
import { pinSetup } from '../testing/pin-fixture';

describe('PIN handlers', () => {
  it('starts without a PIN and locked', async () => {
    const s = pinSetup();
    expect(
      await s.status.execute(new GetPinStatusQuery(undefined)),
    ).toMatchObject({
      hasPin: false,
      unlocked: false,
    });
  });

  it('sets the first PIN, stores only its hash and unlocks', async () => {
    const s = pinSetup();
    const { status, unlock } = await s.set.execute(
      new SetPinCommand('4711', undefined, 20),
    );
    expect(status).toMatchObject({
      hasPin: true,
      unlocked: true,
      autoLockMinutes: 20,
    });
    expect(s.pins.pin?.pinHash.startsWith('scrypt$')).toBe(true);
    expect(JSON.stringify(s.pins.pin)).not.toContain('4711');
    expect(s.sessions.touch(unlock.token)).toBeDefined();
  });

  it('rejects a PIN that is not 4 to 8 digits', async () => {
    const s = pinSetup();
    await expect(
      s.set.execute(new SetPinCommand('12', undefined, undefined)),
    ).rejects.toMatchObject({
      response: { code: 'invalidPin' },
    });
    expect(s.pins.pin).toBeNull();
  });

  it('needs the current PIN to change it, and ends the other sessions', async () => {
    const s = pinSetup();
    const first = await s.set.execute(
      new SetPinCommand('4711', undefined, undefined),
    );
    await expect(
      s.set.execute(new SetPinCommand('0815', undefined, undefined)),
    ).rejects.toMatchObject({
      response: { code: 'currentPinRequired' },
    });
    await expect(
      s.set.execute(new SetPinCommand('0815', '9999', undefined)),
    ).rejects.toMatchObject({
      response: { code: 'wrongPin' },
    });
    const changed = await s.set.execute(
      new SetPinCommand('0815', '4711', undefined),
    );
    expect(s.sessions.touch(first.unlock.token)).toBeUndefined();
    expect(s.sessions.touch(changed.unlock.token)).toBeDefined();
    s.clock.advanceSeconds(3600);
    await expect(
      s.unlock.execute(new UnlockCommand('4711')),
    ).rejects.toMatchObject({
      response: { code: 'wrongPin' },
    });
    await expect(
      s.unlock.execute(new UnlockCommand('0815')),
    ).resolves.toBeDefined();
  });

  it('unlocks with the right PIN and issues a token', async () => {
    const s = pinSetup();
    await s.set.execute(new SetPinCommand('4711', undefined, undefined));
    s.sessions.revokeAll();
    const { unlock, status } = await s.unlock.execute(
      new UnlockCommand('4711'),
    );
    expect(status.unlocked).toBe(true);
    expect(s.sessions.touch(unlock.token)).toBeDefined();
  });

  it('forgives the first typo, then makes the person wait - even for the right PIN', async () => {
    const s = pinSetup();
    await s.set.execute(new SetPinCommand('4711', undefined, undefined));
    s.sessions.revokeAll();

    const wrong = (): Promise<unknown> =>
      s.unlock.execute(new UnlockCommand('0000')).catch((e: unknown) => e);
    expect(await wrong()).toMatchObject({
      response: { code: 'wrongPin', retryAfterSeconds: 0 },
    });
    expect(await wrong()).toMatchObject({
      response: { code: 'wrongPin', retryAfterSeconds: 1 },
    });

    // The right PIN is refused during the wait: guesses must not be free.
    await expect(
      s.unlock.execute(new UnlockCommand('4711')),
    ).rejects.toMatchObject({
      response: { code: 'pinThrottled', retryAfterSeconds: 1 },
    });

    s.clock.advanceSeconds(2);
    const ok = await s.unlock.execute(new UnlockCommand('4711'));
    expect(ok.status.failedAttempts).toBe(0);
  });

  it('expires a session after the auto-lock time and renews it while in use', async () => {
    const s = pinSetup();
    const { unlock } = await s.set.execute(
      new SetPinCommand('4711', undefined, 1),
    );
    s.clock.advanceSeconds(50);
    expect(s.sessions.touch(unlock.token)).toBeDefined(); // renewed
    s.clock.advanceSeconds(50);
    expect(s.sessions.touch(unlock.token)).toBeDefined(); // renewed again
    s.clock.advanceSeconds(61);
    expect(s.sessions.touch(unlock.token)).toBeUndefined();
  });

  it('changes the auto-lock time within its limits', async () => {
    const s = pinSetup();
    await s.set.execute(new SetPinCommand('4711', undefined, undefined));
    expect(
      (await s.autoLock.execute(new SetAutoLockCommand(9999, undefined)))
        .autoLockMinutes,
    ).toBe(240);
  });

  it('forgot: needs confirmation, then erases the PIN, every saved password and all sessions', async () => {
    const s = pinSetup();
    const { unlock } = await s.set.execute(
      new SetPinCommand('4711', undefined, undefined),
    );
    await expect(
      s.forgot.execute(new ForgotPinCommand(false)),
    ).rejects.toMatchObject({
      response: { code: 'confirmationRequired' },
    });
    expect(s.eraser.erased).toBe(0);
    expect(s.pins.pin).not.toBeNull();

    const reset = await s.forgot.execute(new ForgotPinCommand(true));
    expect(reset.erasedSecrets).toBe(2);
    expect(reset.status.hasPin).toBe(false);
    expect(s.pins.pin).toBeNull();
    expect(s.sessions.touch(unlock.token)).toBeUndefined();
    expect(await s.state.pin()).toBeNull();
  });

  it('unlock without a PIN is a 400, not a way in', async () => {
    const s = pinSetup();
    await expect(
      s.unlock.execute(new UnlockCommand('1234')),
    ).rejects.toMatchObject({
      response: { code: 'noPin' },
    });
  });
});
