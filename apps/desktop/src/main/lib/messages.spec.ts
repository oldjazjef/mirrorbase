import {
  DESKTOP_LOCALES,
  desktopMessages,
  isDesktopLocale,
  systemLocale,
} from './messages';

describe('desktop messages', () => {
  it('maps any German system language to de-CH and everything else to English', () => {
    expect(systemLocale('de-CH')).toBe('de-CH');
    expect(systemLocale('de-AT')).toBe('de-CH');
    expect(systemLocale('en-US')).toBe('en');
    expect(systemLocale('fr')).toBe('en');
    expect(systemLocale(undefined)).toBe('en');
  });

  it('recognises only shipped locales', () => {
    expect(isDesktopLocale('en')).toBe(true);
    expect(isDesktopLocale('de-CH')).toBe(true);
    expect(isDesktopLocale('fr')).toBe(false);
    expect(isDesktopLocale(null)).toBe(false);
  });

  it('has the same texts in every language, and puts the reason into the detail', () => {
    for (const locale of DESKTOP_LOCALES) {
      const messages = desktopMessages(locale);
      expect(messages.fatal.title.length).toBeGreaterThan(0);
      expect(messages.fatal.detail('disk full')).toContain('disk full');
      expect(messages.about.credits.length).toBeGreaterThan(0);
    }
  });
});
