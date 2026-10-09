import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  PinLockState,
  PinSessions,
  UNLOCK_HEADER,
} from './application/pin-sessions';

export const ALLOW_WHILE_LOCKED_KEY = 'pin:allowWhileLocked';

/**
 * Marks a route that answers while the lock is closed: the lock's own endpoints (status, unlock,
 * set, lock, forgot) and the health/version probes. Everything else is a data request.
 */
export const AllowWhileLocked = () => SetMetadata(ALLOW_WHILE_LOCKED_KEY, true);

interface LockedRequest {
  headers: Record<string, string | string[] | undefined>;
}

/** The unlock token of a request, if it sent one. */
export function unlockTokenOf(request: LockedRequest): string | undefined {
  const value = request.headers[UNLOCK_HEADER];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * The only authentication this app has, enforced in the API - not only in the UI. Every request
 * except the lock's own endpoints needs a valid unlock token:
 *
 *   - no PIN yet  → **423** `pinNotSet` (the app asks for a new PIN first; nothing is reachable
 *     before one exists, so a fresh install is not an open door);
 *   - PIN, no valid token → **423** `pinLocked`.
 *
 * A valid token is renewed by the request (sliding auto-lock). The desktop app runs the API
 * in-process, so every start begins locked.
 */
@Injectable()
export class PinLockGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly state: PinLockState,
    private readonly sessions: PinSessions,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const allowed = this.reflector.getAllAndOverride<boolean>(
      ALLOW_WHILE_LOCKED_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (allowed) return true;
    const request = context.switchToHttp().getRequest<LockedRequest>();
    if (!(await this.state.pin())) {
      throw locked('pinNotSet', 'Set a PIN first');
    }
    if (this.sessions.touch(unlockTokenOf(request))) return true;
    throw locked('pinLocked', 'The app is locked: unlock it with the PIN');
  }
}

function locked(code: string, message: string): HttpException {
  return new HttpException(
    { statusCode: HttpStatus.LOCKED, error: 'Locked', message, code },
    HttpStatus.LOCKED,
  );
}
