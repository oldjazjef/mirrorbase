import type { Routes } from '@angular/router';

export default [
  {
    path: '',
    loadComponent: () =>
      import('./pages/log-page/log-page').then((m) => m.LogPage),
  },
] satisfies Routes;
