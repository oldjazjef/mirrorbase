import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { PinLockService } from '../pin-lock.service';
import { LockScreenService } from './lock-screen.service';

function setup() {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      LockScreenService,
    ],
  });
  return {
    screen: TestBed.inject(LockScreenService),
    pin: TestBed.inject(PinLockService),
    backend: TestBed.inject(HttpTestingController),
  };
}

const status = (over = {}) => ({
  hasPin: true,
  unlocked: false,
  expiresAt: null,
  autoLockMinutes: 15,
  failedAttempts: 0,
  retryAfterSeconds: 0,
  ...over,
});

describe('LockScreenService', () => {
  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
    vi.useRealTimers();
  });

  it('accepts digits only, at most eight', () => {
    const { screen } = setup();
    screen.typed('12ab34-5678901');
    expect(screen.value()).toBe('12345678');
  });

  it('can only submit a valid PIN', () => {
    const { screen } = setup();
    screen.typed('123');
    expect(screen.canSubmit()).toBe(false);
    screen.typed('1234');
    expect(screen.canSubmit()).toBe(true);
  });

  it('shows the wait after a wrong PIN as a countdown and blocks submitting meanwhile', async () => {
    vi.useFakeTimers();
    const { screen, backend } = setup();
    screen.typed('0000');
    const attempt = screen.unlock();
    backend
      .expectOne('/api/pin/unlock')
      .flush(
        { code: 'wrongPin', retryAfterSeconds: 3 },
        { status: 422, statusText: 'Unprocessable' },
      );
    await attempt;

    expect(screen.problem()).toEqual({
      code: 'wrongPin',
      retryAfterSeconds: 3,
    });
    expect(screen.wait()).toBe(3);
    expect(screen.value()).toBe('');
    screen.typed('4711');
    expect(screen.canSubmit()).toBe(false);

    await vi.advanceTimersByTimeAsync(3000);
    expect(screen.wait()).toBe(0);
    expect(screen.canSubmit()).toBe(true);
  });

  it('resumes the stored wait when the screen opens', () => {
    vi.useFakeTimers();
    const { screen, pin } = setup();
    pin.status.set(status({ retryAfterSeconds: 30 }));
    screen.open();
    expect(screen.wait()).toBe(30);
  });

  it('refuses a new PIN that is not repeated correctly, then sets it', async () => {
    const { screen, backend } = setup();
    screen.setupForm.setValue({
      pin: '4711',
      repeat: '4712',
      autoLockMinutes: 15,
    });
    await screen.setPin();
    backend.expectNone('/api/pin');
    expect(screen.setupForm.controls.repeat.errors?.['zod']).toBe(
      'pin.form.mismatch',
    );

    screen.setupForm.setValue({
      pin: '4711',
      repeat: '4711',
      autoLockMinutes: 30,
    });
    const setting = screen.setPin();
    const request = backend.expectOne('/api/pin');
    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toEqual({ pin: '4711', autoLockMinutes: 30 });
    request.flush({
      status: status({ unlocked: true, autoLockMinutes: 30 }),
      token: 't',
      expiresAt: 'x',
    });
    await setting;
    expect(screen.problem()).toBeNull();
  });

  it('"PIN forgotten" needs the confirmation and then asks for a new PIN', async () => {
    const { screen, pin, backend } = setup();
    pin.status.set(status());
    screen.openForgot();
    await screen.resetPin(); // not understood yet
    backend.expectNone('/api/pin/forgot');

    screen.understood.set(true);
    const resetting = screen.resetPin();
    backend
      .expectOne('/api/pin/forgot')
      .flush({ status: status({ hasPin: false }), erasedSecrets: 1 });
    await resetting;
    expect(screen.forgotStep()).toBe('closed');
    expect(pin.needsPin()).toBe(true);
  });
});
