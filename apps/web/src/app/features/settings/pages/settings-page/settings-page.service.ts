import { Injectable, computed, inject, signal } from '@angular/core';
import { FormBuilder } from '@angular/forms';
import { z } from 'zod';
import { defineAction } from '../../../../core/actions/action';
import { ActionRunner } from '../../../../core/actions/action-runner';
import { AppVersionService } from '../../../../core/version/app-version.service';
import {
  desktopBridge,
  type StorageInfo,
} from '../../../../core/desktop/desktop-bridge';
import { LanguageService } from '../../../../core/i18n/language.service';
import {
  PinLockService,
  type PinProblem,
} from '../../../../core/pin/pin-lock.service';
import { zodValidator } from '../../../../shared/forms/zod-validator';

const PIN_PATTERN = /^\d{4,8}$/;

/** Auto-lock choices offered in the app (minutes; the API accepts 1–240). */
export const AUTO_LOCK_CHOICES = [1, 5, 10, 15, 30, 60, 120, 240] as const;

/** Changing the PIN: the current one as well. Messages are i18n keys. */
export const ChangePinSchema = z
  .object({
    currentPin: z.string().regex(PIN_PATTERN, 'pin.form.invalid'),
    pin: z.string().regex(PIN_PATTERN, 'pin.form.invalid'),
    repeat: z.string(),
  })
  .refine((value) => value.pin === value.repeat, {
    message: 'pin.form.mismatch',
    path: ['repeat'],
  });

@Injectable({ providedIn: 'root' })
export class SettingsPageService {
  readonly pin = inject(PinLockService);
  readonly language = inject(LanguageService);
  readonly version = inject(AppVersionService);
  private readonly runner = inject(ActionRunner);
  private readonly fb = inject(FormBuilder);

  readonly form = this.fb.nonNullable.group(
    { currentPin: [''], pin: [''], repeat: [''] },
    { validators: zodValidator(ChangePinSchema) },
  );

  readonly problem = signal<PinProblem | null>(null);
  readonly storage = signal<StorageInfo | null>(null);
  readonly desktop = computed(() => desktopBridge() !== null);
  readonly autoLock = computed(() => this.pin.status()?.autoLockMinutes ?? 15);

  constructor() {
    void desktopBridge()
      ?.storage.info()
      .then((info) => this.storage.set(info));
  }

  private readonly changeAction = defineAction<void, void>({
    run: async () => {
      const { currentPin, pin } = this.form.getRawValue();
      const problem = await this.pin.setPin(pin, currentPin, undefined);
      this.problem.set(problem);
      if (problem) throw new Error(problem.code);
    },
    messages: { success: 'settings.pin.changed' },
  });

  async changePin(): Promise<void> {
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    try {
      await this.runner.run(this.changeAction, undefined, {
        key: 'change-pin',
      });
      this.form.reset();
    } catch {
      // The problem is shown under the form.
    }
  }

  async setAutoLock(minutes: number): Promise<void> {
    await this.pin.setAutoLock(minutes);
  }

  reveal(): void {
    void desktopBridge()?.storage.reveal();
  }
}
