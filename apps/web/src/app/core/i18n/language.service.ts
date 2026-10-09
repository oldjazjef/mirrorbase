import { Injectable, effect, inject, signal } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { desktopBridge } from '../desktop/desktop-bridge';
import {
  initialLocale,
  isSupportedLocale,
  LOCALE_STORAGE_KEY,
  type SupportedLocale,
} from './locales';

/**
 * The app's language: ngx-translate's language, `<html lang>`, and (desktop) the shell's menus.
 * Switching needs no reload. The choice is remembered on this device.
 */
@Injectable({ providedIn: 'root' })
export class LanguageService {
  private readonly translate = inject(TranslateService);
  private readonly language = signal<SupportedLocale>(initialLocale());
  readonly current = this.language.asReadonly();

  constructor() {
    effect(() => {
      const locale = this.language();
      document.documentElement.lang = locale;
      this.translate.use(locale);
      try {
        localStorage.setItem(LOCALE_STORAGE_KEY, locale);
      } catch {
        // Storage blocked: the choice lasts until the window closes.
      }
      void desktopBridge()?.locale?.set(locale);
    });
  }

  use(locale: string): void {
    if (isSupportedLocale(locale)) this.language.set(locale);
  }
}
