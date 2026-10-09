import {
  lucideArrowLeftRight,
  lucideCircleHelp,
  lucideDatabase,
  lucideScrollText,
  lucideSettings,
} from '@ng-icons/lucide';

export interface NavItem {
  /** Absolute router path. */
  readonly path: string;
  /** i18n key of the label. */
  readonly labelKey: string;
  /** Icon name (see NAV_ICONS). */
  readonly icon: string;
}

/** The main navigation - the single source for the sidebar. */
export const NAV_ITEMS: readonly NavItem[] = [
  {
    path: '/app/replicate',
    labelKey: 'nav.replicate',
    icon: 'lucideArrowLeftRight',
  },
  {
    path: '/app/connections',
    labelKey: 'nav.connections',
    icon: 'lucideDatabase',
  },
  { path: '/app/log', labelKey: 'nav.log', icon: 'lucideScrollText' },
  { path: '/app/settings', labelKey: 'nav.settings', icon: 'lucideSettings' },
  { path: '/app/help', labelKey: 'nav.help', icon: 'lucideCircleHelp' },
];

/** The icons the navigation uses, registered once by the shell. */
export const NAV_ICONS = {
  lucideArrowLeftRight,
  lucideCircleHelp,
  lucideDatabase,
  lucideScrollText,
  lucideSettings,
};

/** Whether `url` is on `item`'s page (query string and fragment ignored). */
export function isNavActive(url: string, item: NavItem): boolean {
  const path = url.split(/[?#]/)[0] ?? '';
  return path === item.path || path.startsWith(`${item.path}/`);
}
