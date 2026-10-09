import type { Route } from '@angular/router';

export const appRoutes: Route[] = [
  { path: '', pathMatch: 'full', redirectTo: 'app' },
  {
    // Everything lives under /app, inside the shell. There is no login: the PIN lock screen
    // covers the app until it is unlocked (see App).
    path: 'app',
    loadComponent: () =>
      import('./core/layout/app-shell').then((m) => m.AppShell),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'replicate' },
      {
        path: 'replicate',
        loadChildren: () => import('./features/replicate/replicate.routes'),
      },
      {
        path: 'connections',
        loadChildren: () => import('./features/connections/connections.routes'),
      },
      {
        path: 'log',
        loadChildren: () => import('./features/log/log.routes'),
      },
      {
        path: 'settings',
        loadChildren: () => import('./features/settings/settings.routes'),
      },
      {
        path: 'help',
        loadChildren: () => import('./features/help/help.routes'),
      },
    ],
  },
  { path: '**', redirectTo: 'app' },
];
