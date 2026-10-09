import { isNavActive, NAV_ITEMS } from './nav-config';

describe('isNavActive', () => {
  const log = NAV_ITEMS.find((item) => item.path === '/app/log');
  if (!log) throw new Error('the navigation has no log page');

  it('matches the page, its sub-pages and ignores query and fragment', () => {
    expect(isNavActive('/app/log', log)).toBe(true);
    expect(isNavActive('/app/log?run=abc', log)).toBe(true);
    expect(isNavActive('/app/log/extra#x', log)).toBe(true);
  });

  it('does not match a page that only starts with the same letters', () => {
    expect(isNavActive('/app/logbook', log)).toBe(false);
    expect(isNavActive('/app/connections', log)).toBe(false);
  });
});
