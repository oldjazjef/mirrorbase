import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  effect,
  ElementRef,
  inject,
  viewChild,
} from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCircleAlert, lucideLock } from '@ng-icons/lucide';
import { TranslatePipe } from '@ngx-translate/core';
import { HlmButtonImports } from '@mirrorbase/ui/button';
import { HlmInputImports } from '@mirrorbase/ui/input';
import { HlmLabelImports } from '@mirrorbase/ui/label';
import { AUTO_LOCK_CHOICES, LockScreenService } from './lock-screen.service';

/**
 * Full screen over the app (which is `inert` meanwhile): the first start asks for a PIN, every
 * later start - and every auto-lock - asks for it again. There is no other login in this app.
 */
@Component({
  selector: 'mb-lock-screen',
  imports: [
    NgIcon,
    ReactiveFormsModule,
    TranslatePipe,
    ...HlmButtonImports,
    ...HlmInputImports,
    ...HlmLabelImports,
  ],
  providers: [
    LockScreenService,
    provideIcons({ lucideCircleAlert, lucideLock }),
  ],
  templateUrl: './lock-screen.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LockScreen {
  protected readonly screen = inject(LockScreenService);
  protected readonly autoLockChoices = AUTO_LOCK_CHOICES;
  // A template literal: i18n-keys.spec.ts reads quoted dotted literals as translation keys.
  protected readonly logo = `favicon.svg`;
  private readonly input =
    viewChild<ElementRef<HTMLInputElement>>('firstInput');

  constructor() {
    this.screen.open();
    afterNextRender(() => this.focus());
    // Focus the field again when the mode changes (after "PIN forgotten", the setup form).
    effect(() => {
      this.screen.pin.needsPin();
      this.screen.forgotStep();
      queueMicrotask(() => this.focus());
    });
  }

  protected typed(event: Event): void {
    const target = event.target as HTMLInputElement;
    this.screen.typed(target.value);
    target.value = this.screen.value();
  }

  protected async unlock(): Promise<void> {
    await this.screen.unlock();
    this.focus();
  }

  protected setupError(field: 'pin' | 'repeat'): string | null {
    const control = this.screen.setupForm.controls[field];
    return control.touched
      ? ((control.errors?.['zod'] as string | undefined) ?? null)
      : null;
  }

  private focus(): void {
    this.input()?.nativeElement.focus();
  }
}
