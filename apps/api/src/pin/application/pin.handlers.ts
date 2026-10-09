import { Injectable } from '@nestjs/common';
import {
  CommandHandler,
  type ICommandHandler,
  type IQueryHandler,
  QueryHandler,
} from '@nestjs/cqrs';
import { badRequest, unprocessable } from '../../common/http/api-errors';
import {
  type AppPin,
  AUTO_LOCK_MINUTES,
  clampAutoLock,
  delayAfterFailures,
  isValidPin,
  type SaveAppPinInput,
  secondsUntil,
} from '../domain/pin';
import { hashPin, needsRehash, verifyPin } from '../domain/pin-hash';
import {
  AppPinRepositoryPort,
  SealedSecretsEraserPort,
} from '../ports/app-pin.repository.port';
import {
  PinClock,
  PinLockState,
  PinSessions,
  type UnlockGrant,
} from './pin-sessions';
import { HttpException, HttpStatus } from '@nestjs/common';

export interface PinStatus {
  /** Is there a PIN at all? Without one the app asks for a new PIN before anything else. */
  readonly hasPin: boolean;
  readonly unlocked: boolean;
  readonly expiresAt: string | null;
  readonly autoLockMinutes: number;
  readonly failedAttempts: number;
  readonly retryAfterSeconds: number;
}

export interface PinUnlocked {
  readonly status: PinStatus;
  readonly unlock: UnlockGrant;
}

export interface PinReset {
  readonly status: PinStatus;
  /** Connections that lost their saved password. */
  readonly erasedSecrets: number;
}

function noPin(): HttpException {
  return badRequest('noPin', 'No PIN is set yet');
}

/** The rules every PIN command shares. */
@Injectable()
export class PinPolicy {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly pins: AppPinRepositoryPort,
    private readonly state: PinLockState,
    private readonly sessions: PinSessions,
    private readonly clock: PinClock,
  ) {}

  status(pin: AppPin | null, token?: string): PinStatus {
    const expiresAt = pin ? this.sessions.touch(token) : undefined;
    return {
      hasPin: pin !== null,
      unlocked: expiresAt !== undefined,
      expiresAt: expiresAt ?? null,
      autoLockMinutes: pin?.autoLockMinutes ?? AUTO_LOCK_MINUTES.default,
      failedAttempts: pin?.failedAttempts ?? 0,
      retryAfterSeconds: secondsUntil(
        pin?.nextAttemptAt ?? null,
        this.clock.now(),
      ),
    };
  }

  /** One PIN check at a time: parallel guesses would all see the same attempt counter. */
  serial<T>(work: () => Promise<T>): Promise<T> {
    const run = this.queue.then(work, work);
    this.queue = run.catch(() => undefined);
    return run;
  }

  async save(
    existing: AppPin | null,
    changes: Partial<SaveAppPinInput>,
  ): Promise<AppPin> {
    const saved = await this.pins.save({
      pinHash: changes.pinHash ?? existing?.pinHash ?? '',
      failedAttempts: changes.failedAttempts ?? existing?.failedAttempts ?? 0,
      nextAttemptAt:
        changes.nextAttemptAt !== undefined
          ? changes.nextAttemptAt
          : (existing?.nextAttemptAt ?? null),
      autoLockMinutes:
        changes.autoLockMinutes ??
        existing?.autoLockMinutes ??
        AUTO_LOCK_MINUTES.default,
    });
    this.state.forget();
    return saved;
  }

  /**
   * Checks `pin` against the stored one with the wait between attempts. A wrong PIN records the
   * failure and the next allowed time; the right one resets both.
   */
  async check(existing: AppPin, pin: string): Promise<AppPin> {
    const now = this.clock.now();
    const wait = secondsUntil(existing.nextAttemptAt, now);
    if (wait > 0) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          error: 'Too Many Requests',
          code: 'pinThrottled',
          message: 'Too many wrong PINs: wait before trying again',
          retryAfterSeconds: wait,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (!isValidPin(pin) || !(await verifyPin(pin, existing.pinHash))) {
      const failures = existing.failedAttempts + 1;
      const delay = delayAfterFailures(failures);
      await this.save(existing, {
        failedAttempts: failures,
        nextAttemptAt:
          delay > 0 ? new Date(now + delay * 1000).toISOString() : null,
      });
      throw unprocessable('wrongPin', 'The PIN is wrong', {
        failedAttempts: failures,
        retryAfterSeconds: delay,
      });
    }
    return this.save(
      existing,
      needsRehash(existing.pinHash)
        ? {
            failedAttempts: 0,
            nextAttemptAt: null,
            pinHash: await hashPin(pin),
          }
        : { failedAttempts: 0, nextAttemptAt: null },
    );
  }
}

// --- status ---

export class GetPinStatusQuery {
  constructor(readonly token: string | undefined) {}
}

@QueryHandler(GetPinStatusQuery)
export class GetPinStatusHandler implements IQueryHandler<
  GetPinStatusQuery,
  PinStatus
> {
  constructor(
    private readonly state: PinLockState,
    private readonly policy: PinPolicy,
  ) {}

  async execute({ token }: GetPinStatusQuery): Promise<PinStatus> {
    return this.policy.status(await this.state.pin(), token);
  }
}

// --- set / change ---

export class SetPinCommand {
  constructor(
    readonly pin: string,
    readonly currentPin: string | undefined,
    readonly autoLockMinutes: number | undefined,
  ) {}
}

/** Sets the first PIN, or changes it (the current PIN is required then). Unlocks. */
@CommandHandler(SetPinCommand)
export class SetPinHandler implements ICommandHandler<
  SetPinCommand,
  PinUnlocked
> {
  constructor(
    private readonly pins: AppPinRepositoryPort,
    private readonly sessions: PinSessions,
    private readonly policy: PinPolicy,
  ) {}

  execute({
    pin,
    currentPin,
    autoLockMinutes,
  }: SetPinCommand): Promise<PinUnlocked> {
    return this.policy.serial(async () => {
      if (!isValidPin(pin)) {
        throw badRequest('invalidPin', 'The PIN must be 4 to 8 digits');
      }
      const existing = await this.pins.find();
      let base = existing;
      if (existing) {
        if (currentPin === undefined) {
          throw badRequest('currentPinRequired', 'The current PIN is required');
        }
        base = await this.policy.check(existing, currentPin);
      }
      const saved = await this.policy.save(base, {
        pinHash: await hashPin(pin),
        failedAttempts: 0,
        nextAttemptAt: null,
        autoLockMinutes: clampAutoLock(
          autoLockMinutes ?? base?.autoLockMinutes ?? AUTO_LOCK_MINUTES.default,
        ),
      });
      // Changing the PIN ends every other session.
      this.sessions.revokeAll();
      const unlock = this.sessions.issue(saved.autoLockMinutes);
      return { status: this.policy.status(saved, unlock.token), unlock };
    });
  }
}

// --- unlock ---

export class UnlockCommand {
  constructor(readonly pin: string) {}
}

@CommandHandler(UnlockCommand)
export class UnlockHandler implements ICommandHandler<
  UnlockCommand,
  PinUnlocked
> {
  constructor(
    private readonly pins: AppPinRepositoryPort,
    private readonly sessions: PinSessions,
    private readonly policy: PinPolicy,
  ) {}

  execute({ pin }: UnlockCommand): Promise<PinUnlocked> {
    return this.policy.serial(async () => {
      const existing = await this.pins.find();
      if (!existing) throw noPin();
      const checked = await this.policy.check(existing, pin);
      const unlock = this.sessions.issue(checked.autoLockMinutes);
      return { status: this.policy.status(checked, unlock.token), unlock };
    });
  }
}

// --- lock ---

export class LockCommand {
  constructor(readonly token: string | undefined) {}
}

@CommandHandler(LockCommand)
export class LockHandler implements ICommandHandler<LockCommand, void> {
  constructor(private readonly sessions: PinSessions) {}

  async execute({ token }: LockCommand): Promise<void> {
    this.sessions.revoke(token);
  }
}

// --- auto-lock time ---

export class SetAutoLockCommand {
  constructor(
    readonly minutes: number,
    readonly token: string | undefined,
  ) {}
}

@CommandHandler(SetAutoLockCommand)
export class SetAutoLockHandler implements ICommandHandler<
  SetAutoLockCommand,
  PinStatus
> {
  constructor(
    private readonly pins: AppPinRepositoryPort,
    private readonly policy: PinPolicy,
  ) {}

  async execute({ minutes, token }: SetAutoLockCommand): Promise<PinStatus> {
    const existing = await this.pins.find();
    if (!existing) throw noPin();
    const saved = await this.policy.save(existing, {
      autoLockMinutes: clampAutoLock(minutes),
    });
    return this.policy.status(saved, token);
  }
}

// --- forgot ---

export class ForgotPinCommand {
  constructor(readonly confirmEraseSecrets: boolean) {}
}

/**
 * "PIN forgotten": there is no recovery - the PIN is removed AND every saved password is erased
 * (the person sets a new PIN and enters the passwords again). Needs an explicit confirmation.
 * Saved connections (hosts, ports, names) and the log stay.
 */
@CommandHandler(ForgotPinCommand)
export class ForgotPinHandler implements ICommandHandler<
  ForgotPinCommand,
  PinReset
> {
  constructor(
    private readonly pins: AppPinRepositoryPort,
    private readonly eraser: SealedSecretsEraserPort,
    private readonly state: PinLockState,
    private readonly sessions: PinSessions,
    private readonly policy: PinPolicy,
  ) {}

  execute({ confirmEraseSecrets }: ForgotPinCommand): Promise<PinReset> {
    return this.policy.serial(async () => {
      if (!confirmEraseSecrets) {
        throw badRequest(
          'confirmationRequired',
          'Resetting the PIN erases every saved password: confirm it',
        );
      }
      const erasedSecrets = await this.eraser.eraseAll();
      await this.pins.delete();
      this.state.forget();
      this.sessions.revokeAll();
      return { status: this.policy.status(null), erasedSecrets };
    });
  }
}

export const PIN_HANDLERS = [
  GetPinStatusHandler,
  SetPinHandler,
  UnlockHandler,
  LockHandler,
  SetAutoLockHandler,
  ForgotPinHandler,
];
