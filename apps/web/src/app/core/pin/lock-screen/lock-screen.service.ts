import {
  computed,
  DestroyRef,
  inject,
  Injectable,
  signal,
} from '@angular/core';
import { FormBuilder } from '@angular/forms';
import { z } from 'zod';
import { zodValidator } from '../../../shared/forms/zod-validator';
import { PinLockService, type PinProblem } from '../pin-lock.service';

/** 4–8 digits - the API checks the same. */
export const PIN_PATTERN = /^\d{4,8}$/;

/** Auto-lock choices offered when the PIN is first set (minutes; the API accepts 1–240). */
export const AUTO_LOCK_CHOICES = [1, 5, 10, 15, 30, 60, 120, 240] as const;

/** A new PIN, entered twice. Messages are i18n keys. */
export const NewPinSchema = z
  .object({
    pin: z.string().regex(PIN_PATTERN, 'pin.form.invalid'),
    repeat: z.string(),
    autoLockMinutes: z.coerce.number().int().min(1).max(240),
  })
  .refine((value) => value.pin === value.repeat, {
    message: 'pin.form.mismatch',
    path: ['repeat'],
  });

export type ForgotStep = 'closed' | 'confirm' | 'working';

/**
 * The lock screen's logic: choosing the first PIN, unlocking with the wait after wrong attempts
 * as a countdown, and "PIN forgotten" (which erases every saved password, after a confirmation).
 */
@Injectable()
export class LockScreenService {
  readonly pin = inject(PinLockService);
  private readonly fb = inject(FormBuilder);

  readonly value = signal('');
  readonly busy = signal(false);
  readonly problem = signal<PinProblem | null>(null);
  /** Seconds left before the next attempt (counts down). */
  readonly wait = signal(0);
  readonly forgotStep = signal<ForgotStep>('closed');
  readonly understood = signal(false);

  readonly setupForm = this.fb.nonNullable.group(
    { pin: [''], repeat: [''], autoLockMinutes: [15] },
    { validators: zodValidator(NewPinSchema) },
  );

  readonly canSubmit = computed(
    () => PIN_PATTERN.test(this.value()) && !this.busy() && this.wait() === 0,
  );

  private timer: ReturnType<typeof setInterval> | undefined;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.stopTimer());
  }

  /** When the screen opens: the stored wait. */
  open(): void {
    this.startWait(this.pin.status()?.retryAfterSeconds ?? 0);
  }

  typed(raw: string): void {
    this.value.set(raw.replace(/\D/g, '').slice(0, 8));
    this.problem.set(null);
  }

  async unlock(): Promise<boolean> {
    if (!this.canSubmit()) return false;
    this.busy.set(true);
    try {
      const problem = await this.pin.unlock(this.value());
      this.value.set('');
      this.problem.set(problem);
      if (problem) this.startWait(problem.retryAfterSeconds);
      return problem === null;
    } finally {
      this.busy.set(false);
    }
  }

  async setPin(): Promise<void> {
    this.setupForm.markAllAsTouched();
    if (this.setupForm.invalid || this.busy()) return;
    this.busy.set(true);
    try {
      const { pin, autoLockMinutes } = this.setupForm.getRawValue();
      this.problem.set(
        await this.pin.setPin(pin, undefined, Number(autoLockMinutes)),
      );
      if (!this.problem())
        this.setupForm.reset({ pin: '', repeat: '', autoLockMinutes: 15 });
    } finally {
      this.busy.set(false);
    }
  }

  openForgot(): void {
    this.understood.set(false);
    this.forgotStep.set('confirm');
  }

  closeForgot(): void {
    this.forgotStep.set('closed');
  }

  /** Removes the PIN and every saved password; the screen then asks for a new PIN. */
  async resetPin(): Promise<void> {
    if (!this.understood()) return;
    this.forgotStep.set('working');
    const result = await this.pin.forgot();
    if ('code' in result) {
      this.problem.set(result);
      this.forgotStep.set('confirm');
      return;
    }
    this.forgotStep.set('closed');
    this.problem.set(null);
    this.wait.set(0);
  }

  private startWait(seconds: number): void {
    this.stopTimer();
    this.wait.set(Math.max(0, Math.ceil(seconds)));
    if (this.wait() === 0) return;
    this.timer = setInterval(() => {
      this.wait.update((left) => Math.max(0, left - 1));
      if (this.wait() === 0) this.stopTimer();
    }, 1000);
  }

  private stopTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}
