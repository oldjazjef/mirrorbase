import { appRoutes } from '../../app.routes';
import { NAV_ITEMS } from '../../core/layout/nav-config';
import { HELP_SECTIONS } from './help-content';

describe('help content', () => {
  const appPages = new Set(
    NAV_ITEMS.map((item) => item.path).filter((path) => path !== '/app/help'),
  );

  it('every "Open" link goes to a page in the navigation', () => {
    const links = HELP_SECTIONS.flatMap((s) => s.links.map((l) => l.path));
    expect(links.filter((path) => !appPages.has(path))).toEqual([]);
  });

  it('every navigation page is a real route', () => {
    const children = appRoutes.find((route) => route.path === 'app')?.children;
    const paths = (children ?? []).map((route) => `/app/${route.path}`);
    expect(
      NAV_ITEMS.map((item) => item.path).filter((p) => !paths.includes(p)),
    ).toEqual([]);
  });

  it('has unique section ids', () => {
    const ids = HELP_SECTIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
