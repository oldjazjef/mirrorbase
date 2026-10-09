import {
  provideHttpClient,
  withFetch,
  withInterceptors,
} from '@angular/common/http';
import {
  type ApplicationConfig,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideSpartanHlm } from '@mirrorbase/ui/utils';
import { appRoutes } from './app.routes';
import { provideI18n } from './core/i18n/i18n.config';
import { provideAppSidebar } from './core/layout/sidebar-config';
import { unlockInterceptor } from './core/pin/unlock.interceptor';

/**
 * Zoneless: Angular 22 schedules change detection from signals and events, so there is no
 * `provideZoneChangeDetection` and no zone.js anywhere.
 */
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(appRoutes, withComponentInputBinding()),
    // The PIN lock's unlock token goes on every API request; a locked app holds its requests.
    provideHttpClient(withFetch(), withInterceptors([unlockInterceptor])),
    provideI18n(),
    provideSpartanHlm(),
    provideAppSidebar(),
  ],
};
