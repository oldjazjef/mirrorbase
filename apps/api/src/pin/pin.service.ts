import { Injectable } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import {
  ForgotPinCommand,
  GetPinStatusQuery,
  LockCommand,
  type PinReset,
  type PinStatus,
  type PinUnlocked,
  SetAutoLockCommand,
  SetPinCommand,
  UnlockCommand,
} from './application/pin.handlers';

/** Thin façade over the buses so the controller stays free of CQRS. */
@Injectable()
export class PinService {
  constructor(
    private readonly commands: CommandBus,
    private readonly queries: QueryBus,
  ) {}

  status(token: string | undefined): Promise<PinStatus> {
    return this.queries.execute(new GetPinStatusQuery(token));
  }

  unlock(pin: string): Promise<PinUnlocked> {
    return this.commands.execute(new UnlockCommand(pin));
  }

  lock(token: string | undefined): Promise<void> {
    return this.commands.execute(new LockCommand(token));
  }

  set(
    pin: string,
    currentPin: string | undefined,
    autoLockMinutes: number | undefined,
  ): Promise<PinUnlocked> {
    return this.commands.execute(
      new SetPinCommand(pin, currentPin, autoLockMinutes),
    );
  }

  autoLock(minutes: number, token: string | undefined): Promise<PinStatus> {
    return this.commands.execute(new SetAutoLockCommand(minutes, token));
  }

  forgot(confirmEraseSecrets: boolean): Promise<PinReset> {
    return this.commands.execute(new ForgotPinCommand(confirmEraseSecrets));
  }
}
