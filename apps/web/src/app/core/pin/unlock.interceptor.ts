import {
  HttpErrorResponse,
  type HttpHandlerFn,
  type HttpInterceptorFn,
  type HttpRequest,
} from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, from, switchMap, throwError } from 'rxjs';
import { isApiRequest } from '../api/api-url';
import { runtimeEnv } from '../config/runtime-env';
import { PinLockService, UNLOCK_HEADER } from './pin-lock.service';

/** API paths that answer while locked - they never wait for the PIN. */
const EXEMPT = /^\/api\/(pin(\/|$)|version$|health$)/;

/** Whether a request may go out while the app is locked (the lock's own calls, version). */
export function isLockExempt(url: string): boolean {
  const base = runtimeEnv().apiBaseUrl;
  const path = (url.startsWith(base) ? url.slice(base.length) : url).split(
    '?',
  )[0];
  return EXEMPT.test(path ?? '');
}

function withToken(
  request: HttpRequest<unknown>,
  token: string | null,
): HttpRequest<unknown> {
  return token && !request.headers.has(UNLOCK_HEADER)
    ? request.clone({ setHeaders: { [UNLOCK_HEADER]: token } })
    : request;
}

function lockCode(error: unknown): string | undefined {
  if (!(error instanceof HttpErrorResponse) || error.status !== 423) {
    return undefined;
  }
  const code = (error.error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : undefined;
}

/**
 * Sends the unlock token with every API request, holds data requests while the app is locked,
 * and turns a 423 (`pinLocked` - the session expired, the desktop shell locked; `pinNotSet` - a
 * fresh install) into the lock screen. A locked request is sent again once the PIN was entered.
 * The lock's own endpoints pass straight through.
 */
export const unlockInterceptor: HttpInterceptorFn = (request, next) => {
  if (!isApiRequest(request.url)) return next(request);
  const pin = inject(PinLockService);
  if (isLockExempt(request.url)) return next(withToken(request, pin.token()));
  const send = (handler: HttpHandlerFn) =>
    from(pin.whenUnlocked()).pipe(
      switchMap(() => handler(withToken(request, pin.token()))),
    );
  return send(next).pipe(
    catchError((error: unknown) => {
      const code = lockCode(error);
      if (code === 'pinNotSet') pin.markNoPin();
      else if (code === 'pinLocked') pin.markLocked(null);
      else return throwError(() => error);
      return send(next);
    }),
  );
};
