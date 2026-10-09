import type { Routes } from '@angular/router';

export default [
  {
    path: '',
    loadComponent: () =>
      import('./pages/replicate-page/replicate-page').then(
        (m) => m.ReplicatePage,
      ),
  },
] satisfies Routes;
