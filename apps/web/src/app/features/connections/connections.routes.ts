import type { Routes } from '@angular/router';

export default [
  {
    path: '',
    loadComponent: () =>
      import('./pages/connections-page/connections-page').then(
        (m) => m.ConnectionsPage,
      ),
  },
] satisfies Routes;
