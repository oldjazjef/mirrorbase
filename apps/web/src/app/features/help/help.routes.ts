import type { Routes } from '@angular/router';

export default [
  {
    path: '',
    loadComponent: () =>
      import('./pages/help-page/help-page').then((m) => m.HelpPage),
  },
] satisfies Routes;
