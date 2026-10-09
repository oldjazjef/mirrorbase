import { Injectable } from '@nestjs/common';
import {
  SkipThrottle,
  ThrottlerGuard,
  type ThrottlerModuleOptions,
} from '@nestjs/throttler';

/**
 * One budget, per client address. There are no accounts, so the lock screen's own wait between
 * wrong PINs (pin/domain/pin.ts) is the brute-force protection; this only stops a runaway
 * script on the loopback interface from hammering the API.
 */
export const THROTTLERS = {
  default: { name: 'default', ttl: 60_000, limit: 600 },
} as const;

/** Skips the budget - health checks. */
export const SkipAllThrottles = (): MethodDecorator & ClassDecorator =>
  SkipThrottle({ default: true });

export function throttlerOptions(): ThrottlerModuleOptions {
  return [THROTTLERS.default];
}

@Injectable()
export class IpThrottlerGuard extends ThrottlerGuard {}
