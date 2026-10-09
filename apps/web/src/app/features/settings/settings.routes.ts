import type { Routes } from '@angular/router';

export default [
  {
    path: '',
    loadComponent: () =>
      import('./pages/settings-page/settings-page').then((m) => m.SettingsPage),
  },
] satisfies Routes;
