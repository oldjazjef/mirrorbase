import {
  HttpClient,
  provideHttpClient,
  withInterceptors,
} from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { PinStatus, PinUnlocked } from '../api/api.types';
import { PinLockService, UNLOCK_HEADER } from './pin-lock.service';
import { unlockInterceptor } from './unlock.interceptor';

const STATUS = (over: Partial<PinStatus> = {}): PinStatus => ({
  hasPin: true,
  unlocked: false,
  expiresAt: null,
  autoLockMinutes: 15,
  failedAttempts: 0,
  retryAfterSeconds: 0,
  ...over,
});

const UNLOCKED = (
  token = 'tok-1',
  over: Partial<PinStatus> = {},
): PinUnlocked => ({
  status: STATUS({ unlocked: true, ...over }),
  token,
  expiresAt: '2026-10-09T11:00:00Z',
});

/** Lets pending promise continuations (the interceptor's `whenUnlocked`) run. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function setup() {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(withInterceptors([unlockInterceptor])),
      provideHttpClientTesting(),
    ],
  });
  return {
    pin: TestBed.inject(PinLockService),
    http: TestBed.inject(HttpClient),
    backend: TestBed.inject(HttpTestingController),
  };
}

describe('PinLockService', () => {
  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
    vi.useRealTimers();
  });

  it('asks for a new PIN on a fresh install', async () => {
    const { pin, backend } = setup();
    const refreshed = pin.refresh();
    backend.expectOne('/api/pin/status').flush(STATUS({ hasPin: false }));
    await refreshed;
    expect(pin.ready()).toBe(true);
    expect(pin.needsPin()).toBe(true);
    expect(pin.locked()).toBe(false);
  });

  it('is locked when a PIN exists, whatever the API session says about a reload', async () => {
    const { pin, backend } = setup();
    const refreshed = pin.refresh();
    backend.expectOne('/api/pin/status').flush(STATUS());
    await refreshed;
    expect(pin.locked()).toBe(true);
    expect(pin.needsPin()).toBe(false);
  });

  it('keeps the token in memory only', async () => {
    const { pin, backend } = setup();
    const unlocked = pin.unlock('4711');
    backend.expectOne('/api/pin/unlock').flush(UNLOCKED('secret-token'));
    await unlocked;
    expect(pin.token()).toBe('secret-token');
    expect(JSON.stringify({ ...localStorage })).not.toContain('secret-token');
    expect(JSON.stringify({ ...sessionStorage })).not.toContain('secret-token');
  });

  it('reports a wrong PIN with the wait and does not unlock', async () => {
    const { pin, backend } = setup();
    const attempt = pin.unlock('0000');
    backend
      .expectOne('/api/pin/unlock')
      .flush(
        { code: 'wrongPin', retryAfterSeconds: 2 },
        { status: 422, statusText: 'Unprocessable' },
      );
    expect(await attempt).toEqual({ code: 'wrongPin', retryAfterSeconds: 2 });
    expect(pin.unlocked()).toBe(false);
  });

  it('lock() drops the token at once and tells the API', async () => {
    const { pin, backend } = setup();
    const unlocked = pin.unlock('4711');
    backend.expectOne('/api/pin/unlock').flush(UNLOCKED('tok-9'));
    await unlocked;

    const locking = pin.lock();
    expect(pin.token()).toBeNull();
    expect(pin.unlocked()).toBe(false);
    const request = backend.expectOne('/api/pin/lock');
    expect(request.request.headers.get(UNLOCK_HEADER)).toBe('tok-9');
    request.flush(null, { status: 204, statusText: 'No Content' });
    await locking;
  });

  it('forgot() ends in the "choose a PIN" state', async () => {
    const { pin, backend } = setup();
    const refreshed = pin.refresh();
    backend.expectOne('/api/pin/status').flush(STATUS());
    await refreshed;

    const reset = pin.forgot();
    const request = backend.expectOne('/api/pin/forgot');
    expect(request.request.body).toEqual({ confirmEraseSecrets: true });
    request.flush({ status: STATUS({ hasPin: false }), erasedSecrets: 2 });
    expect(await reset).toMatchObject({ erasedSecrets: 2 });
    expect(pin.needsPin()).toBe(true);
    expect(pin.token()).toBeNull();
  });

  it('locks itself after the auto-lock time without activity', async () => {
    vi.useFakeTimers();
    const { pin, backend } = setup();
    const unlocked = pin.unlock('4711');
    backend
      .expectOne('/api/pin/unlock')
      .flush(UNLOCKED('tok', { autoLockMinutes: 1 }));
    await unlocked;
    expect(pin.unlocked()).toBe(true);

    await vi.advanceTimersByTimeAsync(61_000 + 15_000);
    expect(pin.unlocked()).toBe(false);
    expect(pin.lockReason()).toBe('idle');
    expect(pin.token()).toBeNull();
  });

  it('activity keeps it unlocked', async () => {
    vi.useFakeTimers();
    const { pin, backend } = setup();
    const unlocked = pin.unlock('4711');
    backend
      .expectOne('/api/pin/unlock')
      .flush(UNLOCKED('tok', { autoLockMinutes: 1 }));
    await unlocked;

    for (let i = 0; i < 3; i++) {
      await vi.advanceTimersByTimeAsync(30_000);
      document.dispatchEvent(new Event('pointerdown'));
      // The renewal call the service makes while the person is active.
      backend
        .match('/api/pin/renew')
        .forEach((r) => r.flush(STATUS({ unlocked: true })));
    }
    expect(pin.unlocked()).toBe(true);
  });
});

describe('unlockInterceptor', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('sends the token with every API request', async () => {
    const { pin, http, backend } = setup();
    const unlocked = pin.unlock('4711');
    backend.expectOne('/api/pin/unlock').flush(UNLOCKED('tok-A'));
    await unlocked;

    http.get('/api/connections').subscribe();
    await settle();
    expect(
      backend.expectOne('/api/connections').request.headers.get(UNLOCK_HEADER),
    ).toBe('tok-A');
    backend.verify();
  });

  it('holds a data request while locked and sends it once the PIN was entered', async () => {
    const { pin, http, backend } = setup();
    let answer: unknown;
    http.get('/api/connections').subscribe((value) => (answer = value));
    await settle();
    backend.expectNone('/api/connections'); // nothing goes out while locked

    const unlocked = pin.unlock('4711');
    backend.expectOne('/api/pin/unlock').flush(UNLOCKED('tok-B'));
    await unlocked;
    await settle();
    const request = backend.expectOne('/api/connections');
    expect(request.request.headers.get(UNLOCK_HEADER)).toBe('tok-B');
    request.flush(['x']);
    expect(answer).toEqual(['x']);
  });

  it("lets the lock's own endpoints and the version through while locked", async () => {
    const { http, backend } = setup();
    http.get('/api/pin/status').subscribe();
    http.get('/api/version').subscribe();
    await settle();
    backend.expectOne('/api/pin/status').flush(STATUS());
    backend.expectOne('/api/version').flush({});
  });

  it('turns a 423 pinLocked into the lock screen and repeats the request after unlocking', async () => {
    const { pin, http, backend } = setup();
    const unlocked = pin.unlock('4711');
    backend.expectOne('/api/pin/unlock').flush(UNLOCKED('old-token'));
    await unlocked;

    let answer: unknown;
    http.get('/api/runs').subscribe((value) => (answer = value));
    await settle();
    backend
      .expectOne('/api/runs')
      .flush({ code: 'pinLocked' }, { status: 423, statusText: 'Locked' });
    await settle();
    expect(pin.unlocked()).toBe(false);
    expect(pin.token()).toBeNull();

    const again = pin.unlock('4711');
    backend.expectOne('/api/pin/unlock').flush(UNLOCKED('new-token'));
    await again;
    await settle();
    const retry = backend.expectOne('/api/runs');
    expect(retry.request.headers.get(UNLOCK_HEADER)).toBe('new-token');
    retry.flush([]);
    expect(answer).toEqual([]);
  });

  it('turns a 423 pinNotSet into "choose a PIN"', async () => {
    const { pin, http, backend } = setup();
    const unlocked = pin.unlock('4711');
    backend.expectOne('/api/pin/unlock').flush(UNLOCKED());
    await unlocked;

    http.get('/api/runs').subscribe();
    await settle();
    backend
      .expectOne('/api/runs')
      .flush({ code: 'pinNotSet' }, { status: 423, statusText: 'Locked' });
    await settle();
    expect(pin.needsPin()).toBe(true);
  });

  it('passes other errors through untouched', async () => {
    const { pin, http, backend } = setup();
    const unlocked = pin.unlock('4711');
    backend.expectOne('/api/pin/unlock').flush(UNLOCKED());
    await unlocked;

    let status = 0;
    http
      .get('/api/runs')
      .subscribe({ error: (e: { status: number }) => (status = e.status) });
    await settle();
    backend
      .expectOne('/api/runs')
      .flush({}, { status: 500, statusText: 'Server Error' });
    expect(status).toBe(500);
    expect(pin.unlocked()).toBe(true);
  });

  it('never sends the token to another host', async () => {
    const { pin, http, backend } = setup();
    const unlocked = pin.unlock('4711');
    backend.expectOne('/api/pin/unlock').flush(UNLOCKED('tok-C'));
    await unlocked;

    http.get('https://elsewhere.example/data').subscribe();
    await settle();
    expect(
      backend
        .expectOne('https://elsewhere.example/data')
        .request.headers.has(UNLOCK_HEADER),
    ).toBe(false);
  });
});
