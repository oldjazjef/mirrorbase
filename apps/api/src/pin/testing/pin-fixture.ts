import {
  PinClock,
  PinLockState,
  PinSessions,
} from '../application/pin-sessions';
import {
  ForgotPinHandler,
  GetPinStatusHandler,
  LockHandler,
  PinPolicy,
  SetAutoLockHandler,
  SetPinHandler,
  UnlockHandler,
} from '../application/pin.handlers';
import {
  FakeSealedSecretsEraser,
  InMemoryAppPinRepository,
} from './in-memory-app-pin.repository';

export class ManualClock extends PinClock {
  current = Date.parse('2026-10-09T10:00:00Z');
  override now(): number {
    return this.current;
  }
  advanceSeconds(seconds: number): void {
    this.current += seconds * 1000;
  }
}

/** Every PIN handler over port doubles and a manual clock. */
export function pinSetup() {
  const clock = new ManualClock();
  const pins = new InMemoryAppPinRepository();
  const eraser = new FakeSealedSecretsEraser();
  const sessions = new PinSessions(clock);
  const state = new PinLockState(pins);
  const policy = new PinPolicy(pins, state, sessions, clock);
  return {
    clock,
    pins,
    eraser,
    sessions,
    state,
    policy,
    status: new GetPinStatusHandler(state, policy),
    set: new SetPinHandler(pins, sessions, policy),
    unlock: new UnlockHandler(pins, sessions, policy),
    lock: new LockHandler(sessions),
    autoLock: new SetAutoLockHandler(pins, policy),
    forgot: new ForgotPinHandler(pins, eraser, state, sessions, policy),
  };
}
