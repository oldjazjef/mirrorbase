import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { HlmButtonImports } from '@mirrorbase/ui/button';
import { HlmToasterImports } from '@mirrorbase/ui/sonner';
import { LockScreen } from './core/pin/lock-screen/lock-screen';
import { PinLockService } from './core/pin/pin-lock.service';
import { ThemeService } from './core/theme/theme.service';

@Component({
  selector: 'mb-root',
  imports: [
    RouterOutlet,
    LockScreen,
    TranslatePipe,
    ...HlmButtonImports,
    ...HlmToasterImports,
  ],
  templateUrl: './app.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  private readonly theme = inject(ThemeService);
  protected readonly pin = inject(PinLockService);
  protected readonly toasterTheme = computed(() => this.theme.current());
  /** The lock screen covers the app while it is locked, and asks for a PIN on a fresh install. */
  protected readonly showLock = computed(
    () => this.pin.locked() || this.pin.needsPin(),
  );

  constructor() {
    void this.pin.refresh();
  }

  protected retry(): void {
    void this.pin.refresh();
  }
}
