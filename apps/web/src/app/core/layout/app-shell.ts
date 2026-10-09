import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  NavigationEnd,
  Router,
  RouterLink,
  RouterOutlet,
} from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideLock, lucideMoon, lucideSun } from '@ng-icons/lucide';
import { TranslatePipe } from '@ngx-translate/core';
import { HlmBadge } from '@mirrorbase/ui/badge';
import { HlmButtonImports } from '@mirrorbase/ui/button';
import { HlmSidebarImports, HlmSidebarService } from '@mirrorbase/ui/sidebar';
import { filter, map } from 'rxjs';
import { PinLockService } from '../pin/pin-lock.service';
import { ThemeService } from '../theme/theme.service';
import { AppVersionService } from '../version/app-version.service';
import { isNavActive, NAV_ICONS, NAV_ITEMS, type NavItem } from './nav-config';

/**
 * The frame around every page: the spartan sidebar at the left (icon, name and version; the main
 * navigation; lock and theme at the bottom), collapsible to icons on desktop widths and an
 * off-canvas sheet on narrow ones; at the right a slim top bar and the page, the only part that
 * scrolls. Ported from lazy-koins' / etx's shell, without a user menu: there is no account.
 */
@Component({
  selector: 'mb-app-shell',
  imports: [
    RouterOutlet,
    RouterLink,
    NgIcon,
    TranslatePipe,
    HlmBadge,
    ...HlmButtonImports,
    ...HlmSidebarImports,
  ],
  providers: [
    provideIcons({ ...NAV_ICONS, lucideLock, lucideMoon, lucideSun }),
  ],
  templateUrl: './app-shell.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppShell {
  protected readonly items = NAV_ITEMS;
  protected readonly theme = inject(ThemeService);
  protected readonly version = inject(AppVersionService);
  protected readonly pin = inject(PinLockService);
  private readonly sidebar = inject(HlmSidebarService);
  private readonly router = inject(Router);

  // A template literal: i18n-keys.spec.ts reads quoted dotted literals as translation keys.
  protected readonly logo = `favicon.svg`;

  /** The current URL, for the active entry. */
  private readonly url = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map(() => this.router.url),
    ),
    { initialValue: this.router.url },
  );

  protected readonly dark = computed(() => this.theme.current() === 'dark');

  constructor() {
    // The mobile sheet closes once a link took the person somewhere.
    effect(() => {
      this.url();
      this.sidebar.setOpenMobile(false);
    });
  }

  protected isActive(item: NavItem): boolean {
    return isNavActive(this.url(), item);
  }

  protected lockNow(): void {
    void this.pin.lock();
  }
}
